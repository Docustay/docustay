// P1.4 — WHERE EACH OBJECT KEEPS ITS OWNER.
//
// ★ Imports the closed set so `permissionObjectFor` (below) can REFUSE a word no role can hold.
//   `objects.mjs` imports nothing, so this does not cycle.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE SCOPE AXIS ASKS ONE QUESTION OF EVERY ROW — *"who owns this?"* — AND EVERY OBJECT ANSWERS
//     IT FROM A DIFFERENTLY-NAMED COLUMN. This map is the one place that correspondence is written
//     down. P1.7 builds every read predicate from it; `db/gates/p1_ownership.mjs` asserts every entry
//     against the live catalog, so a renamed column fails a gate instead of silently scoping nothing.
//
// ★★ `booking` AND `document` REUSE COLUMNS THAT ALREADY EXISTED, on purpose. Adding an
//    `owner_user_id` beside `host_id` would be two columns holding one fact — the `DUPLICATE-TRUTH`
//    class this project has already paid for twice (`package_credit` vs `entitlement_credit`,
//    `price_minor` after 0015). The name stays; the MEANING is recorded here.
//
// ★★★ AND `ownable: false` IS A REAL ANSWER, NOT A GAP. An object with no owner column can only be
//     scoped `everything` or `none`, and saying so explicitly is what stops P1.7 from quietly
//     treating "no owner column" as "owned by nobody", which would make the object invisible to
//     every non-admin the moment scoping was switched on.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * @property table         the keystone table the object lives in
 * @property ownerColumn   the column holding the owning user's id, or null
 * @property nullable      can a row legitimately have NO owner? (drives the "unassigned" view)
 * @property ownable       false = this object cannot be scoped below `everything`
 */
import { OBJECTS } from "./objects.mjs";
import { DOCUMENTS_DOMAIN } from "../documents/frontDoor.mjs";

