// @ts-check
// Stage 14 task 14.31 — SEND FROM EVERYWHERE. One function behind `POST /api/documents/send`:
// send an existing draft (`{instanceId}`, the old shape, unchanged) OR create-and-send in one call
// (`{personId, template}`, new).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ATOMIC BY CONSTRUCTION, NOT BY ANYTHING WRITTEN HERE. `tx` is the SAME connection
//     `registerWriteRoutes` hands every route handler, already wrapped in `BEGIN … COMMIT` by
//     `withTenant` (`src/db/index.mjs:110,140`) for the whole lifetime of one HTTP request. Every
//     query in this file — the person-visibility check, `createInstance`'s INSERT, `sendInstance`'s
//     UPDATE, the mint, and the `next_reminder_at` UPDATE — runs inside that one transaction. A crash
//     or thrown error before it commits rolls every one of them back together; nothing here opens a
//     second transaction or a savepoint of its own.
//
// ★★★ IDEMPOTENCY — TWO DIFFERENT RETRIES, TWO DIFFERENT GUARANTEES.
//   · An IDENTICAL retry (same Idempotency-Key) never reaches this function a second time at all —
//     `runTenantScoped`'s stored-replay machinery (`src/http/idempotency.mjs`, P1.15) answers it from
//     the first response before `route.fn` runs again.
//   · A LOGICAL retry — a caller who already holds the `instanceId` this call returned, presenting it
//     a second time with a NEW idempotency key — hits `sendInstance`'s own `WHERE id = $1 AND
//     state = 'draft'` predicate (`src/documents/writes.mjs:447`): the row is no longer `draft`, the
//     UPDATE matches zero rows, and `sendInstance` throws `conflict()` (409) BEFORE this file's mint
//     step ever runs. No second `mintSignLinks`, no second email. This is the guarantee 14.30 named
//     and this file relies on rather than re-implements.
//
// ★★★ RULING 1 (this task) — THE RESPONSE NEVER CARRIES A SIGN-LINK URL. `{id, instanceId, state,
//     sent_at, emailed}` — no `url`, no `link`, nothing a replay could hand back a second time. The
//     per-call `extraNames` redaction option (`src/http/idempotency.mjs:50-52`) exists for a route
//     whose OWN response carries a credential; this one's does not, and the shared `registerWriteRoutes`
//     dispatch that would need to plumb `extraNames` through (`src/routes/writes.mjs:948-1014`) is not
//     in this task's file list to change even if it did.
//
// ★★★ THE BLOCKED LIST NEVER LEAVES THE PLATFORM. The email vars below are exactly `practiceName`,
//     `recipientName`, `documentTitle`, `link`, `senderName` — a title and two display names, nothing
//     from the instrument's own content (no clause text, no price, no clinical field). "No stored
//     body" is `sendSignLinkEmail`'s own rule (`src/email/documentLinkEmail.mjs:9-12`) — this file
//     writes no notification_delivery row for the sign-link email either, same reasoning.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, notFound, conflict } from "../http/errors.mjs";
import { uuid } from "../http/validate.mjs";
import { createInstance, sendInstance, DEFAULT_SEND_MODE } from "./writes.mjs";
import { seedStarterTemplate } from "./starterTemplates.mjs";
import { mintSignLinks } from "./signLinks.mjs";
import { ports } from "./ports.mjs";
import { sendSigningMail, recordInvitation } from "./emailIdentity.mjs";
import { buildFacts, resolveFields, resolveMessageTemplate } from "./variables.mjs";
import { VARIABLES } from "./variableCatalogue.mjs";
import { getDocumentSetting } from "./settings.mjs";
import { SIGNER_CONFIGS } from "./vocabulary.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** One template row, however it was reached — the fields the create branch needs. */
// ★ FOUND LIVE, 30 Sep 2026 (save-system test pass) — a template's OWN LIST route
//   (`/api/list/documents/contracts/templates`) returns every VERSION of it, active or retired
//   (P15C.8: "a new version is a new row… the predecessor is deactivated, never edited or deleted" —
//   so a retired row keeps its real name and its real historical `sent_instances` count, looking
//   exactly like a normal template). This function used to load ANY row by id, active or not.
//   MEASURED: sending against a retired id CREATES the instance and SENDS it — title, email, sign
//   link, everything looks right — but `sendInstance`'s own freeze query joins on `t.active = true`
//   for the instance's `template_id` and finds no row, so it freezes a null body. Nothing anywhere
//   in that path throws: the recipient's sign page is the first and only place it ever surfaces
//   ("This document's frozen wording is missing"). `active` is now checked HERE, before anything is
//   created, with an error that says why — the CLIENT-side picker (NewDocumentWizard.jsx) also
//   filters retired versions out now, so this is the defence for any OTHER caller (or a stale cache).
async function loadTemplate(tx, templateId) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["id", "builder", "name", "type_id", "teen_template_id", "client_description", "message", "active"])
    .where("id", "=", templateId));
  const tpl = rows[0] ?? null;
  if (tpl && !tpl.active) {
    throw conflict(
      `"${tpl.name}" is a retired version of this template — a newer version replaced it and this one ` +
      `can no longer be sent. Pick the current version from the template list.`);
  }
  return tpl;
}

