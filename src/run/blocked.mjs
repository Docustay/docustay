/**
 * THE FIVE FACTS — P20.9a. "FIVE STATES, NOT ONE BOOLEAN, OR THE SCREEN WILL LIE."
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ ADD3-2 GIVES ONE BIT (`ok`). P20.9a's finding is that five distinguishable facts have to land
 *     somewhere, and **THREE OF THEM WOULD ALL READ "BILLED AND NOT DELIVERABLE", TWO OF THEM
 *     FALSELY.** This module is the one place those five are named, told apart, and given words.
 *
 * ★★★ AND THE EXPENSIVE ONE IS LAST, NOT FIRST: *"Billing a client and then calling their own real
 *     zero a delivery failure is the most expensive version of this bug."* A brand-new GA4 property
 *     returns `ok=true, row_count=0` and renders identically to a broken pull. It is NOT a failure, it
 *     gets NO task, and the screen says "no data yet".
 *
 * ★★ EACH FACT CARRIES ITS OWN `screenText` AND ITS OWN `taskTitle`, AND NO TWO ARE THE SAME. P20.9a
 *    requires exactly that, and the reason is that the three blocked facts need THREE DIFFERENT HUMAN
 *    ACTIONS — ask for access, ask to re-consent, re-link a property. Telling a client to re-consent
 *    when they removed one property is, in P20.9a's words, "how you lose them".
 */

/**
 * ★★★ THE FIVE, IN THE ORDER P20.9a LISTS THEM.
 *
 * `taskTitle: null` is a DECISION, not an omission: `transient` and `genuinely_zero` must NOT raise a
 * blocking task. A task for a 429 is the checker crying wolf; a task for a real zero is billing a
 * client and then calling their own data a failure.
 */
export const RUN_FACTS = Object.freeze({
  never_granted: {
    state: "not_deliverable_no_grant",
    screenText: "not connected — this account has never granted access",
    taskTitle: "Ask the client to connect this account",
    // ★★★ A LOCAL FACT, AND IT MUST STAY LOCAL. P20.9a: *"Must NEVER require a Google call, or an
    //     outage makes un-onboarded accounts look healthy."* That inversion is the trap — during a
    //     Google outage the probe fails, and if absence-of-grant were inferred from a failed probe, the
    //     accounts that never connected would be the ones reported as merely degraded.
    detection: "the ABSENCE of a live account_grant row. No Google call, ever.",
    billed: true,
  },
  grant_lost: {
    state: "not_deliverable_grant_lost",
    // ★★★ IT DOES NOT SAY "REVOKED", AND THAT IS THE MOST IMPORTANT STRING IN THIS FILE.
    //     invalid_grant covers at least SIX causes — the user revoked, six months idle, the 7-day
    //     expiry that applies while publishing status is Testing, the 100-token eviction, a Workspace
    //     admin restricting the service, a Google security heuristic. The only claim true of all six
    //     is that somebody has to consent again.
    screenText: "re-consent required — Google is no longer accepting the stored authorisation",
    taskTitle: "Ask the client to re-connect (re-consent) this account",
    detection: "PROBE A fails: 400 invalid_grant at the token endpoint, on consecutive attempts.",
    billed: true,
  },
  resource_lost: {
    state: "not_deliverable_resource_lost",
    screenText: "the property is gone — the authorisation still works, but this property no longer exists",
    taskTitle: "Re-link the property for this account",
    // ★★★ THE PAIRING IS THE WHOLE DISCRIMINATOR. P20.9a: *"PROBE A SUCCEEDS, PROBE B FAILS."*
    //     The token still refreshes; the resource stopped coming back from discovery. Corroborated by
    //     google_resource.disappeared_at.
    detection: "PROBE A SUCCEEDS and PROBE B FAILS, corroborated by google_resource.disappeared_at.",
    billed: true,
  },
  transient: {
    state: "degraded",
    screenText: "temporary problem — the last attempt failed, showing the last good reading",
    // ★★ NO TASK. P20.9a: the signal is not the status code, it is consecutive_failures < threshold,
    //    and *"a checker that cries wolf is worse than none"*. A task for every 429 trains an operator
    //    to close tasks without reading them.
    taskTitle: null,
    detection: "any failure class while consecutive_failures is below the threshold. NOT a status code.",
    billed: true,
  },
  genuinely_zero: {
    state: "healthy",
    screenText: "no data yet — read successfully, and there is nothing to report",
    // ★★★ NO TASK, AND NOT NOT-DELIVERABLE. This is P20.9a's "most expensive version of this bug":
    //     billing a client and then calling their own real zero a delivery failure.
    taskTitle: null,
    detection: "ok=true with row_count=0. A successful read of an empty property.",
    billed: true,
  },
});

/** ★ Exported so a gate can assert the count is FIVE and that no two texts collide. */
export const RUN_FACT_KEYS = Object.freeze(Object.keys(RUN_FACTS));

