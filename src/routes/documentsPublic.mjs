// Stage 14 task 14.34 — PUBLIC SIGNING ROUTES: `runSignerScoped`'s FIRST REAL CALLERS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THESE THREE ROUTES FACE THE OPEN INTERNET, UNAUTHENTICATED. There is no session, no cookie —
//     the presented link-token string (`kl_<id>_<secret>`) is the ONLY credential, and it is the
//     one a client's phone holds after opening an emailed link. Every choice below follows from
//     that one fact.
//
// ★★ THE ENUMERATION ORACLE. Unknown token, expired, revoked, already-spent, wrong party, archived
//    document — every one of those causes must produce the SAME status and the SAME sentence, so a
//    prober guessing token ids or secrets learns nothing about which guess was "closer". The token
//    layer itself (`redeemLinkToken`/`peekLinkToken`, `src/auth/linkToken.mjs`) already folds
//    unknown/expired/revoked/spent/wrong-purpose into one undifferentiated "no row" answer, and
//    `runSignerScoped` (`src/http/app.mjs:1115`) turns that into ONE forbidden sentence — including
//    R-14.4's "issued to nobody" refusal. What THIS FILE owns, on top of that, is making sure ITS
//    OWN logic never reopens the oracle: a document that is gone, archived, or whose role this
//    token no longer names must refuse with the exact same sentence, never a distinguishable
//    "not found" or "wrong role" message. `LINK_REFUSED_TEXT` below is that one sentence, mirrored
//    — not imported — from `app.mjs`'s own (unexported) `SIGNER_LINK_REFUSED_TEXT` and
//    `writes.mjs`'s own (unexported) `SIGNER_LINK_REFUSED`; the same idiom both of those comments
//    describe ("mirrored, never imported") for the same module-boundary reason.
//
// ★★★ §0.4 B — `/api/public` HOLDS NO `WRITE_ROUTES` ROWS. This module registers its own POSTs
//     directly (`registerPublicDocumentRoutes`), the same shape `src/routes/notes.mjs` and
//     `src/routes/itemsCatalogue.mjs` use for a namespace with no table of its own.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.34's
//     file list — task 14.41 calls `registerPublicDocumentRoutes`. Reported here, not silently left
//     unwired.
//
// ★ WHO SUPPLIES THE RATE LIMIT: `src/http/app.mjs`'s per-IP limiter is mounted on `"/api/*"`
//   BEFORE routing and before any database round trip (`app.mjs:215-221`) — the SAME bucket every
//   other `/api/*` path shares, peek and redeem alike (CCR-11, `linkToken.mjs:305-309`). This file
//   adds no limiter of its own: the application, not a test, supplies that condition, and it is
//   already live on this path because it is live on every path under `/api/*`.

import { forbidden, invalid, conflict } from "../http/errors.mjs";
import { redeemLinkToken } from "../auth/linkToken.mjs";
import { recordSignature, declineInstance, executeIfComplete } from "../documents/writes.mjs";
import { recordAuditEvent } from "../documents/auditTrail.mjs";
import { instrumentSnapshot } from "../documents/preview.mjs";
import { signersFor } from "../documents/signLinks.mjs";
import { SIGNER_CONFIGS } from "../documents/vocabulary.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { verifySignedPdf } from "../documents/verifyPdf.mjs";

// ★ The one purpose this door opens. A non-empty array is `runSignerScoped`'s own requirement
//   (`app.mjs:1116-1119`); frozen so the three routes below cannot drift from one another.
const PURPOSES = Object.freeze(["document_signature"]);

// ★★★ MIRRORED, NEVER IMPORTED — see the header note above. Identical wording to
//     `src/http/app.mjs:1112-1113` and `src/routes/writes.mjs:744-745`.
const LINK_REFUSED_TEXT =
  "That link is not valid. It may have been used already, expired, or been cancelled — ask for a new one.";

