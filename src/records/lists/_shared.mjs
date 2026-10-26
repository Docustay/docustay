// P6.0b — THE PIECES EVERY SECTION'S DESCRIPTORS SHARE. Lifted verbatim from `lists.mjs`.
// ★★★ `scoped()` IS THE ONE THAT MATTERS: it is the per-GRANT scope predicate, and it must stay
//     SINGLE. `F142` names this explicitly — a list that resolves a viewer's scope to one value
//     and filters by it has already made the mistake.
import { ownerExpr, OWNERSHIP, permissionObjectFor } from "../../permissions/ownership.mjs";
import { ARCHIVABLE } from "../archive.mjs";

// ★ P2.9 — the TABLES that carry `archived_at`, derived from the archive map rather than re-listed.
//   A tenth archivable object gets its lists filtered by existing there, not by anybody remembering.
export const ARCHIVABLE_TABLES = new Set(Object.values(ARCHIVABLE).map((e) => e.table));

// P15.5 — THE LIST VIEWS. "QUERY AND SCREEN, BOTH."
//
// ★★★ P15.5 names eight areas: People (+5 team filters) · Accounts · Network · Engagements ·
// Items · Documents · Money · Platform. Every one of them had NO read path — [MEAS, ADDENDUM 1]
// `account`, `network_party`, `service`, `plan`, `package`, `document_template`,
// `document_instance`, `subscription`, `availability_rule`, `booking_policy` and fourteen others
// are "never written outside a gate fixture" and never SELECTed from `src/` at all.
//
// ★★ ONE DECLARATION PER NAV PATH, AND THE PATH IS THE KEY. The nav is data (`sections.mjs`) and
// this file joins that data to SQL. It does NOT hold a second copy of the nav: every key below is
// asserted to be a real `knownPaths()` entry by db/gates/p15_crm_screens.mjs, so a typo here is a
// failing gate rather than a screen nobody can reach.
//
// ★ NO tenant_id PREDICATE, DELIBERATELY — see the header of queries.mjs. FORCE RLS applies
//   `tenant_id = current_tenant_id()` to every one of these tables, and a hand-written second
//   predicate is the copy that drifts.

