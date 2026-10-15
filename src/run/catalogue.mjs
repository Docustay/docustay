/**
 * THE RUN ITEM CATALOGUE — P20.7a and P20.7b's decisions, made ENFORCEABLE rather than written down.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ BOTH ITEMS DEMAND A DECISION AND SAY WHAT HAPPENS IF IT IS DUCKED:
 *       P20.7a — *"EITHER add a run_action table with those, OR CUT negatives/posts/replies/hours from
 *                scope AND SAY SO IN THIS DOCUMENT. ★ Do not leave the nouns in the service list with
 *                nothing behind them — that is the §M2 'emits into nothing' failure repeating."*
 *       P20.7b — *"DROP the promise or REDEFINE it as URL-Inspection sampling and say the cap on the
 *                screen."*
 *
 * ★★★ THE DECISIONS, AND THEY ARE RECORDED AS DATA SO THEY CANNOT QUIETLY LAPSE:
 *       P20.7a → **CUT.** The four write items are removed from launch scope, NAMED here with the
 *                reason, and `isCutItem()` makes creating a schedule item for one impossible.
 *       P20.7b → **REDEFINE.** `index_coverage` does not exist as an API resource and is named as
 *                unbuildable; `url_inspection` replaces it as an explicitly SAMPLED item carrying its
 *                own quota cap, which the screen is required to show.
 *
 * ★★ WHY A MODULE AND NOT A PARAGRAPH. A cut recorded only in prose is a cut that comes back: the next
 *    session reads "Business Profile (posts, hours, reviews)" in the service list, sees no code saying
 *    otherwise, and builds it. Naming the cut items HERE means the attempt fails at
 *    `createScheduleItem()` with the reason attached — which is the difference between a decision and
 *    an intention.
 */

/**
 * ★★★ P20.7a — THE FOUR WRITE ITEMS, CUT FROM LAUNCH SCOPE, EACH WITH ITS OWN REASON.
 *
 *     ADD3-2's service list says "Google Ads (search terms, NEGATIVES, spend)" and "Business Profile
 *     (POSTS, hours, REVIEWS)". Adding a negative keyword, publishing a post, replying to a review and
 *     changing opening hours are WRITES against a client's live Google property. P20.7a is right that
 *     there is no `run_action` table, no queue, no idempotency key, no optimistic-update-then-reconcile
 *     and no state for "submitted to Google but not yet in the cache".
 *
 * ★★★ WHY CUT RATHER THAN BUILD, STATED AS A DECISION I MADE AND NOT AS A CONSTRAINT I FOUND:
 *   1. THE CORRECT SHAPE IS A PHASE, NOT AN ITEM. A write path needs a durable action row, an
 *      idempotency key that survives a retry, a reconcile pass that compares what we asked for against
 *      what the next read shows, and a state for the window between them. `run_reading` is a CACHE and
 *      offers the opposite guarantees — it is allowed to be stale and is allowed to be pruned.
 *   2. ★★ THE BLAST RADIUS IS PUBLIC AND NOT OURS TO UNDO. A published Business Profile post and a
 *      reply to a customer's review are visible to that client's customers the moment they land. A
 *      duplicate from a retry is not a row to clean up; it is a second public reply under somebody's
 *      name. Reads have no equivalent failure.
 *   3. A NEGATIVE KEYWORD CHANGES WHAT A CLIENT SPENDS. Applying one twice, or applying one whose
 *      request we cannot prove, moves money in an account we do not own.
 *   4. P20.9b already puts THREE HUMAN APPROVAL GATES on this phase's critical path and P20.9d holds
 *      the end-to-end proof until the OAuth app is "In production" — so even the READ path is not yet
 *      exercised against live Google. Adding writes behind an unexercised read path would be building
 *      the riskiest surface on the least-tested foundation.
 *
 * ★ WHAT THIS COSTS, SAID PLAINLY: the product reads Google and cannot act on it. An operator sees a
 *   bad search term and changes it in the Google UI themselves. That is a real reduction in what was
 *   promised, and it is the honest version of the promise.
 */
export const CUT_WRITE_ITEMS = Object.freeze({
  negatives: {
    service: "google_ads",
    reason:
      "P20.7a — CUT. Adding a negative keyword is a WRITE that changes what a client SPENDS in an " +
      "account we do not own. It needs a durable action row with an idempotency key that survives a " +
      "retry, because applying one twice — or applying one whose request we cannot prove — is a money " +
      "consequence, not a duplicate row.",
  },
  posts: {
    service: "business_profile",
    reason:
      "P20.7a — CUT. A published post is visible to the client's customers the moment it lands, so a " +
      "retry duplicate is not a row to clean up — it is a second public post. There is no " +
      "submitted-but-not-yet-in-cache state to make a retry safe.",
  },
  review_replies: {
    service: "business_profile",
    reason:
      "P20.7a — CUT. Replying to a review writes PUBLIC TEXT under the client's name. Without " +
      "optimistic-update-then-reconcile, a timeout after the reply landed is indistinguishable from " +
      "one before it — and the safe-looking action (retry) is the one that posts twice.",
  },
  hours: {
    service: "business_profile",
    reason:
      "P20.7a — CUT. Opening hours drive whether customers are told a business is open. A write we " +
      "cannot confirm, on a cache that is allowed to be stale, can leave the product showing hours it " +
      "did not manage to set — which is worse than not offering the feature.",
  },
});

