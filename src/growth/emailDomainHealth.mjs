/**
 * `src/growth/emailDomainHealth.mjs` — Task 16.58 / CT-F43 (CONTRACTS.md §"Stage 17 — CT-F43 …
 * CT-F44"; frozen 25 Sep 2026, critic D5-3).
 *
 * ★★★ ONE READ BEHIND THREE SURFACES. The incident screen, the settings-hub chip and the Home
 *     `dns_broken` prompt each need the same answer to "is this practice's email broken" — three
 *     surfaces running three separate queries is how a practice is told its email is fine on one
 *     screen and broken on another. This is that one read.
 *
 * ★★★ `unknown` IS A REAL ANSWER AND MUST NEVER RENDER AS `ok`. A read that could not determine the
 *     state (no routing at all, a sending-domain step still mid-flight, or the query itself throwing
 *     for a reason other than a refusal) returns `'unknown'`, never `'ok'`. See §7 "DATA" of
 *     STAGE-16-PLAN.md task 16.58: on production TODAY, every one of the nine real practices resolves
 *     to `state:'unknown'` — no `sender_routing` row, and a `resend_domain` provisioning step still
 *     `pending`. A function that folded "I do not know" into `ok` would tell all nine their email is
 *     fine right now.
 *
 * ★ The frozen return shape (CT-F43, not this module's to change):
 *     { state: 'ok' | 'broken' | 'unknown', brokeAt, cause, address,
 *       record: { type, name, value } | null,
 *       since: { sentFromOurs, spam, usualSpam } | null,
 *       cloudflareConnected: boolean }
 */

// ★★ Copied verbatim from `src/routes/webhooks.mjs`'s `"email.complained"` branch — the ONLY writer
//    of this string onto `notification_delivery.error`. Named here so the two can be grepped
//    together (`grep -rn "the recipient marked it as spam" src/`) rather than drifting apart the day
//    either side is re-worded.
const SPAM_COMPLAINT_ERROR = "the recipient marked it as spam";

/**
 * ★★★ `record` IS `null`, ALWAYS, TODAY (PC-9). The DNS checklist a domain-failure incident would
 *     show is built by `buildDnsChecklist` and returned from `registerSendingDomain`
 *     (`src/provisioning/steps/resendDomain.mjs:117`) and **is stored nowhere** — EXECUTED
 *     `grep -rn "dnsChecklist" src/ webui/src` → one hit, the line that builds it;
 *     `grep -rn "external_ref" src/` → zero writers. `null` here means "we do not have the line",
 *     never "no record is needed" — the consuming screen renders the ask-your-provider path, not an
 *     empty code block. This module does not invent a record, does not call Resend from a page read,
 *     and does not add a migration.
 * ★★ `cloudflareConnected` IS `false`, ALWAYS, TODAY. EXECUTED `grep -rlin cloudflare src webui/src
 *    db` → `src/http/turnstile.mjs` only, which is Cloudflare Turnstile (the CAPTCHA), not DNS. There
 *    is no Cloudflare DNS integration in any stage. The key stays because CT-F43 freezes the shape;
 *    the day an integration lands exactly one line changes.
 */
const RECORD_NOT_STORED = null;
const CLOUDFLARE_CONNECTED = false;

/**
 * getEmailDomainHealth(db, tenantId) → the frozen CT-F43 shape.
 *
 * `state` resolution order (the order IS the decision — STAGE-16-PLAN.md task 16.58 field 4):
 *   1. 'broken' — the mailbox-consent query returns a row (grant_state IN reconsent_required,
 *      withdrawn), OR the tenant's `resend_domain` provisioning_step is state='failed'.
 *   2. 'ok'     — a sender_routing row exists whose sender_identity.verified_at IS NOT NULL, and
 *                 neither broken condition holds.
 *   3. 'unknown' otherwise — no routing row at all, a resend_domain step still
 *                 pending/running/awaiting_human, or no resend_domain step row. Also returned when
 *                 the read itself throws for a reason other than a refusal.
 */