/**
 * CLASSIFY one schedule item into exactly one of the five.
 *
 * ★★★ THE ORDER OF THESE BRANCHES IS THE ARGUMENT. `never_granted` is tested FIRST and from LOCAL data
 *     only, so no Google outcome can ever override it. Then the pairing: an unusable identity is
 *     `grant_lost`; a usable identity with a vanished resource is `resource_lost`. Only then do we look
 *     at the reading, because a failed probe cannot tell those two apart on its own — which is exactly
 *     why P20.9a calls the pairing "the whole discriminator".
 *
 * @param {object} a
 * @param {object} a.grant      the result of resolveGrant() — LOCAL, never a Google call
 * @param {object|null} a.reading  the newest reading, or null
 * @param {number} a.consecutiveFailures
 * @param {number} a.loseAfter  the threshold from schedule.mjs, passed in so there is ONE number
 */
export function classifyRunFact({ grant, reading, consecutiveFailures = 0, loseAfter = 3 }) {
  // ★★★ 1 · NEVER GRANTED — LOCAL, FIRST, AND UNCONDITIONAL. `resolveGrant` reads three of our own
  //     tables and makes no request. During a total Google outage this branch still answers correctly,
  //     which is the property P20.9a insists on.
  if (grant?.because === "no_grant") return { key: "never_granted", ...RUN_FACTS.never_granted };

  // ★★ 2 · RESOURCE LOST — checked BEFORE grant_lost when the local corroboration is already present.
  //    `disappeared_at` means discovery stopped returning it WHILE the token kept refreshing: that is
  //    PROBE A SUCCEEDING and PROBE B FAILING, recorded locally so the screen need not re-probe.
  if (grant?.because === "resource_lost") return { key: "resource_lost", ...RUN_FACTS.resource_lost };

  // ★★ 3 · GRANT LOST — an identity Google will not accept. Only counts once it has persisted, because
  //    a single invalid_grant can be a transient Google error and this state sends a human to the
  //    client.
  if (grant?.because === "grant_unusable" && consecutiveFailures >= loseAfter) {
    return { key: "grant_lost", ...RUN_FACTS.grant_lost };
  }

  // ★★ 4 · TRANSIENT — a recent failure that has not yet persisted. Includes an unusable grant below
  //    the threshold, which is the case a status-code-driven classifier would wrongly escalate.
  if (reading && reading.ok === false) return { key: "transient", ...RUN_FACTS.transient };
  if (grant?.because === "grant_unusable") return { key: "transient", ...RUN_FACTS.transient };

  // ★★★ 5 · GENUINELY ZERO — a SUCCESS that returned nothing. Tested only after every failure branch,
  //     so a zero can never be reached by a broken pull.
  if (reading && reading.ok === true && reading.row_count === 0) {
    return { key: "genuinely_zero", ...RUN_FACTS.genuinely_zero };
  }

  // ★ Everything else is a healthy reading with rows. Returned as null rather than a sixth fact,
  //   because "it is working" is the absence of a finding, not a finding.
  return null;
}

/**
 * ★★ P20.9c — A LIABILITY FACT, RECORDED WHERE IT BELONGS AND NOT IN A `scope` COLUMN.
 *
 * ★★★ TWO OF THE FOUR SCOPES HAVE NO READ-ONLY FORM. [MEAS] Google Ads is
 *     `https://www.googleapis.com/auth/adwords` (singular, no `.readonly` variant) and Business
 *     Profile is `https://www.googleapis.com/auth/business.manage`. **So connecting a client "for
 *     read-only reporting" NECESSARILY hands this product full WRITE authority over their ad spend and
 *     their public business profile.**
 *
 * ★★ P20.9c's instruction is exact about where this goes: *"It belongs in the consent copy and in the
 *    contract — NOT in a `scope` column that pretends there was a choice."* So there is deliberately NO
 *    `read_only` boolean and no per-scope permission column anywhere in 0057 — a column implying a
 *    choice would be a lie in the schema, and the product's own UI would then display it as a setting.
 *  ★ These strings are exported so the CONSENT SCREEN renders them verbatim, and a gate can assert the
 *    two unavoidable-write scopes are disclosed rather than described as read-only.
 */