export const OWNERSHIP = Object.freeze({
  person: {
    table: "app_user", ownerColumn: "owner_user_id", nullable: true, ownable: true,
    // ★★ A STAFF ROW OWNS ITSELF (`app_user_staff_owns_self_trg`, 0071). `app_user` holds clients
    //    AND staff; without this a coach on "person: edit, owned" could not edit their own profile.
    note: `clients: the assigned coach. staff: themselves.`,
  },
  account: {
    table: "account", ownerColumn: "owner_user_id", nullable: true, ownable: true,
    note: "the rep who owns the relationship.",
  },
  engagement: {
    // ★ NOT `owner_user_id`. `booking.host_id` has been the owner all along and is NOT NULL.
    table: "booking", ownerColumn: "host_id", nullable: false, ownable: true,
    note: `the coach who runs the session. NOT NULL, so a booking is never unassigned.`,
  },
  ...DOCUMENTS_DOMAIN.ownership,   // `document` — declared by Documents (ISLAND-PROGRAMS §2)

  // ── the objects with no owner column, stated rather than omitted ──────────────────────────────
  // ★ Each of these is a real decision for P2/P1.7 to revisit, not an oversight. `invoice` and
  //   `task` are the two most likely to want one; they are listed here so the question is visible.
  // ★★ `availability` — a coach's own working hours. Declared because `/engagements/booking`
  //    resolves `host_id` into a display_name, so the view SURFACES A PERSON. ★ Not a permission
  //    object in its own right; it rides on `engagement`'s grant, which is what governs the
  //    calendar. Listed here so `ownerExpr` can build the predicate.
  availability: { table: "availability_rule", ownerColumn: "host_id", nullable: false, ownable: true,
    ridesOn: "engagement",
    note: "the coach whose working hours these are. Rides on the `engagement` grant." },

  network_party: { table: "network_party", ownerColumn: null, nullable: null, ownable: false,
    note: "the referral network is the practice's, not a caseload's." },
  item: { table: "service", ownerColumn: null, nullable: null, ownable: false,
    note: "the catalogue is the practice's." },
  service: { table: "service", ownerColumn: null, nullable: null, ownable: false,
    ridesOn: "item",
    note: "recordType for /items/services — same practice-wide grant as `item`, not a separate object." },
  // ★★★ FOUND LIVE, Programs follow-up brief (30 Sep 2026, Part 9) — MEASURED: `plan` is in
  //     `ARCHIVABLE` (src/records/archive.mjs) and `ArchiveControl.jsx` is already wired to call
  //     `POST /api/records/archive` with `object: "plan"` for a plan's own record page — but `plan`
  //     was never added to OWNERSHIP, so `permissionObjectFor("plan")` (called via this route's
  //     `objectFromBody: true`) throws "not in OWNERSHIP" on every single attempt. Archiving a plan
  //     has been completely broken since ArchiveControl shipped, independent of anything in this
  //     session's own Programs work — found only because Part 9 asked "does archive already reach
  //     everywhere it should" and this was checked rather than assumed. `package` added alongside
  //     it for the same reason, now that it joins ARCHIVABLE too (migration 0544).
  plan: { table: "plan", ownerColumn: null, nullable: null, ownable: false,
    ridesOn: "item",
    note: "recordType for /items/plans — same practice-wide grant as `item`, not a separate object." },
  package: { table: "package", ownerColumn: null, nullable: null, ownable: false,
    ridesOn: "item",
    note: "recordType for /items/packages — same practice-wide grant as `item`, not a separate object." },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ CORRECTED AFTER THE P1 ADVERSARIAL REVIEW — `invoice` WAS `ownable: false` AND IT LEAKED.
  //     The note here used to read *"P2.6 should decide whether money is scoped by the payer's
  //     owning coach"*, and while it waited, `/money/invoices` and `/money/payments` resolved
  //     `payer_user_id` into `app_user.display_name` and returned it **with no scope predicate at
  //     all**. [EXECUTED] a coach scoped `person: edit/owned` saw one row on `/people/clients` and
  //     the OTHER coach's client on `/money/invoices` — name, amount, status and due date.
  //   ★★★ THE LESSON IS ABOUT THE CLASSIFICATION ITSELF: **the un-ownable judgement was about the
  //       INVOICE, and the query returns a PERSON.** An object is not safe to leave unscoped because
  //       the object is impersonal; it is safe only if nothing it SELECTS identifies somebody.
  //   ★ Scoped indirectly, exactly like `document`: through the payer`s owning coach.`
  invoice: {
    table: "invoice", ownerColumn: null, nullable: true, ownable: true,
    ownerVia: { column: "payer_user_id", joinTable: "app_user", joinOwnerColumn: "owner_user_id" },
    note: `no owner of its own — scoped through the PAYER's owning coach. The list returns the payer's NAME.` },
  // ★★★ P6.B10 — THE OWNER THIS ENTRY'S OWN NOTE ASKED FOR. It read `ownable: false` with
  //     *"/tasks/mine (P6.55) needs an assignee; that is where this gets an owner"* — and this is
  //     that item. `keystone.task.assignee_id` already existed [MEASURED]; nothing had ever pointed
  //     the scope axis at it, so every task was un-ownable and `scoped()` fell back to the
  //     arity-only predicate. ★★ NULLABLE, because an unassigned task is a real state: a task an
  //     event chain raised that nobody has picked up yet must still be visible to whoever may see
  //     tasks, not orphaned out of every list.
  task: { table: "task", ownerColumn: "assignee_id", nullable: true, ownable: true,
    note: "the person the task is assigned to. NULL = raised by an event chain and unclaimed." },
  // ★★★ P6.B9 — `campaign` AND `segment` ARE PRACTICE-WIDE, AND THAT IS A DECISION, NOT A DEFAULT.
  //     `ownerExpr()` THROWS on an unknown object (deliberately — `F146`), which is what made this a
  //     decision I had to make rather than one I could skip. A campaign is something the practice
  //     sent; a list is a saved filter the practice keeps. Neither belongs to one coach, so neither
  //     is scoped to an owner — `scope_allows` already refuses everything below `everything` for an
  //     un-ownable object, so a coach does not silently gain the whole practice's marketing.
  //   ★★ If either ever needs a per-coach view, it gains an owner column HERE and every list picks
  //      it up — exactly the way `task` just did.
  // ★★★ 7.2 — `campaign` IS NOW A PERMISSION OBJECT IN ITS OWN RIGHT (`OBJECTS`, 05 §5), so it no
  //     longer needs the exception `permissionObjectFor` used to make for it; `ridesOn: "campaign"`
  //     is a no-op here (it already resolves to itself with none), kept only because `segment`'s
  //     grant is now literally "the `campaign` grant" and the two entries read as a matched pair.
  campaign: { table: "campaign", ownerColumn: null, nullable: null, ownable: false,
    ridesOn: "campaign",
    note: "practice-wide. A campaign is something the practice sent, not something a person owns." },
  // ★★ `segment` STOPS BEING AN EXCEPTION. It still has no table and no owner of its own — a saved
  //    filter is not a record with a coach attached — but it is governed by the `campaign` grant,
  //    the same object a marketing list is used alongside, instead of a bare word no role can hold.
  segment: { table: "segment", ownerColumn: null, nullable: null, ownable: false,
    ridesOn: "campaign",
    note: "practice-wide. A list is a SAVED FILTER over app_user, never a second store of people." },
  note: { table: null, ownerColumn: null, nullable: null, ownable: false,
    note: "★★ session notes HAVE NO TABLE YET. `note` is a permission object (Q7) ahead of its storage." },
  report: { table: null, ownerColumn: null, nullable: null, ownable: false,
    note: "reports are computed, not stored." },
  // ★★ `subscription` WAS MISSING FROM THIS MAP ENTIRELY — un-ownable BY OMISSION rather than by
  //    decision, which is the state `ownable:false` exists to make impossible. It is not a permission
  //    OBJECT (money is), but `ownerExpr('subscription', …)` is what `RECORD_QUERIES.subscription`
  //    needs, and that query returns `client_name`. Declared, and scoped through the same edge.
  subscription: {
    table: "subscription", ownerColumn: null, nullable: true, ownable: true,
    ownerVia: { column: "app_user_id", joinTable: "app_user", joinOwnerColumn: "owner_user_id" },
    ridesOn: "invoice",
    note: `the client's subscription — scoped through their owning coach. The record page shows client_name.` },
  payment: {
    table: "payment", ownerColumn: null, nullable: true, ownable: true,
    ownerVia: { column: "payer_user_id", joinTable: "app_user", joinOwnerColumn: "owner_user_id" },
    ridesOn: "invoice",
    note: `scoped through the payer's owning coach. The list returns the payer's NAME.` },
  entitlement: {
    table: "entitlement", ownerColumn: null, nullable: true, ownable: true,
    ownerVia: { column: "owner_user_id", joinTable: "app_user", joinOwnerColumn: "owner_user_id" },
    ridesOn: "invoice",
    note: `the client's credit grant — scoped through their owning coach, same grant as invoice/subscription/payment.`,
  },

  setting: { table: "tenant_setting", ownerColumn: null, nullable: null, ownable: false,
    note: "tenant configuration has no owner — enforced by role_permission_setting_scope (0066)." },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 7.2 — THE TEN NEW OBJECTS (05 §5). Every one arrives with an ownership expression HERE,
  //     in the same migration (0182) that seeds `keystone.permission_object` — CT-044/CT-045: an
  //     object with no ownership expression makes every scope on it meaningless (the F294 class).
  //     `message`, `goal`, `referral`, `payout` and `dispute` are `ownable: true` (05 §5 grants the
  //     Coach `edit/owned` on `message`/`goal`/`referral`, so 0182 seeds `permission_object.ownable
  //     = true` for those three; `payout`/`dispute` are declared ownable ahead of a Coach ever
  //     being granted `owned` on them, same reasoning `task` and `invoice` already followed).
  //     `discount`, `automation`, `site` and `audit` are `ownable: false` — practice-wide
  //     configuration, never a record with a coach attached (05 §5: every role`s Coach row is`
  //     `none/none` on all four, and none is ever offered `owned`).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★ NO TABLE YET, exactly as `note` and `report` above: messaging, goals/steps/check-ins,
  //    referrals, payouts and disputes are features later stages build. Declaring the object and
  //    its ownership answer now — ahead of storage — is what let `note` ship without inventing a
  //    fake column, and Q7 ruled it a real pattern, not a placeholder to clean up.
  message: { table: null, ownerColumn: null, nullable: null, ownable: true,
    note: `no table yet — messaging ships later. Ceiling only: Coach is edit/owned (05 §5).` },
  goal: { table: "person_goal", ownerColumn: null, nullable: true, ownable: true,
    ownerVia: { column: "person_id", joinTable: "app_user", joinOwnerColumn: "owner_user_id" },
    note: `staff-side only (G18). Scoped through the person's owner; the assigned coach may write (OQ-12.11).` },
  referral: { table: "network_referral", ownerColumn: null, nullable: true, ownable: true,
    ownerVia: { column: "referred_person_id", joinTable: "app_user", joinOwnerColumn: "owner_user_id" },
    note: "the SAME table 0359 built (OQ-12.2 — one referral store, never two). Scoped through the " +
      `referred PERSON's owner: 05 §5's Coach default is referral edit/owned.` },
  discount: { table: null, ownerColumn: null, nullable: null, ownable: false,
    note: `practice-wide pricing configuration, not a record with a coach attached (05 §5: Coach ` +
      "is none/none)." },
  automation: { table: null, ownerColumn: null, nullable: null, ownable: false,
    note: `a practice's automations are configuration, not records with a coach attached.` },
  site: { table: null, ownerColumn: null, nullable: null, ownable: false,
    note: `a practice's client site(s) (05 §10) are configuration, not records with a coach attached.` },
  payout: { table: null, ownerColumn: null, nullable: null, ownable: true,
    note: `no table yet — payouts ship with the money features. Ceiling only; Coach is none/none ` +
      "(05 §5) today, same as `payment` before P6.B10 gave `task` its owner." },
  dispute: { table: null, ownerColumn: null, nullable: null, ownable: true,
    note: "no table yet — disputes ship with the money features. Ceiling only, same as `payout`." },
  audit: { table: null, ownerColumn: null, nullable: null, ownable: false,
    note: `the practice's audit log (7.2/7.3) is configuration, not a record with a coach attached.` },
});