/**
 * ★★★ THE ONE PLACE THIS TOKEN'S ROLE IS DECIDED, for all three routes. `link_token` carries no
 *     `role` column (`db/migrations/0169_link_token.sql:12-24`, MEASURED) — `mintSignLinks`
 *     (`signLinks.mjs:138-166`) mints one token per PERSON, not per role-string, so the only way to
 *     answer "which party is this signer" is to ask `signersFor` (the same function that decided
 *     who to mint links for in the first place) which pending role this person's id matches.
 *
 * ★★ FAILS CLOSED, INDISTINGUISHABLY FROM AN INVALID LINK. `signersFor` already returns `[]` for an
 *    instance that does not exist or is not visible to the current viewer (14.30's own "fail
 *    closed, not guessed" — `signLinks.mjs:114,117`), and it already SUBTRACTS any role that has
 *    already signed. So "no such document", "archived", "this token's person is not a party this
 *    instrument names" and "this party already signed" all land here as the SAME empty result, and
 *    all three are answered with the SAME `LINK_REFUSED_TEXT`/403 — never a distinguishing message.
 *    This is deliberate, not an oversight: a message that told a caller WHICH of those was true
 *    would be exactly the oracle this task's brief names.
 */
async function resolveSigner(db, { instanceId, issuedTo }) {
  const signers = await signersFor(db, { instanceId });
  const mine = signers.find((s) => s.person.id === issuedTo);
  if (!mine) throw forbidden(LINK_REFUSED_TEXT);
  return mine; // { role, person: { id, email, display_name } }
}

/** The practice's own display name, for `practice: {name}` and the context line. Never a secret. */
async function practiceName(db, tenantId) {
  const { rows } = await db.query(`SELECT name FROM keystone.tenant_directory WHERE id = $1`, [tenantId]);
  return rows[0]?.name ?? "";
}

// ★ QUEUE §17.11 / §23.3.5 (the maintainer, 2 Oct 2026): SMS verification was REMOVED from Documents — the Twilio Verify code, the two phone routes, the sign gate and the setting. An email code / access code may
//   return later through the mailer port (Part 5A).

/**
 * ★★★ THE SPEND IS LAST, ALWAYS, ON EVERY WRITE ROUTE BELOW. `runSignerScoped` is called with
 *     `spend: false` (PEEK) so opening the transaction never burns the link; the real, one-time
 *     spend happens HERE, via `redeemLinkToken` directly — the SAME function `runSignerScoped`
 *     itself would call with `spend: true`, called a second time, deliberately, once the write has
 *     already succeeded.
 * ★★ WHY THIS ORDER, AND NOT SPEND-THEN-WRITE: `redeemLinkToken` runs on its OWN connection
 *    (`withCredentialLookup`, `src/db/index.mjs:184-201`) and commits its spend the instant it
 *    succeeds — independent of this route's own tenant transaction. Spending FIRST would durably
 *    burn a signer's one link even if `recordSignature`/`declineInstance` then failed (wrong order,
 *    already signed, instrument no longer signable) — locking a legitimate signer out over a
 *    business-rule refusal that has nothing to do with the link itself. Writing first means: if the
 *    write fails, this function never reaches the spend at all, and the link is untouched — "a
 *    failed signature never burns the link" (task brief, verbatim). If the write succeeds but the
 *    spend then fails (the concurrent-redeem race: a second tab, a doubled click, or a retried
 *    request racing on the SAME presented secret), THROWING here rolls back `db`'s own transaction
 *    — `withTenant`'s `catch` issues `ROLLBACK` (`src/db/index.mjs:142-144`) — so the write this
 *    request made is undone together with the spend it could not complete. Exactly one of two
 *    racing requests on the same token ever keeps its write; `signature_record_one_per_party`
 *    (`0036:88-89`) backs the same guarantee a second way if both somehow reached the INSERT.
 * ★ `subjectId` is asserted unchanged as a defensive close of the loop: the presented string names
 *   one token row, so a second read of it cannot legitimately answer a different subject. If it
 *   ever did — a corrupted row, never a normal cause — this refuses with the SAME link sentence
 *   rather than trust a spend that disagrees with what was peeked.
 */