export const SCOPE_DISCLOSURE = Object.freeze({
  "https://www.googleapis.com/auth/webmasters.readonly": {
    service: "search_console", writeAuthority: false,
    disclosure: "Read-only access to your Search Console data.",
  },
  "https://www.googleapis.com/auth/analytics.readonly": {
    service: "analytics", writeAuthority: false,
    disclosure: "Read-only access to your Google Analytics data.",
  },
  "https://www.googleapis.com/auth/adwords": {
    service: "google_ads", writeAuthority: true,
    // ★★★ SAID PLAINLY, ON THE CONSENT SCREEN, BECAUSE IT IS TRUE AND UNAVOIDABLE.
    disclosure:
      "Full access to your Google Ads account. ★ Google does not offer a read-only version of this " +
      "permission, so granting it gives this application the technical ability to CHANGE YOUR " +
      "ADVERTISING — including what you spend. We use it only to read reports; the limit is our " +
      "agreement with you, not a restriction Google enforces.",
  },
  "https://www.googleapis.com/auth/business.manage": {
    service: "business_profile", writeAuthority: true,
    disclosure:
      "Full management access to your Google Business Profile. ★ Google does not offer a read-only " +
      "version of this permission, so granting it gives this application the technical ability to " +
      "CHANGE YOUR PUBLIC LISTING — your hours, your posts and your replies to reviews. We use it " +
      "only to read reviews and insights; the limit is our agreement with you, not a restriction " +
      "Google enforces.",
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A10.1 — THE GMAIL SCOPES JOIN **THIS** CONSENT. ONE CONSENT, ONE ROW, THE UNION OF THE
  //     SCOPES. [TY, RULED] — and the reason is MECHANICAL, not a preference about how many
  //     dialogs somebody sees.
  //
  //   `google_identity`'s UNIQUE is **(tenant_id, google_subject, scopes)**, and `grants.mjs`
  //   SORTS the scopes before storage precisely because *"{a,b} and {b,a} are DIFFERENT values…
  //   a second row means a second live refresh token on the same Google account, walking straight
  //   into the 100-token eviction this whole design exists to avoid."*
  //   ★★★ SO A SEPARATE GMAIL CONSENT DOES NOT MERELY ANNOY THE USER — **IT CREATES A SECOND ROW
  //       AND A SECOND LIVE REFRESH TOKEN ON ONE GOOGLE ACCOUNT, AND GOOGLE EVICTS AT 100.** The
  //       existing design already fought this battle; asking twice would lose it.
  //
  // ★★ AND THE MODEL STAYS PER-USER OAuth. Domain-wide delegation is disqualified three times
  //    over: Google says avoid it ("only when you have a critical business case that requires an
  //    app to bypass user consent"), it needs each tenant's Workspace SUPER ADMINISTRATOR, and the
  //    impersonated user "must be a user which belongs to your Workspace account" — **so a coach on
  //    personal Gmail cannot be reached by it at all.** No Workspace super-admin appears anywhere in
  //    this design and the plan must not drift back toward a service account.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  "https://www.googleapis.com/auth/gmail.settings.basic": {
    service: "gmail_settings", writeAuthority: false,
    // ★★ THIS IS THE ONE `sendAs.list` NEEDS, AND IT IS THE SMALLEST THAT WORKS. Enumerating the
    //    addresses a mailbox may send from does not require read access to any message.
    disclosure:
      "Read the list of addresses this mailbox is allowed to send from. ★ This does not let us read, " +
      "send or delete any of your mail — it only tells us which \u201cfrom\u201d addresses are available.",
  },
  "https://www.googleapis.com/auth/gmail.send": {
    service: "gmail_send", writeAuthority: true,
    // ★★★ DISCLOSED THE SAME WAY `adwords` IS, BECAUSE IT IS THE SAME KIND OF FACT: a permission
    //     whose authority exceeds the use. Gmail has no "send only these messages" scope.
    //   ★ It is deliberately NOT `gmail.modify` or `gmail.compose`, which would also grant READ of
    //     the mailbox. `gmail.send` is the narrowest scope that can send at all.
    disclosure:
      "Send email as this address. ★ Google does not offer a narrower version of this permission, so " +
      "granting it gives this application the technical ability to SEND MAIL THAT APPEARS TO COME " +
      "FROM YOU. We use it only for the messages your practice has turned on — reminders, documents, " +
      "invoices and receipts — and never for anything you have not asked for. The limit is our " +
      "agreement with you, not a restriction Google enforces. ★ It does NOT let us read your mail.",
  },
});

/**
 * ★★★ THE SCOPES THAT MAKE A MAILBOX A SENDER. Named as a set so the consent screen, `sendAs`
 *     enumeration and `resolveSender` all agree about what a "usable" sending grant contains —
 *     and so a gate can assert that an identity WITHOUT them is never offered as a sender.
 * ★★ AUTH MAIL NEVER USES THESE. A sign-in link is a CREDENTIAL and is sent by Resend, always,
 *    with no toggle: if the mailbox is broken and password resets go through it, **nobody can get in
 *    to fix it.** That is why `sender_routing.purpose` has no `auth` value at all — see 0126.
 */
export const GMAIL_SENDER_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/gmail.send",
]);

/** ★ The two scopes whose write authority is unavoidable. Exported so a gate asserts the disclosure
 *   exists for exactly these, and that nothing calls them read-only. */
export const UNAVOIDABLE_WRITE_SCOPES = Object.freeze(
  Object.entries(SCOPE_DISCLOSURE).filter(([, v]) => v.writeAuthority).map(([k]) => k));