/** The objects a scope narrower than `everything` can actually bound. */
export function ownableObjects() {
  return Object.keys(OWNERSHIP).filter((o) => OWNERSHIP[o].ownable);
}

/**
 * The SQL expression that yields a row's owning user id, given the row's alias.
 * ★★ ONE PLACE BUILDS THIS, so every list in P1.7 asks the question the same way. A hand-written
 *    predicate per list is 29 chances to write `assigned_to` where `owner_user_id` was meant —
 *    which is exactly the error F146 records.
 */
export function ownerExpr(object, alias) {
  const e = OWNERSHIP[object];
  // ★★★ AN UNKNOWN OBJECT IS A THROW, NOT A NULL — AND THIS IS A FIX, NOT A FLOURISH.
  //     [EXECUTED, P2.8] `scopedRecord('booking', 'b')` was written for the new booking record page.
  //     The permission OBJECT is `engagement`; `booking` is its TABLE. `OWNERSHIP['booking']` is
  //     undefined, so this returned null, `scopedRecord` took its un-ownable branch, and the query
  //     shipped with **NO SCOPE PREDICATE AT ALL** — silently, looking exactly like a correctly
  //     scoped one.
  //   ★★ "I do not know this object" and "this object has no owner" were producing the same SQL,
  //      and one of them is a typo while the other is a decision. **That collapse is the class this
  //      project keeps finding**, and a null return is how it happens. `p1_scope_wired` §4 caught
  //      the instance; this stops the next one being written at all.
  if (!e) {
    throw new Error(
      `ownerExpr: "${object}" is not a permission object — the known ones are ` +
      `${Object.keys(OWNERSHIP).join(", ")}. ★ If you meant a TABLE, note the object and the table ` +
      `differ for some entries (engagement → booking, item → service, document → document_instance).`);
  }
  if (!e.ownable) return null;
  if (e.ownerColumn) return `${alias}.${e.ownerColumn}`;
  if (e.ownerVia) {
    const via = `(SELECT _o.${e.ownerVia.joinOwnerColumn} FROM keystone.${e.ownerVia.joinTable} _o ` +
                `WHERE _o.id = ${alias}.${e.ownerVia.column})`;
    return e.ownerFallbackColumn ? `COALESCE(${via}, ${alias}.${e.ownerFallbackColumn})` : via;
  }
  return null;
}

