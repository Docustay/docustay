// @ts-check
// Stage 14 task 14.30 — SIGN LINKS: MINT, EMAIL (NO STORED BODY), REMIND.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A SIGN LINK IS A BEARER CREDENTIAL. Whoever holds the URL this module emails can reach a
//     document to sign — there is no session, no password, nothing else standing in the way. Every
//     property that matters is therefore inherited from `src/auth/linkToken.mjs`, not re-decided
//     here: `mintLinkToken` stores an HMAC-SHA256 digest of the secret (peppered with
//     `KEYSTONE_TOKEN_PEPPER`) and NEVER the secret itself, the comparison happens in Postgres as an
//     index probe, and the presented string it returns (`kl_<id>_<secret>`) is handed back exactly
//     ONCE, at mint. This module never re-derives any of that — it only calls `mintLinkToken` and
//     carries what comes back.
//   ★★ THE PRESENTED STRING NEVER LEAVES THIS MODULE EXCEPT INSIDE `url`, AND `url` ONLY EVER GOES
//      TO `sendSignLinkEmail`. `mintSignLinks`' own return value carries `url` back to its caller (a
//      mint with nothing to send it to would be useless), but nothing in this file logs it, stores
//      it a second time, or puts it in an event payload — `db/gates/wiring.mjs`'s catalogue has no
//      caller here that could. The database holds only what `mintLinkToken` already writes: a hash.
//
// ★★ "NO STORED BODY" IS THIS TASK'S OWN TITLE, AND IT IS A PRIVACY RULING, NOT AN OPTIMISATION.
//    `sendSignLinkEmail` (documentLinkEmail.mjs) renders and sends without ever handing the rendered
//    subject/text to a durable row — unlike `sendNotificationEmail` (`send.mjs`), which freezes the
//    rendered copy onto `notification_delivery` on purpose. A sign-link email says only "a document
//    is ready to sign" — never a word of what is IN it, and the blocked list (DOB, sobriety date,
//    recovery fields, notes, emergency contact, consent detail, guardian relationship) never reaches
//    a template var here, the same discipline `authEmail.mjs` already holds for sign-in mail.
//
// ★ ONE LINK PER SIGNER, MINTED AT SEND AND AT EACH REMINDER (task field 1). A fresh token every time
//   is the DESIGN, not a defect: an old email might be lost, and the old link stays independently
//   valid (or gets spent, or expires) on its own terms — `redeemLinkToken`'s single-use guarantee
//   means a signer who follows an old link and a new one can still only spend one of them once.
//   ★★ THE ONE DEDUPE THIS MODULE DOES OWN: a party who has ALREADY SIGNED (a `signature_record` row
//      exists for their role) is NEVER minted a new link again, no matter how many times
//      `mintSignLinks`/`remindSigners` is called — `signersFor` below subtracts signed roles from the
//      type's signer order every single call, so calling it twice cannot re-open a door a signer
//      already walked through. ★ WHAT THIS MODULE DOES **NOT** OWN, REPORTED RATHER THAN GUESSED:
//      stopping a RETRIED REMINDER SWEEP from re-mailing a signer who has not yet signed. That
//      guarantee lives in `next_reminder_at`/`reminders_sent` (0418) and the transaction the reminder
//      sweep (task 14.28, not this task) runs `remindSigners` inside — as long as the sweep advances
//      `next_reminder_at` in the SAME transaction as the mint+send below, a crash before commit
//      reverts both together (nothing was sent, nothing was marked done) and a completed reminder is
//      never reselected (`system_reminder_read`'s `next_reminder_at <= now()` predicate, 0418 §E).
//      This file has no memory of when it last ran; that memory is the caller's `next_reminder_at`,
//      not anything here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { internal } from "../http/errors.mjs";
import { assertTenantTx } from "../db/index.mjs";
import { mintLinkToken } from "../auth/linkToken.mjs";
import { SIGNER_CONFIGS } from "./vocabulary.mjs";
// ★ FIX, 30 Sep 2026 ("unsigned-document reminder" brief) — `remindSigners` below used to call
//   `sendSignLinkEmail` (documentLinkEmail.mjs), the plain-text-only sender this file's own header
//   already calls out by name as the thing Part 2's rebuild replaced for the FIRST send
//   (`sendDocument.mjs`'s own comment names it "the LATER wording" — meaning nobody ever moved the
//   REMINDER onto the branded frame when the first send got one). `sendSigningEmail` is now used for
//   both; `fallbackTemplateKey`/`isReminder` tell them apart.
import { ports } from "./ports.mjs";
import { sendSigningMail, recordInvitation } from "./emailIdentity.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ★ TASK 8.12's idiom (`src/routes/writes.mjs:731`, M), re-implemented here rather than imported —
//   that file is not in this task's list and 8.12's own const is not exported.