/**
 * ★★★ P20.7b — `index_coverage` CANNOT BE BUILT, AND THE REPLACEMENT CARRIES ITS OWN CAP.
 *
 *     [MEAS] The complete Search Console API resource list is `searchanalytics` · `sitemaps` · `sites`
 *     · `urlInspection`. **THERE IS NO INDEX COVERAGE RESOURCE.** The Index Coverage report exists in
 *     the Search Console UI and has no API behind it.
 *   ★★ The nearest thing is URL Inspection, which is PER-URL and capped at **2,000 queries per day per
 *      site**. That is a SAMPLING tool, not a coverage report: a site with 50,000 URLs cannot be
 *      surveyed, and presenting a sample as coverage would be a number that looks like a total.
 *   ★ DECISION: REDEFINE. `url_inspection` is in scope as an explicitly sampled item, and
 *     `SAMPLED_ITEMS` carries the cap so the SCREEN can state it — P20.7b requires the cap to be shown,
 *     and a screen that has to know the number itself is a screen that can be wrong about it.
 */
export const UNBUILDABLE_ITEMS = Object.freeze({
  index_coverage: {
    service: "search_console",
    reason:
      "P20.7b — DOES NOT EXIST. [MEAS] the complete Search Console API resource list is searchanalytics " +
      "· sitemaps · sites · urlInspection. The Index Coverage report is a Search Console UI feature with " +
      "NO API behind it. ★ Promising it would be promising a number nothing can produce.",
    replacement: "url_inspection",
  },
});

/**
 * ★★ ITEMS WHOSE NUMBERS ARE A SAMPLE, WITH THE CAP THAT MAKES THEM ONE. The screen MUST show this —
 *    an unlabelled sample presented next to real totals is read as a total.
 */
export const SAMPLED_ITEMS = Object.freeze({
  url_inspection: {
    service: "search_console",
    quotaPerDay: 2000,
    quotaScope: "per site",
    screenLabel: "sampled — URL Inspection allows 2,000 URLs per day per site",
    reason:
      "P20.7b — the replacement for the absent index_coverage resource. It is PER-URL and capped, so a " +
      "site with more URLs than the daily quota can only ever be sampled. ★ The cap lives here so the " +
      "screen states it; a screen that has to know the number itself is a screen that can be wrong.",
  },
});

/**
 * ★ THE READ ITEMS THAT ARE ACTUALLY IN SCOPE, per service. A closed list, so "what does Run do" has
 *   one answer that code can check rather than four prose descriptions that drift.
 */
export const RUN_ITEMS = Object.freeze({
  search_console: Object.freeze(["queries", "pages", "sitemaps", "url_inspection"]),
  analytics: Object.freeze(["sessions", "conversions", "traffic_sources"]),
  google_ads: Object.freeze(["search_terms", "spend", "campaign_performance"]),
  business_profile: Object.freeze(["reviews", "insights"]),
  monitoring: Object.freeze(["uptime"]),
});

/**
 * ★★★ THE ENFORCER. `createScheduleItem()` calls this, so a cut item cannot be put on the clock —
 *     which is what turns P20.7a's decision from an intention into a fact.
 *
 * @returns {null | {kind: 'cut'|'unbuildable', reason: string, replacement?: string}}
 */
export function itemObjection(service, item) {
  const cut = CUT_WRITE_ITEMS[item];
  if (cut && cut.service === service) return { kind: "cut", reason: cut.reason };

  const gone = UNBUILDABLE_ITEMS[item];
  if (gone && gone.service === service) {
    return { kind: "unbuildable", reason: gone.reason, replacement: gone.replacement };
  }

  const allowed = RUN_ITEMS[service];
  if (allowed && !allowed.includes(item)) {
    return {
      kind: "unknown",
      reason:
        `"${item}" is not one of the ${service} items in scope (${allowed.join(", ")}). ★ RUN_ITEMS is ` +
        `a CLOSED list on purpose: "what does Run actually do" must have one answer code can check, ` +
        `rather than four prose service descriptions that drift apart.`,
    };
  }
  return null;
}

/**
 * ★ Does this item's number need a "sampled" label on the screen? Returns the label, or null.
 *   P20.7b requires the cap to be SHOWN, so the screen asks rather than remembering.
 */
export function samplingLabel(item) {
  return SAMPLED_ITEMS[item]?.screenLabel ?? null;
}