async function spendToken(presented, expectedSubjectId) {
  const spent = await redeemLinkToken(presented, PURPOSES);
  if (spent.subjectId !== expectedSubjectId) throw forbidden(LINK_REFUSED_TEXT);
  return spent;
}

/**
 * `POST /api/public/documents/view` — read the instrument and its frozen (or not-yet-frozen)
 * words, as the signer named in the link. `spend: false`: a signer who refreshes, or opens the
 * link on two devices, must not be locked out by the act of looking — CCR-10's whole point, and
 * this task's own instruction: "a GET that burns the token means a signer who refreshes the page
 * is locked out". (This is a POST, not a GET, because `runSignerScoped` reads the presented secret
 * from a JSON body — never a query string, where it would sit in server logs and browser history —
 * but the READ discipline is the same: `spend: false` is the right choice here for the identical
 * reason a GET would need it.)
 */
async function viewDocument({ db, c, tenantId, redeemed }) {
  const { role, person } = await resolveSigner(db, { instanceId: redeemed.subjectId, issuedTo: redeemed.issuedTo });

  const { rows } = await db.query(
    `SELECT i.id, i.title, i.state, i.builder, i.template_id, i.sent_at, i.template_body_snapshot,
            i.description, tpl.version AS template_version
       FROM keystone.document_instance i
       LEFT JOIN keystone.document_template tpl ON tpl.id = i.template_id
      WHERE i.id = $1 AND i.archived_at IS NULL`,
    [redeemed.subjectId]);
  // ★ Same refusal as an invalid link — never `notFound()`. See `resolveSigner`'s header note: in
  //   practice `resolveSigner` above already refused before this SELECT could return zero rows, but
  //   this stays fail-closed on its own rather than trusting that ordering forever.
  if (rows.length === 0) throw forbidden(LINK_REFUSED_TEXT);
  const row = rows[0];

  const name = await practiceName(db, tenantId);
  // ★ No field here is on the blocked list (DOB, sobriety date, recovery fields, notes, emergency
  //   contact, consent detail, guardian relationship) — title, state, dates, the frozen contract
  //   words this signer is about to sign, their OWN name and role, and the practice's name. That is
  //   everything a signer needs to read and sign, and nothing else.
  // ★★★ FIX, 30 Sep 2026 ("smart fields in the Message" brief) — the wizard's own Details step
  //     labels this field "Description — the client sees this", and nothing ever did: this line was
  //     always the generic sentence below, never `document_instance.description`, which was not even
  //     selected. The resolved (per-recipient, `{{name}}`-substituted) description now takes
  //     priority when the sender wrote one; the generic line is the fallback for a document sent
  //     with none, unchanged from before.
  const context_line = row.description?.trim()
    ? row.description.trim()
    : name
      ? `${name} sent you this to review and sign.`
      : "Review and sign this document.";

  await db.query(
    `INSERT INTO keystone.document_open (tenant_id, instance_id, opened_by, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, redeemed.subjectId, redeemed.issuedTo, c.get("clientIp") ?? null,
     c.req.header("user-agent") ?? null]);

  await emit(db, {
    tenantId, topic: "documents.document.opened", emittedBy: "documents",
    subjectType: "document", subjectId: redeemed.subjectId,
    actor: userActor(redeemed.issuedTo),
    payload: { role },
  });
  await recordAuditEvent(db, { tenantId, instanceId: redeemed.subjectId, kind: "opened" });
  await recordAuditEvent(db, { tenantId, instanceId: redeemed.subjectId, kind: "link_clicked" });

  return {
    document: {
      id: row.id, title: row.title, state: row.state, sent_at: row.sent_at,
      version: row.template_version ?? null,
    },
    snapshot: instrumentSnapshot(row),
    signer: { role, name: person.display_name ?? null },
    practice: { name },
    context_line,
  };
}

/**
 * `POST /api/public/documents/sign` — record the signature, execute if this was the last party,
 * spend the link last. `markDataUrl` is passed straight through to `recordSignature` as
 * `markImage` and NOTHING ELSE is derived from it here: `recordSignature` (`src/documents/
 * writes.mjs`, 25 Sep 2026 fix) derives `markSha256` from it itself, so passing a separately
 * computed digest here would risk the two disagreeing and being refused — the same reasoning the
 * coordinator's note gave. This route never logs, stores a second copy of, or echoes the mark or
 * the presented token in any response, error or event payload.
 */
async function signDocument({ db, c, body, tenantId, redeemed }) {
  const { presented, typedName, markDataUrl = null, signedLocalDate = null, signerTimezone = null } = body ?? {};
  const { role } = await resolveSigner(db, { instanceId: redeemed.subjectId, issuedTo: redeemed.issuedTo });

  await recordSignature(db, {
    tenantId, instanceId: redeemed.subjectId, role,
    signerName: typedName, signerUid: redeemed.issuedTo,
    signedLocalDate, signerTimezone,
    userAgent: c.req.header("user-agent") ?? null,
    signerIp: c.get("clientIp") ?? null,
    markImage: markDataUrl,
    actorUserId: redeemed.issuedTo,
  });

  // ★★★ 14.33's ONE execute path, for every signer — never a second one built here.
  const result = await executeIfComplete(db, {
    tenantId, instanceId: redeemed.subjectId, actorUserId: redeemed.issuedTo,
  });

  // ★ F130 (23 Oct 2026) — WHO SIGNS NEXT, so the signer's done screen tells the truth. It said "you'll get a PDF copy by email" while the
  //   document still waited on the practice's countersignature. `waitingOn` lists the roles still to sign; `practiceSignsNext` is true when
  //   the coach (the practice) is one of them — the signed copy is sent only once the document is final.
  let waitingOn = [];
  if (result?.state !== "executed") {
    const { rows: [inst] } = await db.query(
      `SELECT dt.signer_config FROM keystone.document_instance i LEFT JOIN keystone.document_type dt ON dt.id = i.type_id WHERE i.id = $1`, [redeemed.subjectId]);
    const { rows: signed } = await db.query(`SELECT DISTINCT role FROM keystone.signature_record WHERE instance_id = $1`, [redeemed.subjectId]);
    const done = new Set(signed.map((r) => r.role));
    waitingOn = (SIGNER_CONFIGS[inst?.signer_config] ?? []).filter((r) => !done.has(r));
  }

  // ★★★ SPEND LAST. See `spendToken`'s own header note for the whole guarantee.
  await spendToken(presented, redeemed.subjectId);

  return { ...result, waitingOn, practiceSignsNext: waitingOn.includes("coach") };
}

/**
 * `POST /api/public/documents/decline` — same peek-write-spend order as sign. `declineInstance`
 * itself asks no order question (unlike `recordSignature`, decline is not position-gated — any
 * named party still holding a valid link may decline the whole instrument), so `resolveSigner` is
 * used the same way, to name WHO declined rather than leaving `role` null.
 *
 * ★ MEASURED GAP, REPORTED, NOT FIXED HERE: `declineInstance` (`src/documents/writes.mjs:695-725`)
 *   never sets `document_instance.declined_at` — migration `0418:80-89` added that column
 *   specifically ("14.11 — when a signer declined the instrument") but the UPDATE at `writes.mjs
 *   :699-704` only sets `state` and `updated_at`. `src/documents/writes.mjs` is not in this task's
 *   file list, so this is named here rather than edited.
 */
async function declineDocument({ db, body, tenantId, redeemed }) {
  const { presented, reason = null } = body ?? {};
  const { role } = await resolveSigner(db, { instanceId: redeemed.subjectId, issuedTo: redeemed.issuedTo });

  const result = await declineInstance(db, {
    tenantId, instanceId: redeemed.subjectId, role, reason, actorUserId: redeemed.issuedTo,
  });

  await spendToken(presented, redeemed.subjectId);

  return result;
}

/**
 * `POST /api/documents/verify` — public PDF verification: anyone uploads a signed PDF and
 * receives whether it has been altered since signing. No session, no authentication, no account
 * required. ★ 20 MiB file-size cap, matching the pdf_import limit in `uploads.mjs` — the same
 * ceiling the platform enforces elsewhere on PDF uploads.
 */
async function verifyDocument(c) {
  const PDF_MAX_BYTES = 20 * 1024 * 1024; // Matching KIND_MAX_BYTES.pdf_import from uploads.mjs

  // ★ Parse the request body as binary — standard multipart or raw PDF bytes.
  const contentType = c.req.header("content-type") ?? "";
  let pdfBuffer;

  if (contentType.includes("application/pdf")) {
    // ★ Raw PDF binary body
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) {
      throw invalid("No PDF file provided.", { field: "file" });
    }
    if (body.byteLength > PDF_MAX_BYTES) {
      const maxMb = Math.round(PDF_MAX_BYTES / (1024 * 1024));
      throw invalid(`That one's over ${maxMb} MB — try a smaller file.`, { field: "file" });
    }
    pdfBuffer = Buffer.from(body);
  } else if (contentType.includes("multipart/form-data")) {
    // ★ Multipart form data — look for a 'file' field
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw invalid("No PDF file provided. Use a 'file' field in the form.", { field: "file" });
    }
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw invalid("The uploaded file is empty.", { field: "file" });
    }
    if (bytes.byteLength > PDF_MAX_BYTES) {
      const maxMb = Math.round(PDF_MAX_BYTES / (1024 * 1024));
      throw invalid(`That one's over ${maxMb} MB — try a smaller file.`, { field: "file" });
    }
    pdfBuffer = Buffer.from(bytes);
  } else {
    throw invalid(
      "Upload the PDF as 'application/pdf' binary or as 'multipart/form-data' with a 'file' field.",
      { field: "content-type" }
    );
  }

  const result = verifySignedPdf(pdfBuffer);
  return result;
}