/** ★ Shared column groups, so two lists over the same table cannot disagree about a label. */
export const PERSON_COLUMNS = [
  { field: 'display_name', label: 'Name',  format: 'text' },
  { field: 'email',        label: 'Email', format: 'text' },
  { field: 'role',         label: 'Role',  format: 'enum' },
];
export const STAFF_COLUMNS = [
  { field: 'display_name', label: 'Name',  format: 'text' },
  { field: 'email',        label: 'Email', format: 'text' },
  { field: 'staff_role',   label: 'Rank',  format: 'enum' },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P1.7 — EVERY LIST RESOLVES THROUGH THE SCOPE PREDICATE, AND `$1` IS ALWAYS THE VIEWER.
//
//   `keystone.user_may(viewer, object, 'view', <owner>)` is ONE expression and it is per-GRANT — the
//   EXISTS inside it binds the verb and the scope to the SAME row of `role_permission`. ★★★ That is
//   `F142`, whose SCOPE field names this item explicitly: *"a list that resolves the user's scope
//   for `person` to ONE value and then filters by it has already made the mistake."* So the
//   predicate goes into the WHERE clause; it is never resolved to a scope and applied by hand.
//
// ★★ AND THE OWNER EXPRESSION COMES FROM `ownerExpr()`, NOT FROM A LITERAL PER LIST. 29 hand-written
//    predicates are 29 chances to write the wrong column — which is exactly `F146`, where a text[]
//    of party roles was named as an owner and nothing noticed until SQL had to be generated from it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EXPORTED FOR P5.11. Global search asks the same question 29 list views ask — *"may THIS
//     viewer see THIS row of THIS object"* — and the one thing it must not do is answer it a
//     second time. `routes/index.mjs:82-125` records that **six of twelve read routes shipped with
//     no role predicate**, and that a parent's own session reached `/api/settings/documents` on the
//     DEPLOYED server and got 200. A search is that defect multiplied by every table at once, so it
//     reuses this predicate verbatim rather than growing its own.
export const scoped = (object, alias) => {
  const owner = ownerExpr(object, alias);
  // ★ An un-ownable object yields NO predicate rather than a false one. `scope_allows` already
  //   refuses everything below `everything` for these, so adding `user_may(...)` here would be a
  //   second place the same refusal is decided — and the object would vanish for every non-admin.
  // ★★ AN UN-OWNABLE OBJECT STILL CONSUMES `$1`, and not for tidiness. It keeps the parameter
  //    arity identical across all 29 views — so the route passes the viewer unconditionally and
  //    cannot pass it to some lists and not others — AND `$1::uuid IS NOT NULL` is a real fail-closed
  //    check: no viewer, no rows. ★ Emitting bare `true` would have made the route decide, per
  //    list, whether to bind a parameter, which is a decision with 29 chances to be wrong.
  // ★★ THE TRANSITIONAL DISJUNCT (0075). Fires only for a staff member holding NO role at all —
  //    nobody, once the backfill has run. Without it, cutting the predicate in blanks every list
  //    on an un-backfilled deployment. See 0075's header for how and when to delete it.
  // ★★★ P2.9 — AND THE ARCHIVE FILTER RIDES HERE, FOR THE SAME REASON THE VIEWER PREDICATE DOES.
  //     Twenty-three list views and five home tiles read an archivable table. Adding
  //     `AND x.archived_at IS NULL` to each by hand is twenty-eight chances to miss one, and the one
  //     that is missed is the list where a departed client keeps appearing — **which is the defect
  //     this whole item exists to fix, surviving in a corner.** One helper, one decision.
  //   ★★ IT IS THE OBJECT'S OWN TABLE, NOT EVERY TABLE THE QUERY TOUCHES. `/money/invoices` joins
  //      `app_user` to name the payer; an archived payer must still be NAMED on their invoice,
  //      because the invoice is a record of something that happened. Archiving hides a record from
  //      ITS OWN lists — it does not redact the person from history.
  const archivable = ARCHIVABLE_TABLES.has(OWNERSHIP[object]?.table);
  const notArchived = archivable ? ` AND ${alias}.archived_at IS NULL` : "";

  // ★★★ THE GRANT IS `permissionObjectFor(object)`, **NOT** `object`. [MEASURED 2026-09-15]
  //     `/money/subscriptions`, `/money/payments` and `/engagements/booking` each asked
  //     `user_may($1, '<a word that is not one of the eleven>', …)`. No role can be granted it, so
  //     the predicate was false for every user in every tenant and all three lists were
  //     PERMANENTLY EMPTY — which looks exactly like a practice with no subscriptions. The
  //     resolver throws rather than passing an unknown word through. See `ownership.mjs`.
  const grant = owner ? permissionObjectFor(object) : null;

  return (owner
    ? `keystone.user_may($1, '${grant}', 'view', ${owner})`
    : `$1::uuid IS NOT NULL`) + notArchived;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 12.17 — `scopedArchived`: THE SEAM FOR A LIST WHOSE SUBJECT **IS** THE ARCHIVED STATE.
//
//   `scoped()` above unconditionally appends `AND ${alias}.archived_at IS NULL` for an archivable
//   object (P2.9) — correct for every list whose rows are meant to be LIVE, and exactly wrong for
//   one whose rows are meant to be the ARCHIVED ones. A list built on plain `scoped()` for such a
//   subject reads as correctly scoped, compiles, runs — and returns ZERO ROWS FOREVER, because its
//   own WHERE clause forbids the very rows it exists to show. 12.18 measured this shape live on a
//   sibling task's prompts; `/people/archived` (this task) is the first LIST to need the flip.
//
//   ★★ `scopedArchived` DOES NOT RE-DERIVE THE PREDICATE — it takes `scoped()`'s own output and
//      inverts ONLY the archive clause, character-for-character, so the viewer/grant half can never
//      drift from the one `scoped()` computes. `.replace(...)` is exact-string, not a regex, so it
//      cannot accidentally touch anything else in the predicate.
//   ★★★ AND IT THROWS RATHER THAN SILENTLY SCOPING NOTHING. An un-archivable object (e.g.
//       `setting` — no `archived_at` column anywhere) makes `scoped()` emit NO archive clause at
//       all, so the `.replace()` below is a no-op and the returned string is IDENTICAL to
//       `scoped()`'s own — which would silently list every LIVE row of an object that has no
//       "archived" state to speak of, under a name that claims the opposite. The throw makes that
//       impossible rather than merely unlikely.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const scopedArchived = (object, alias) => {
  const base = scoped(object, alias);
  const liveClause = ` AND ${alias}.archived_at IS NULL`;
  const archivedClause = ` AND ${alias}.archived_at IS NOT NULL`;
  const flipped = base.replace(liveClause, archivedClause);
  if (flipped === base) {
    throw new Error(
      `scopedArchived: "${object}" is not archivable — scoped() emitted no archive clause to flip. ` +
      `A list over a non-archivable object has no "archived" rows to show.`);
  }
  return flipped;
};

// ★ EVERY LIST VIEW'S ORDER BY ENDS WITH THE VIEW'S OWN `id` (5F-19 / R-5-19). Offset paging over a
//   non-unique order can return a row twice or not at all; `id` makes the order total. The sort columns
//   before it are what the screen shows and are unchanged; `id` only breaks ties.
export const personList = (where) => `
  SELECT u.id, u.display_name, u.email, u.role, u.staff_role
    FROM keystone.app_user u
   WHERE ${scoped('person', 'u')} AND (${where})
   ORDER BY u.display_name, u.id`;

// ★★★ `documentList` AND `templateList` USED TO LIVE HERE AND WERE DELETED 2026-09-15, UNUSED.
//     The P6.B7 documents batch needed an instance SELECT these two could not express and wrote its
//     own builders in `documents.mjs`, which is the right call — but it left these two behind, and
//     three OTHER section modules went on importing them without ever calling them. [MEASURED, with
//     comments stripped] zero call sites for either across every section module.
//   ★★ TWO IMPLEMENTATIONS OF ONE QUERY IS `DUPLICATE-TRUTH`, and the dangerous half is the one
//      nobody runs: it drifts silently and the next person to reach for a shared builder gets the
//      stale one. The surviving builders are in `documents.mjs`, beside the lists that use them.
//   ★ `DOCUMENT_COLUMNS` and `TEMPLATE_COLUMNS` below are STILL SHARED and still called — the
//     column sets genuinely are common; only the SQL had diverged.

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S2.2 — THE EMPTY STATE IS **DATA IN THE DESCRIPTOR**, BESIDE THE COLUMNS IT BELONGS TO.
//
// ★★★ A SCREEN WITH NO ROWS CURRENTLY RENDERS A HEADER AND NOTHING UNDER IT. That does not read as
//     *"you have no clients yet"* — it reads as *"something failed to load."* **It is the single
//     biggest reason the CRM looks broken rather than new, and it is the same defect 45 times.**
//
// ★★★ AND IT IS NOT A PHASE OF THE BUILD. Putting the copy HERE — in the same object as `columns`
//     and `sql` — is what makes it impossible to add a screen without one. *"A screen is not
//     finished when it renders rows; it is finished when it renders NOTHING correctly."* Building
//     the empties later means touching all 45 twice.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHY THIS EMITS **TWO** KEYS, AND WHY THAT IS NOT DUPLICATE-TRUTH.
//
//   `empty` has been a STRING since P15.5 and the REACT `ListView` renders it as a text node. It
//   cannot become an object while that bundle lives — React throws *"Objects are not valid as a
//   React child"*, so changing the shape in place would take the product down on the first empty
//   screen anybody opened.
//
//   So this is an EXPAND/CONTRACT with the contract step scheduled (S6.2, when the React bundle is
//   retired: delete `empty`, rename `emptyState` → `empty`). ★★ The two keys are NOT two hand-kept
//   copies — **the block is the source and the string is DERIVED FROM ITS OWN `line`.** A
//   descriptor author writes the empty state exactly once.
//   ★ `SUPERSEDED-STILL-READ` is a class this project has been bitten by; the difference here is
//     that the superseded key is generated, cannot drift, and has a named removal step.
//
// THE FOUR PARTS, AND THEY ARE NOT OPTIONAL — *"if any part is missing, one of the user's silent
// questions goes unanswered"*:
//     icon      → is this screen broken?
//     headline  → where am I?            ★★ FORWARD-LOOKING, NEVER A STATUS REPORT. Polaris:
//                                          *"'Create your first product' outperforms 'You haven't
//                                          added any products yet'."*
//     line      → did I do something wrong?
//     action    → what now?
//
// ★★★ THREE SCREENS PASS `action: null` DELIBERATELY AND MUST KEEP IT. `/money/payments` — you do
//     not create a payment, one happens TO you, and an "Add payment" button **invites somebody to
//     fabricate a financial record**. `/accounts/reports` — nothing the user does makes a monthly
//     report arrive sooner. `/platform/jobs`. For those a button would be a lie.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ The five kinds. A sixth would mean a treatment nothing renders — `EmptyState` refuses one. */
const EMPTY_KINDS = Object.freeze(["first-run", "filtered", "period", "blocked", "not-built"]);

/**
 * @param kind          one of EMPTY_KINDS — drives the TREATMENT, never the copy, so `filtered` can
 *                      never accidentally read as `first-run`
 * @param icon          a Tabler icon NAME (a string), resolved to a component in the browser.
 *                      ★★ A NAME AND NOT AN IMPORT: this module is imported by the SERVER — the
 *                      list routes read `columns` and `sql` out of it — and a `.svelte` import here
 *                      would make every one of those routes depend on a UI package. The one place
 *                      that mapping happens is `webui/src/lib/empty/icons.js`.
 * @param headline      forward-looking. Never "You have no X yet".
 * @param line          why it is empty and what will appear
 * @param action        { label, href } — or null for the three screens that correctly offer nothing
 * @param blockedAction { label, href } pointing AT THE BLOCKER, for a `blocked` screen
 * @param blockedLine   what to say while blocked, when it differs from `line`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ PART 3.3 [TY, RULED 23 Sep 2026] — `example`/`rail`/`steps`/`starters` REMOVED. The first-run
 *     rich slate they fed is gone (Part 3: every empty list renders its own real chrome, plus ONE
 *     band — headline, line, action — in place of the rows). Nothing left to carry this data to.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function emptyOf({ kind = "first-run", icon = null, headline = "", line = "",
                          action = null, blockedAction = null, blockedLine = null,
                          errorWhenEmpty = false,
                          // ═══════════════════════════════════════════════════════════════════
                          // ★★★ TOUCH-UP · WORKSTREAM 6.1 — THE ROLE-AWARE VARIANT
                          //     (`ListNoPermission.frame.html`'s empty-list cousin). `action`
                          //     above is offered to EVERY viewer who can reach this screen,
                          //     including one who cannot actually write here — an "Add parent"
                          //     button a Coach can click and watch fail server-side is exactly
                          //     the "dead control" class this project has shipped before.
                          //   ★ OPT-IN, LIKE EVERY OTHER FIELD HERE: `null` (the default all 45
                          //     descriptors keep unless they name this) means "no second
                          //     variant — every viewer who reaches this screen gets the same
                          //     empty state," which is correct for the 43 lists with no
                          //     role-gapped write path. The ROUTE (`/api/list/*`,
                          //     `src/routes/index.mjs`) substitutes this in for `line`/`action`
                          //     ONLY when it has independently computed `canWrite === false` —
                          //     this file never guesses at a role itself.
                          // ═══════════════════════════════════════════════════════════════════
                          noWrite = null,
                          // ═══════════════════════════════════════════════════════════════════
                          // ★★★ TOUCH-UP · WORKSTREAM 6.2 — `/engagements/calendar` ONLY. An empty
                          //     week is CORRECT (kind='period', above) for a practice that has
                          //     working hours set and simply has a quiet week; it is WRONG advice
                          //     ("step to another week") for a practice with no coach hours ever
                          //     set, where EVERY week will be empty until that changes. The route
                          //     (`src/routes/index.mjs`) substitutes this in, replacing `kind` with
                          //     `'first-run'`, ONLY when it independently confirms
                          //     `keystone.availability_rule` has no in-force row — this file never
                          //     guesses at that from here.
                          // ═══════════════════════════════════════════════════════════════════
                          firstRun = null } = {}) {
  if (!EMPTY_KINDS.includes(kind)) {
    throw new Error(
      `emptyOf: "${kind}" is not one of the five kinds (${EMPTY_KINDS.join(", ")}). A screen that ` +
      `cannot say WHY it is empty will tell a power user who filtered to nothing to create their ` +
      `first record.`);
  }
  // ★★ REFUSES A BLANK. "No records" is the default nobody decided; this forces the screen to say
  //    what the list IS and what would put something in it. Every one of the 45 has a measured
  //    headline and line, so a descriptor reaching here without them has been written by hand
  //    around the helper rather than through it.
  if (!headline || !line) {
    throw new Error(
      `emptyOf: needs BOTH a headline and a line (got headline=${JSON.stringify(headline)}, ` +
      `line=${JSON.stringify(line)}). A bare "No records" tells a person nothing they can act on.`);
  }
  // ★★★ A `blocked` SCREEN WITHOUT A `blockedAction` IS THE DEAD END THIS WHOLE ITEM EXISTS TO
  //     REMOVE. The kind says "you cannot do this yet"; without a destination it says only that.
  if (kind === "blocked" && !blockedAction) {
    throw new Error(
      `emptyOf: kind="blocked" requires a blockedAction pointing AT THE BLOCKER. An empty invoices ` +
      `screen with an "Add invoice" button that cannot work is worse than no button.`);
  }
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `errorWhenEmpty` — FOR THE ONE SCREEN THAT MUST NEVER BE EMPTY.
  //     `/people/team/super-admin-1` lists the account that CREATED the practice. It cannot
  //     legitimately be empty, so an empty result there is a DATA FAULT and the screen renders the
  //     ERROR state, **never a create prompt**. Offering "Invite a super admin" would ask somebody
  //     to paper over a corrupted record, and it would look like ordinary onboarding while they did.
  //   ★ It is a property of the SCREEN, not of the request, which is why it lives in the descriptor
  //     beside the columns rather than being decided by whichever route happened to answer.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const emptyState = Object.freeze({ kind, icon, headline, line, action, blockedAction, blockedLine,
                                     errorWhenEmpty, noWrite, firstRun });
  // ★ `empty` is the SHADOW. Derived, never typed a second time.
  return { empty: line, emptyState };
}

export const DOCUMENT_COLUMNS = [
  { field: 'title',   label: 'Document', format: 'text' },
  { field: 'subject', label: 'Subject',  format: 'text' },
  { field: 'builder', label: 'Builder',  format: 'enum' },
  { field: 'state',   label: 'State',    format: 'enum' },
  { field: 'sent_at', label: 'Sent',     format: 'date' },
];
export const TEMPLATE_COLUMNS = [
  { field: 'name',       label: 'Template', format: 'text' },
  { field: 'version',    label: 'Version',  format: 'number' },
  { field: 'instances',  label: 'In use',   format: 'number' },
  { field: 'active',     label: 'Active',   format: 'boolean' },
];