/**
 * ★★★ NAME THE PARTY YOU MEAN, NEVER BORROW ANOTHER'S (CLAUDE.md §2.7). Every signer role this
 *     function does not recognise is refused loudly rather than silently skipped or mailed to the
 *     wrong person — 14.30's field 4 defines a person for exactly `client`/`pir` (the subject),
 *     `parent` (the subject's guardian) and `coach` (excluded: staff sign in the CRM). A signer_config
 *     that names any OTHER party (`consultant`, `familyMember`, `recipient`) has no resolution rule
 *     written for it by this task, and this throws rather than guessing one.
 */
async function resolveSignerPerson(tx, { role, subjectUserId }) {
  if (role === `coach`) return undefined; // ★ excluded — staff sign in the CRM, never by email link.

  if (role === "client" || role === "pir") {
    if (!subjectUserId) return undefined;
    const [person] = await (await ports()).people.byIds(tx, [subjectUserId]);
    return person && person.email && person.email.trim() ? person : undefined;
  }

  if (role === "parent") {
    if (!subjectUserId) return undefined;
    // the subject's guardian (first with an email, deterministic) — through the people port
    return (await (await ports()).people.guardianOf(tx, subjectUserId)) ?? undefined;
  }

  throw internal(
    `signersFor: signer role "${role}" has no person-resolution rule. Task 14.30 defines one for ` +
    `client/pir (the subject), parent (the subject's guardian) and coach (excluded). A signer_config ` +
    `naming any other party needs its own rule written, not a guess.`);
}

/**
 * ★★★ signersFor(tx, {instanceId}) — the instance's type order (SIGNER_CONFIGS) MINUS roles already
 *     in signature_record, each resolved to a real person (or skipped, never invented).
 * @returns {Promise<Array<{role: string, person: {id: string, email: string, display_name: string}}>>}
 */
export async function signersFor(tx, { instanceId }) {
  assertTenantTx(tx, "signersFor");

  const { rows: instRows } = await run(tx, db
    .selectFrom("keystone.document_instance as i")
    .innerJoin("keystone.document_type as t", "t.id", "i.type_id")
    .select(["i.subject_user_id", "t.signer_config"])
    .where("i.id", "=", instanceId));
  const inst = instRows[0];
  if (!inst) return []; // ★ no instance (or none this tenant can see) — nothing to sign, fail closed.

  const order = SIGNER_CONFIGS[inst.signer_config];
  if (!Array.isArray(order)) return []; // ★ an unrecognised config names nobody — fail closed, not guessed.

  const { rows: signedRows } = await tx.query(
    `SELECT DISTINCT role FROM keystone.signature_record WHERE instance_id = $1`,
    [instanceId]);
  const alreadySigned = new Set(signedRows.map((r) => r.role));

  const pending = order.filter((role) => !alreadySigned.has(role));

  const out = [];
  for (const role of pending) {
    const person = await resolveSignerPerson(tx, { role, subjectUserId: inst.subject_user_id });
    if (person) out.push({ role, person });
  }
  return out;
}