/**
 * `registerPublicDocumentRoutes(app, { runSignerScoped })` — the phone signing screen's whole
 * surface: read, sign, decline, with no account. `runSignerScoped` is `src/http/app.mjs`'s own
 * (task 14.32's REFRESH of it); nothing here re-implements any part of it.
 */
export function registerPublicDocumentRoutes(app, { runSignerScoped } = {}) {
  // ★ spend:false — a read must not consume the one-time credential (CCR-10).
  app.post("/api/public/documents/view", (c) =>
    runSignerScoped(c, viewDocument, { expectedPurposes: PURPOSES, spend: false })
      .then((r) => c.json(r, 200)));

  // ★ spend:false at the DOOR — the write happens first, the real spend happens last, inside the
  //   handler (`spendToken`). A `POST … {status: 201}` route outside `writes.mjs`'s `ROUTES` table
  //   answers 200 unless it declares otherwise (CT-F51); this declares 201, matching the CRM's own
  //   `/api/documents/sign` (`writes.mjs`'s `WRITE_STATUS`) and this task's own field 9.
  app.post("/api/public/documents/sign", (c) =>
    runSignerScoped(c, signDocument, { expectedPurposes: PURPOSES, spend: false })
      .then((r) => c.json(r, 201)));

  // ★ Same shape as sign: a real state change to the instrument, declared 201 for the same reason
  //   (the task brief gives no explicit status for decline; 201 is the measured, consistent choice
  //   — reported in the build summary rather than assumed silently).
  app.post("/api/public/documents/decline", (c) =>
    runSignerScoped(c, declineDocument, { expectedPurposes: PURPOSES, spend: false })
      .then((r) => c.json(r, 201)));

  // ★ Public PDF verification: anyone can upload a signed PDF to check if it has been altered.
  //   No session, no authentication, matching the file-size cap from uploads.mjs.
  app.post("/api/documents/verify", (c) =>
    verifyDocument(c).then((r) => c.json(r, 200)));
}