/**
 * ★★★ ONE PATH FOR EVERY SENDER. `args.instanceId` → send the existing draft (unchanged behaviour);
 * otherwise `args.personId` + `args.template` → create the instance, then send it, in the same call.
 * Either way, once the instrument is `sent`, mint a link per pending signer and email it directly
 * (14.30's `mintSignLinks`/`sendSignLinkEmail` — never `remindSigners`, which is the LATER wording),
 * then schedule the first reminder unless the caller opted out.
 */
export async function sendDocument(tx, args) {
  const { tenantId, actorUserId = null } = args;
  let instanceId;
  let sendResult;

  if (args.instanceId) {
    // ★ THE OLD SHAPE, UNCHANGED. `sendInstance` is not edited by this task; its own `state = 'draft'`
    //   predicate is the 409-on-retry guarantee this file relies on (see header note above).
    sendResult = await sendInstance(tx, args);
    instanceId = args.instanceId;
  } else {
    if (!args.personId || !args.template) {
      throw invalid(
        "sendDocument: either {instanceId}, or both {personId, template}, is required");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ THE SHARPER IN-MODULE CHECK, BEFORE ANY WRITE. Field 4's own idiom name: "coarse route
    //     gate, sharper in-module check on the SAME real permission" (`src/routes/writes.mjs:778`,
    //     `src/booking/createBooking.mjs:149-182`). The ROUTES row's own object/action/subject
    //     (`document`/`edit`/`instanceId`) resolves `ownerId = null` for this branch — there is no
    //     existing instance yet to inherit an owner from — so it asks only "does this role hold
    //     document:edit at all". THIS question is the real one: may the sender even SEE the person
    //     they are about to send a document to. `assertMay` throws `forbidden` (403) on refusal,
    //     scoped by the SAME `person: view` grant every other person-facing route already reads.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    await (await ports()).access.assertMay(tx, args.principal, { object: "person", action: "view", subject: "personId" }, args);

    let tpl;
    if (uuid.safeParse(args.template).success) {
      tpl = await loadTemplate(tx, args.template);
      if (!tpl) throw notFound("That template is not in this workspace.");
    } else {
      const seeded = await seedStarterTemplate(tx, { tenantId, key: args.template, actorUserId });
      tpl = await loadTemplate(tx, seeded.templateId);
      if (!tpl) throw notFound("seedStarterTemplate returned a template id this transaction cannot read");
    }

    // ★ F07 §1.2 — an adolescent client is sent the TEEN edition, when the template names one. The
    //   adult template is never substituted the other way: an adult template with no
    //   `teen_template_id` is sent as-is to an adolescent, unchanged from today.
    const personRows = await (await ports()).people.byIds(tx, [args.personId]);
    if (personRows[0]?.role === "adolescent_client" && tpl.teen_template_id) {
      const teen = await loadTemplate(tx, tpl.teen_template_id);
      if (teen) tpl = teen;
    }

    const { rows: typeRows } = await run(tx, db
      .selectFrom("keystone.document_type")
      .select(["default_assigned_to", "signer_config"])
      .where("id", "=", tpl.type_id));
    const defaultAssignedTo = typeRows[0]?.default_assigned_to ?? [];

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ F127 (23 Oct 2026) — A PARENT-SIGNED AGREEMENT IS ABOUT THE TEEN. The signer order (SIGNER_CONFIGS) resolves `client` to
    //    the SUBJECT and `parent` to the subject's guardian (signLinks.mjs), so the teen must be the subject. Found on the beta: the
    //    picker offered only adults, the parent was picked, and was sent the teen agreement "Signing as Client" with the teen not a
    //    party at all. Refused here in plain words rather than sent to the wrong people; person facts come through the people port.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const order = SIGNER_CONFIGS[typeRows[0]?.signer_config] ?? [];
    if (order.includes("parent")) {
      const P = await ports();
      const person = personRows[0] ?? null;
      const personName = person?.display_name || "This person";
      if (person?.role === "adolescent_client") {
        const guardian = await P.people.guardianOf(tx, args.personId);
        if (!guardian) {
          throw invalid(`${personName} has no parent or guardian with an email on record. Add one to their account, then send this agreement — the parent signs it too.`);
        }
        if (order.some((r) => r === "client" || r === "pir") && !(person.email && String(person.email).trim())) {
          throw invalid(`${personName} has no email address, so they cannot get their own signing link. Add their email, then send this agreement.`);
        }
      } else if (person && P.people.childrenOf) {
        const teens = (await P.people.childrenOf(tx, args.personId)).filter((c) => c.is_minor);
        if (teens.length) {
          const names = teens.map((t) => t.display_name).join(" or ");
          throw invalid(`This agreement is for a teen and their parent. Send it to ${names} — ${personName} gets their own copy to sign as parent/guardian.`);
        }
      }
    }

    // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 — `args.title`/`args.description`/
    //   `args.message` are this ONE send's own values (the wizard's own Details step, "filled in
    //   from the template, editable"); falling back to the template's own name/client_description/
    //   message when the caller does not override them, exactly as `title` already fell back to
    //   `tpl.name` unconditionally before this task.
    const rawDescription = args.description ?? tpl.client_description ?? null;
    const rawMessage = args.message ?? tpl.message ?? null;

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ FIX, 30 Sep 2026 ("smart fields in the Message" brief) — `{{name}}` TOKENS RESOLVED FOR
    //     THIS ONE RECIPIENT, ONCE, HERE — never re-resolved later, the same "frozen at send"
    //     posture §P9.1 already gives the document body's own variables. `buildFacts` is called with
    //     `personId` only (no `instanceId` yet — the instance this send is creating does not exist
    //     until `createInstance` below): document.* variables (which read `f.instance`) will not
    //     resolve for a Message sent this way, same honest gap `RESOLVABLE_VARIABLES` (only person/
    //     practice/subscription-domain names) already excludes by construction for THIS surface.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    let description = rawDescription;
    let message = rawMessage;
    if (rawDescription || rawMessage) {
      const facts = await buildFacts(tx, { tenantId, personId: args.personId, audience: "admin" });
      const { values } = resolveFields(VARIABLES, facts);
      description = resolveMessageTemplate(rawDescription, values);
      message = resolveMessageTemplate(rawMessage, values);
    }

    const created = await createInstance(tx, {
      tenantId, builder: tpl.builder, title: args.title || tpl.name, typeId: tpl.type_id, templateId: tpl.id,
      subjectUserId: args.personId, assignedTo: defaultAssignedTo, actorUserId,
      description, message, customValues: args.customValues ?? null,
    });
    instanceId = created.id;

    sendResult = await sendInstance(tx, {
      tenantId, instanceId, actorUserId, sendMode: args.sendMode ?? DEFAULT_SEND_MODE,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ MINT, THEN EMAIL DIRECTLY — NEVER `remindSigners`. `mintSignLinks` (`src/documents/
  //     signLinks.mjs:138-166`) already subtracts any role with a `signature_record` row, so calling
  //     it here is safe even on a re-entrant path; it never re-opens a door a signer already walked
  //     through. The FIRST-send wording is `document.sign_link`, never `document.sign_link_reminder`
  //     (that key is the reminder sweep's own, `src/time/due.mjs:211-215`, task 14.28 — a different
  //     task's file).
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const signers = await mintSignLinks(tx, { tenantId, instanceId });
  let emailed = 0;
  if (signers.length) {
    const P = await ports();
    // ★ the sign-link email is brand-facing: the practice's PUBLIC name (an example organisation), via the brand port
    const { practiceName, logoUrl } = await P.brand.get(tx, { tenantId });

    // ★ senderName: the person who just sent it (this actor), falling back to the practice name so
    //   the required var is never blank — the same fallback `remindSigners` uses for its own sender.
    let senderName = practiceName;
    if (actorUserId) {
      const [sender] = await P.people.byIds(tx, [actorUserId]);
      if (sender?.display_name) senderName = sender.display_name;
    }

    const { rows: instRows } = await run(tx, db
      .selectFrom("keystone.document_instance")
      .select(["title", "message"])
      .where("id", "=", instanceId));
    const documentTitle = instRows[0]?.title ?? "";
    // ★ SQUARE CONTRACTS OVERHAUL PART 2 — the document's own message (migration 0539) is the email
    //   BODY; `sendSigningEmail` itself falls back to the Run → Templates wording when this is blank.
    const documentMessage = instRows[0]?.message ?? null;

    const ids = signers.map((s) => s.appUserId);
    const peopleRows = await P.people.byIds(tx, ids);
    const nameById = Object.fromEntries(peopleRows.map((p) => [p.id, p.display_name]));

    for (const signer of signers) {
      // ★ THE OUTCOME IS IGNORED FOR THE HTTP RESULT — a `skipped` (no RESEND_API_KEY, dev/test) or
      //   `failed` send does not fail this write; the instrument is sent either way (§M0 LAW 3 does
      //   not depend on delivery). `emailed` counts only actual `sent` outcomes, so the caller can
      //   tell the difference between "sent to 2 people" and "sent to 0, mail is unconfigured".
      const outcome = await sendSigningMail(tx, { tenantId,
        to: signer.email,
        practiceName,
        logoUrl,
        recipientName: nameById[signer.appUserId] ?? "",
        documentTitle,
        message: documentMessage,
        link: signer.url,
        senderName,
      });
      if (outcome.status === "sent") emailed += 1;
      // remember which provider message carried this person's invitation, so a bounce can find them (QUEUE §23.3.4)
      await recordInvitation(tx, { tenantId, instanceId, to: signer.email, providerMessageId: outcome.providerMessageId });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ RULING 2 — THE FACT 14.28 BUILT AND NOTHING EVER SET. `document_reminder_due`
  //     (`src/time/due.mjs:196-201`) sweeps `state IN ('sent','partially_signed') AND
  //     next_reminder_at <= now()`; until this line, nothing in `src/` ever wrote that column, so the
  //     fact found zero rows correctly. `documents.reminder_days` (default `[3, 7]`,
  //     `src/settings/keys.mjs:540`) is the SAME setting `due.mjs:217` reads to advance the schedule
  //     after this first reminder fires — this sets the FIRST offset (index 0); `due.mjs` reads the
  //     SECOND (index 1) onward. `args.remind !== false` is the opt-out — absence never silences it,
  //     an explicit `false` does, the same "the sending matrix draws it" reading `tasks.mjs`'s own
  //     notify-from handlers use.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (args.remind !== false) {
    const reminderDays = await getDocumentSetting(tx, "reminder_days");
    const firstOffsetDays = Array.isArray(reminderDays) && reminderDays.length > 0 ? reminderDays[0] : 3;
    await tx.query(
      `UPDATE keystone.document_instance
          SET next_reminder_at = sent_at + make_interval(days => $2::int)
        WHERE id = $1`,
      [instanceId, firstOffsetDays]);
  }

  return {
    id: instanceId, instanceId, state: "sent", sent_at: sendResult.sent_at, emailed,
  };
}