/**
 * ★★★ mintSignLinks(tx, {tenantId, instanceId}) — mints, never sends. One `mintLinkToken` per
 *     resolved signer, returning exactly `[{role, appUserId, email, url}]`.
 */
export async function mintSignLinks(tx, { tenantId, instanceId }) {
  assertTenantTx(tx, "mintSignLinks");

  const signers = await signersFor(tx, { instanceId });
  if (signers.length === 0) return [];

  const { publicBase } = await (await ports()).brand.get(tx, { tenantId });

  const out = [];
  for (const { role, person } of signers) {
    const minted = await mintLinkToken(tx, {
      tenantId,
      purpose: "document_signature",
      subjectType: "document_instance",
      subjectId: instanceId,
      issuedTo: person.id,
      ttlHours: 24 * 30,
    });
    out.push({
      role,
      appUserId: person.id,
      email: person.email,
      url: `${publicBase}/sign?t=${encodeURIComponent(minted.presented)}`,
    });
  }
  return out;
}

/**
 * ★★★ remindSigners(tx, {tenantId, instanceId}) — mintSignLinks, then one `document.sign_link_reminder`
 *     email per still-pending signer. Returns the same `[{role, appUserId, email, url}]` mintSignLinks
 *     returns, so a caller can report how many went out.
 */
export async function remindSigners(tx, { tenantId, instanceId }) {
  assertTenantTx(tx, "remindSigners");
  // QUEUE §23.4.7 — an uploaded document's people are its `document_party` rows, not the platform accounts: the reminder sweep reaches them through their own function
  const { rows: [kind] } = await tx.query(`SELECT builder FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (kind?.builder === "pdf") {
    const { remindDueParties } = await import("./pdfSend.mjs");
    const r = await remindDueParties(tx, { tenantId, instanceId });   // ★ no swallowing catch: an error inside a transaction leaves it aborted, and a silent 0 would hide a broken sweep (F891)
    return Array.from({ length: r.reminded ?? 0 }, () => ({ role: "signer", appUserId: null, email: null, url: null }));
  }

  const links = await mintSignLinks(tx, { tenantId, instanceId });
  if (links.length === 0) return [];

  const P = await ports();
  // the practice's PUBLIC brand name (an example organisation brand brief, 1 Oct 2026) via the brand port
  const { practiceName, logoUrl } = await P.brand.get(tx, { tenantId });

  const { rows: instRows } = await run(tx, db
    .selectFrom("keystone.document_instance")
    .select(["title", "created_by", "message"])
    .where("id", "=", instanceId));
  const documentTitle = instRows[0]?.title ?? "";
  const createdBy = instRows[0]?.created_by ?? null;
  // ★ Same message the first send used (already resolved/frozen — see sendDocument.mjs)
  const documentMessage = instRows[0]?.message ?? null;

  // ★ senderName: the instrument's own creator ("who sent it"), falling back to the practice name so the required var is never blank
  let senderName = practiceName;
  if (createdBy) {
    const [creator] = await P.people.byIds(tx, [createdBy]);
    if (creator?.display_name) senderName = creator.display_name;
  }

  const ids = links.map((l) => l.appUserId);
  const peopleRows = await P.people.byIds(tx, ids);
  const nameById = Object.fromEntries(peopleRows.map((p) => [p.id, p.display_name]));

  for (const link of links) {
    const outcome = await sendSigningMail(tx, { tenantId,
      to: link.email,
      practiceName,
      logoUrl,
      recipientName: nameById[link.appUserId] ?? "",
      documentTitle,
      message: documentMessage,
      link: link.url,
      senderName,
      fallbackTemplateKey: "document.sign_link_reminder",
      isReminder: true,
    });
    await recordInvitation(tx, { tenantId, instanceId, to: link.email, providerMessageId: outcome.providerMessageId });
  }
  return links;
}