export async function getEmailDomainHealth(db, tenantId) {
  try {
    // ── the mailbox-consent signal (statusFor's own query, src/routes/settings.mjs:330-337) ──
    const { rows: mailboxRows } = await db.query(
      `SELECT si.email, gi.grant_state, gi.withdrawn_at, gi.grant_failed_at
         FROM keystone.sender_routing sr
         JOIN keystone.sender_identity si ON si.id = sr.sender_identity_id
         JOIN keystone.google_identity gi ON gi.id = si.google_identity_id
        WHERE sr.tenant_id = $1 AND gi.grant_state IN ('reconsent_required', 'withdrawn')
        LIMIT 1`,
      [tenantId]);
    const mailboxBroken = mailboxRows[0] ?? null;

    // ── the sending-domain signal: the tenant's own resend_domain provisioning_step ──
    // ★ `provisioning_step` has NO `tenant_id` of its own (0004_provisioning.sql:20-22) — reached
    //   only through `provisioning_run.tenant_id`, and the join binds the tenant explicitly rather
    //   than relying on RLS to carry it (db/gates/tenant-predicate-lint.mjs).
    const { rows: domainRows } = await db.query(
      `SELECT ps.state, ps.completed_at
         FROM keystone.provisioning_step ps
         JOIN keystone.provisioning_run pr ON pr.id = ps.run_id
        WHERE pr.tenant_id = $1 AND ps.name = 'resend_domain'
        ORDER BY ps.created_at DESC
        LIMIT 1`,
      [tenantId]);
    const domainStep = domainRows[0] ?? null;

    // ── the "is there a live, verified route at all" signal, for the 'ok' branch ──
    const { rows: verifiedRows } = await db.query(
      `SELECT 1
         FROM keystone.sender_routing sr
         JOIN keystone.sender_identity si ON si.id = sr.sender_identity_id
        WHERE sr.tenant_id = $1 AND si.verified_at IS NOT NULL
        LIMIT 1`,
      [tenantId]);
    const hasVerifiedRoute = verifiedRows.length > 0;

    let state, brokeAt = null, cause = null, address = null;

    if (mailboxBroken) {
      state = 'broken';
      address = mailboxBroken.email;
      brokeAt = mailboxBroken.withdrawn_at ?? mailboxBroken.grant_failed_at;
      cause = mailboxBroken.grant_state === 'withdrawn'
        ? 'mailbox_consent_withdrawn' : 'mailbox_reconsent_required';
    } else if (domainStep && domainStep.state === 'failed') {
      state = 'broken';
      brokeAt = domainStep.completed_at;
      cause = 'sending_domain_failed';
    } else if (hasVerifiedRoute) {
      state = 'ok';
    } else {
      // ★ Not broken and not confirmed ok: no routing row at all, a resend_domain step still
      //   pending/running/awaiting_human, or no resend_domain step row. `unknown`, never `ok`.
      state = 'unknown';
    }

    // ── `address` from whatever is routed, when the mailbox-broken branch above did not already
    //    set it (a domain-failure `broken` can still have a routed address — the mailbox itself may
    //    be fine even though the sending domain is not) ──
    if (address === null) {
      const { rows: routedRows } = await db.query(
        `SELECT si.email
           FROM keystone.sender_routing sr
           JOIN keystone.sender_identity si ON si.id = sr.sender_identity_id
          WHERE sr.tenant_id = $1
          LIMIT 1`,
        [tenantId]);
      address = routedRows[0]?.email ?? null;
    }

    // ── `since`: null unless broken with a real brokeAt ──
    let since = null;
    if (state === 'broken' && brokeAt) {
      const nowRows = (await db.query(`SELECT now() AS n`)).rows;
      const now = nowRows[0].n;
      const brokeAtMs = new Date(brokeAt).getTime();
      const nowMs = new Date(now).getTime();
      const windowMs = nowMs - brokeAtMs;
      const priorStart = new Date(brokeAtMs - windowMs);

      // ★ EXACT rather than approximate, because of what `brokeAt` means: the practice's own
      //   address was unusable for the entire window, so every email in it went from the platform
      //   address. Not a per-sender join against a column that does not exist.
      const { rows: sentRows } = await db.query(
        `SELECT count(*)::int AS n
           FROM keystone.notification_delivery
          WHERE tenant_id = $1 AND channel = 'email' AND status IN ('sent', 'delivered')
            AND attempted_at >= $2::timestamptz`,
        [tenantId, brokeAt]);
      const sentFromOurs = sentRows[0].n;

      const { rows: spamRows } = await db.query(
        `SELECT count(*)::int AS n
           FROM keystone.notification_delivery
          WHERE tenant_id = $1 AND channel = 'email' AND status = 'failed'
            AND error = $2 AND attempted_at >= $3::timestamptz`,
        [tenantId, SPAM_COMPLAINT_ERROR, brokeAt]);
      const spam = spamRows[0].n;

      // ★ usualSpam: the equal-length window immediately BEFORE brokeAt. `null`, not `0`, when
      //   that earlier window had NO email at all — "nothing to compare with" and "you used to have
      //   none" are different facts, and one of them makes the drawn sentence a lie.
      const { rows: priorAnyRows } = await db.query(
        `SELECT count(*)::int AS n
           FROM keystone.notification_delivery
          WHERE tenant_id = $1 AND channel = 'email'
            AND attempted_at >= $2::timestamptz AND attempted_at < $3::timestamptz`,
        [tenantId, priorStart.toISOString(), brokeAt]);
      const priorAny = priorAnyRows[0].n;

      let usualSpam = null;
      if (priorAny > 0) {
        const { rows: priorSpamRows } = await db.query(
          `SELECT count(*)::int AS n
             FROM keystone.notification_delivery
            WHERE tenant_id = $1 AND channel = 'email' AND status = 'failed'
              AND error = $2
              AND attempted_at >= $3::timestamptz AND attempted_at < $4::timestamptz`,
          [tenantId, SPAM_COMPLAINT_ERROR, priorStart.toISOString(), brokeAt]);
        usualSpam = priorSpamRows[0].n;
      }

      since = { sentFromOurs, spam, usualSpam };
    }

    return {
      state, brokeAt, cause, address,
      record: RECORD_NOT_STORED,
      since,
      cloudflareConnected: CLOUDFLARE_CONNECTED,
    };
  } catch (err) {
    // ★★ A read that could not run is not a clean bill of health. `unknown` is returned, never
    //    `ok`, and the error is not swallowed silently from the caller's perspective — it is turned
    //    into the same real, distinct answer the rest of this module returns when it does not know.
    return {
      state: 'unknown', brokeAt: null, cause: null, address: null,
      record: RECORD_NOT_STORED,
      since: null,
      cloudflareConnected: CLOUDFLARE_CONNECTED,
    };
  }
}