/**
 * The GRANT a row's scope predicate must ask about — which is NOT always the key it is filed under.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THIS IS THE SECOND HALF OF THE FIX `ownerExpr` ABOVE ONLY DID THE FIRST HALF OF, AND THE
 *     MISSING HALF SHIPPED SIX DEAD SCREENS. [MEASURED 2026-09-15, P7 CLOSE, by the e2e record
 *     walk] `OWNERSHIP` has 16 keys; `OBJECTS` has 11. Five keys are not permission objects, and
 *     three of those five are `ownable` — so their scope predicate was emitted as
 *     `user_may($2, '<a word no role can ever be granted>', 'view', …)`.
 *   ★★ `keystone.user_may` is a plain `EXISTS` over `role_permission WHERE rp.object = p_object`
 *      [MEASURED from `pg_proc.prosrc`]. It does not validate the object. An ungrantable one
 *      matches no row and returns **false, silently, for every user in every tenant** — which
 *      renders as an empty list, indistinguishable from "you have no subscriptions yet".
 *   ★★★ SIX LIVE PREDICATES WERE AFFECTED: the `/money/subscriptions`, `/money/payments` and
 *       `/engagements/booking` LISTS, the subscription RECORD PAGE, and the related-subscription
 *       lists on both the person and the plan record page. Three whole screens, permanently empty
 *       in production.
 *   ★★ AND IT SURVIVED 146 GATES BECAUSE OF THE `OR keystone.scope_not_yet_configured($2)` LEG.
 *      A gate tenant has no roles configured, so that leg is TRUE and the broken half is never
 *      evaluated. A signup tenant DOES configure roles, so production got the false. **The gates
 *      passed because the FIXTURE supplied the condition, not the application** — the house
 *      defect, arriving at the one axis nobody had pointed it at.
 *
 * ★ `ridesOn` is declared in the table above rather than mapped at the call site, because a call
 *   site is where `booking → engagement` was already got right by hand and `subscription` was got
 *   wrong by hand. One declaration cannot disagree with itself.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function permissionObjectFor(object) {
  const e = OWNERSHIP[object];
  if (!e) {
    throw new Error(
      `permissionObjectFor: "${object}" is not in OWNERSHIP — the known ones are ` +
      `${Object.keys(OWNERSHIP).join(", ")}.`);
  }
  const resolved = e.ridesOn ?? object;
  // ★★★ THE THROW IS THE WHOLE POINT. Returning `object` unchanged is what the old code did, and it
  //     is how a word that can never be granted reached live SQL and stayed there for six phases.
  if (!OBJECTS.includes(resolved)) {
    throw new Error(
      `permissionObjectFor("${object}") resolves to "${resolved}", which is NOT one of the eleven ` +
      `permission objects (${OBJECTS.join(", ")}). No role can ever hold it, so ` +
      `keystone.user_may() would return false for every user in every tenant and the screen would ` +
      `be permanently empty. ★ Give OWNERSHIP["${object}"] a \`ridesOn\` naming the grant it should ` +
      `be governed by — availability rides on engagement, subscription and payment ride on invoice.`);
  }
  return resolved;
}

/**
 * The objects that need an "unassigned" VIEW — i.e. ones an operator directly assigns and can
 * therefore forget to.
 * ★★ NOT simply "ownable and nullable". An INVOICE's owner is resolved THROUGH its payer, so an
 *    unowned invoice is not an unassigned invoice — it is an unassigned PERSON, and it is already
 *    on the person list. Listing it twice would mean two screens for one gap, and fixing it on the
 *    invoice screen would be impossible: there is nothing on an invoice to assign.
 *  ★ So the test is a DIRECT owner column. That is exactly the set `keystone.unassigned_count()`
 *    implements, which is how the two stay in step.
 */
export function unassignableObjects() {
  return Object.keys(OWNERSHIP).filter(
    (o) => OWNERSHIP[o].ownable && OWNERSHIP[o].nullable && OWNERSHIP[o].ownerColumn);
}
