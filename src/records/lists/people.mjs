// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b — THE PEOPLE SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B2 — THE P2.1 COLUMNS REACH THE SCREEN, AND ONE THING MUST BE SAID BEFORE THEY DO.
//
// ★★★ [MEASURED 2026-09-15, against the live database] 43 people exist. **ZERO** of them hold a
//     `last_name`, a `first_name`, a `mobile_phone`, a `date_of_birth` or a `source`, and **43 of
//     43** hold `lifecycle_status = 'lead'`.
//   ★★ THAT IS NOT A DATA PROBLEM, IT IS A MISSING WRITER. `createPerson` INSERTs exactly
//      (id, tenant_id, email, display_name, role, staff_role, firebase_uid) and `updatePerson`
//      can SET exactly (display_name, email, firebase_uid) — `src/people/writes.mjs:85,:193-206`.
//      **Nothing in the application can write any column 0076 added.** `p2_person_fields` passes
//      because it seeds them with raw SQL as a privileged role; the PRODUCT cannot.
//   ★★★ SO THESE COLUMNS ARE A READ PATH OVER A WRITE PATH THAT DOES NOT EXIST YET. They render
//       `—` today, which is the honest rendering of "nobody has recorded this", and they light up
//       the day the form can set them. Declaring them is how the gap becomes visible instead of
//       staying invisible — a column nobody can see is the defect P2.1 was fixing one layer down,
//       and a column nobody can FILL is the same defect one layer up.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 12.17 — THE PEOPLE LISTS' DATA: DRAWN COLUMNS, MONEY STRIPPED BY GRANT, SUMMARIES,
//     ARCHIVED, THE TEAM ROSTER. `date_of_birth`/`age` are the only P2.1-write-path columns still
//     declared below (on `/people/adolescents`) — `/people/all`, `/people/clients` and
//     `/people/parents` are re-pointed at the derived facts this task adds (Who pays, Sessions,
//     Owes, Status) rather than the raw contact columns, per `STAGE-12-PLAN.md` §12.17 "What
//     replaces it". `Surname`/`Mobile`/`Role` stay exported from `_shared.mjs` for the one list
//     that still needs a bare email (`/people/team/invites`) and are otherwise unused by this file
//     now — nothing else in `src/` imports them from here, so nothing goes dark.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  scoped, scopedArchived, PERSON_COLUMNS, STAFF_COLUMNS, personList, emptyOf,
} from "./_shared.mjs";
import { notExecutedAnyDocumentFragment } from "../../documents/api.mjs";

// ★★ DERIVED FROM `PERSON_COLUMNS`, NOT RETYPED. `_shared.mjs` is the authority on what the Name
//    and Email columns are CALLED; this file only decides which of them each list shows and what
//    it adds. Retyping the labels here would be the "two lists over the same table disagree about
//    a label" failure the shared file exists to prevent. `ROLE` (`PERSON_COLUMNS[2]`) is unused
//    since 12.17 re-pointed every list that used to show it at a derived Status/State column.
const [NAME, EMAIL] = PERSON_COLUMNS;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK 12.17 — THE SHARED SELECT EXPRESSIONS. Every one of them is a `u`-aliased fragment so the
// same string composes into any `peopleQuery(extra, where)` call below without a second copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ★★★ TASK 12.4 (`12-signup-first-run-people.md` §11) — the derived `type` column, one of the
//     four-member set MOCKUPS §21 names (client, adolescent, parent, lead). `lead` outranks the
//     role split — a `lifecycle_status` of `lead` on EITHER client role reads as `type: 'lead'`,
//     matching how `/people/leads` treats the two client roles as one pipeline.
// ★★★ the maintainer, 29 Sep 2026 — "Everyone who gets services is a client. One Clients list. What kind of
//     client they are is a TAG." Replaces the old, mutually-exclusive `type` (a person could only
//     ever be ONE of client/adolescent/parent/lead — the exact thing that couldn't hold Michael
//     Young, who is both an adult client AND a parent). FOUR system tags, hard-coded, the same for
//     every practice, and a person may carry more than one:
//       Adult        — role = adult_client
//       Adolescent   — role = adolescent_client
//       Parent       — a REAL FACT (a keystone.guardian row naming them), never a role
//       Lead         — lifecycle_status = lead
const TAGS_EXPR = `
    array_remove(ARRAY[
      CASE WHEN u.role = 'adult_client' THEN 'adult' END,
      CASE WHEN u.role = 'adolescent_client' THEN 'adolescent' END,
      CASE WHEN EXISTS (SELECT 1 FROM keystone.guardian g WHERE g.guardian_user_id = u.id)
        THEN 'parent' END,
      CASE WHEN u.lifecycle_status = 'lead' THEN 'lead' END
    ], NULL) AS tags`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P6.6 — THE GUARDIAN LINK, WHICH P1.6 BUILT AND NOTHING HAS EVER RENDERED.
//
// It is read TWICE, on purpose, and the two are not redundant:
//   · `children`    — the names as ONE STRING, so the generic `ListView` renders a readable cell.
//                     [THIS IS THE GATE-SAFE ONE] `p15_crm_screens` mounts every descriptor through
//                     `ListView`, whose `formatValue` falls through to `String(value)`; an ARRAY OF
//                     OBJECTS there renders `[object Object]`, which is precisely what that gate's
//                     junk scan fails on.
//   · `child_links` — the same children as `{id, name}`, so a table that CAN draw a control per
//                     child draws one that opens the child's record. ★ It is deliberately NOT a
//                     declared column: an undeclared row field is never rendered by `ListView`, so
//                     the identifier it carries cannot reach the DOM as text (D-15.3).
//
// ★★ THE CHILD IS SCOPED TOO, WITH THE SAME PREDICATE AS THE PARENT. A coach who may not see a
//    child must not learn that child's NAME from the parent's row — the `invoice` lesson in
//    `ownership.mjs:79-84` exactly: *"the un-ownable judgement was about the INVOICE, and the query
//    returns a PERSON."* Here the judgement is about the parent and the subquery returns a child.
//
// ★ TASK 12.17 KEEPS BOTH, UNDECLARED, EVEN THOUGH `/people/parents`' NEW `columns` NO LONGER
//   NAMES `children` AS A DISPLAYED COLUMN — the plan's replace only respecifies the declared
//   columns (Name, Who pays, State); it never says to stop selecting the link itself, and dropping
//   the SELECT would silently take back the guardian-link wiring this header documents.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const CHILDREN_OF_U = (projection) => `
    (SELECT ${projection}
       FROM keystone.guardian g
       JOIN keystone.app_user c
         ON c.tenant_id = g.tenant_id AND c.id = g.child_user_id
      WHERE g.guardian_user_id = u.id AND ${scoped('person', 'c')})`;

// ★★★ TASK 12.17 — `WHO_PAYS`: the payer-group name via `payer_group_member`/`payer_group`
//     (12.5's shape, CT-F27/0360/0383), else — for an adolescent with no payer group of their own —
//     the first linked guardian's name (scoped, same predicate as `CHILDREN_OF_U` above but in the
//     other direction: THIS person's own guardians), else the honest default nobody pays for them
//     but themselves.
const WHO_PAYS = `
    coalesce(
      (SELECT pg.name
         FROM keystone.payer_group_member pgm
         JOIN keystone.payer_group pg
           ON pg.tenant_id = pgm.tenant_id AND pg.id = pgm.payer_group_id
        WHERE pgm.person_id = u.id AND pg.archived_at IS NULL
        LIMIT 1),
      (SELECT gu.display_name
         FROM keystone.guardian g
         JOIN keystone.app_user gu
           ON gu.tenant_id = g.tenant_id AND gu.id = g.guardian_user_id
        WHERE g.child_user_id = u.id AND ${scoped('person', 'gu')}
        ORDER BY gu.display_name, gu.id
        LIMIT 1),
      'Pays for themselves'
    ) AS who_pays`;

// ★ The correlated subquery `SESSIONS`/`LAST_CAME`/`STATUS` all need — "this person's own
//   completed bookings" — defined ONCE so the three cannot drift on what "completed" means.
const LAST_COMPLETED_AT = `
    (SELECT max(b.starts_at)
       FROM keystone.booking_participant bp
       JOIN keystone.booking b ON b.tenant_id = bp.tenant_id AND b.id = bp.booking_id
      WHERE bp.app_user_id = u.id AND b.state = 'completed')`;

const UPCOMING_BOOKING = `
    EXISTS (SELECT 1
              FROM keystone.booking_participant bp
              JOIN keystone.booking b ON b.tenant_id = bp.tenant_id AND b.id = bp.booking_id
             WHERE bp.app_user_id = u.id AND b.state IN ('confirmed', 'pending_payment')
               AND b.starts_at > now())`;

// ★★★ TASK 12.17 — `SESSIONS`: bookings as PARTICIPANT (not host — that is TeamList's
//     `sessions_this_year`, below). ★ F119 (23 Oct 2026): every booking that was not cancelled (done, booked or held), the
//     same rule as `sessions_this_year` (F98) — counting only completed ones showed 0 for clients with sessions booked.
const SESSIONS = `
    (SELECT count(*)::int
       FROM keystone.booking_participant bp
       JOIN keystone.booking b ON b.tenant_id = bp.tenant_id AND b.id = bp.booking_id
      WHERE bp.app_user_id = u.id AND b.state <> 'cancelled') AS sessions`;

// ★★★ TASK 12.17 — `LAST_CAME`: the max `starts_at` of a completed booking as participant.
const LAST_CAME = `${LAST_COMPLETED_AT} AS last_came`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 12.17 — `OWES`: GATED BY THE `invoice.view` GRANT, PER ROW, ON THAT ROW'S OWN OWNER.
//     `keystone.user_may($1,'invoice','view',u.owner_user_id)` — same per-GRANT predicate every
//     other scope decision in this codebase uses, never a hand-rolled role check. A viewer without
//     the grant for THIS person's invoices gets NULL, not a wrong number and not a leaked one; the
//     list route (below, in routes/index.mjs) additionally drops the COLUMN outright for a viewer
//     who holds the grant nowhere at all, so the two checks are defense in depth, not duplicates.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const OWES = `
    CASE WHEN keystone.user_may($1, 'invoice', 'view', u.owner_user_id)
      THEN coalesce((SELECT po.owes_minor
              FROM keystone.person_owes po
             WHERE po.person_id = u.id), 0)
    END AS owes_minor,
    CASE WHEN keystone.user_may($1, 'invoice', 'view', u.owner_user_id)
      -- ★ A person who owes nothing has no person_owes row, so the currency was NULL and the screen
      --   (format.js: a money value with no currency is "Unpriced") printed "Unpriced" where the answer
      --   is "$0.00" — found in the 2 Oct 2026 browser check on Example Client, who owes exactly $0.
      THEN coalesce((SELECT po.currency
              FROM keystone.person_owes po
             WHERE po.person_id = u.id), 'USD')
    END AS owes_currency`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 12.17 — `PORTAL`: THE THREE RAW FACTS `portalStatus()` (`src/people/portalStatus.mjs`)
//     DECIDES FROM, NOT THE DECISION ITSELF. The pure function is the ONE place the four-way
//     decision (`invited | active | never_signed_in | bounced`) is made — see its own header on why
//     that must not be re-spelled per list. The list route (`routes/index.mjs`) applies it to each
//     row and deletes these three raw keys before the response goes out, so `has_ever_signed_in`/
//     `email_bounced_at`/`invited_at` never reach the wire — only `portal_status` does.
//   ★ `invited_at` matches by EMAIL, not by user id — an invite predates the person accepting it,
//     same idiom `/people/team/invites` (below) already reads this table with.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const PORTAL = `
    u.email_bounced_at,
    keystone.person_ever_signed_in(u.id) AS has_ever_signed_in,
    (SELECT max(i.created_at)
       FROM keystone.invite i
      WHERE i.tenant_id = u.tenant_id AND i.email = u.email) AS invited_at`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 12.17 — `STATUS`: 'lead' beats 'consent_unsigned' beats 'quiet_<n>_weeks' beats
//     'active', in that order — matching the priority the task names. "Quiet" needs an actual PAST
//     completed booking (`LAST_COMPLETED_AT < now() - 28 days`, which is NULL and so never true for
//     someone who has never had one) AND no upcoming booking; a brand-new client with zero bookings
//     ever therefore reads 'active', not a nonsensical "quiet for null weeks".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const STATUS = `
    CASE
      WHEN u.lifecycle_status = 'lead' THEN 'lead'
      WHEN u.role = 'adolescent_client' AND u.consent_status IS DISTINCT FROM 'granted'
        THEN 'consent_unsigned'
      WHEN ${LAST_COMPLETED_AT} < now() - interval '28 days' AND NOT ${UPCOMING_BOOKING}
        THEN 'quiet_' ||
             floor(extract(epoch FROM (now() - ${LAST_COMPLETED_AT})) / 604800)::int || '_weeks'
      ELSE 'active'
    END AS status`;

// ★ P2.1's identity/contact columns SURNAME/MOBILE and the plain STAGE column used to be shared
//   here; 12.17's rewrite of `/people/all`/`/people/clients`/`/people/adolescents` re-points them
//   at Who pays/Sessions/Owes/Status instead (see the task-12.17 header above), so nothing in this
//   file declares them any longer. `_shared.mjs` still exports `PERSON_COLUMNS`/`STAFF_COLUMNS`
//   for the descriptors that keep using them (`/people/team/invites`, `/people/team`).

// ★★ THE SELECT LIST EVERY PEOPLE VIEW SHARES. `personList()` in `_shared.mjs` selects five
//    columns and is still used verbatim by lists that need no more than that; the ones that DO
//    need more go through `peopleQuery`, which is the same query with a wider projection.
//  ★★★ IT DOES NOT RE-IMPLEMENT `scoped()`. `F142` — the per-GRANT predicate must stay SINGLE, and
//      a section file defining its own is a security defect, not a style one.
// ★ `program_ids` (QUEUE §4): the person's programs as ids; the screen maps ids → name/colour from the one programs list it already loads.
const BASE_SELECT =
  `u.id, u.display_name, u.last_name, u.email, u.mobile_phone, u.role, u.staff_role,
         u.lifecycle_status,
         coalesce((SELECT array_agg(pp.program_id ORDER BY pp.program_id) FROM keystone.person_program pp WHERE pp.person_id = u.id), '{}') AS program_ids`;

/**
 * The people query with a wider projection than `personList` gives.
 * @param extra  additional SELECT expressions, already aliased — or `''`
 * @param where  the list's own predicate
 */
const peopleQuery = (extra, where) => `
  SELECT ${BASE_SELECT}${extra ? `,\n         ${extra}` : ''}
    FROM keystone.app_user u
   WHERE ${scoped('person', 'u')} AND (${where})
   ORDER BY u.display_name, u.id`;

// ★★★ TASK 12.17 — the ONE extra projection `/people/all` and `/people/clients` share ("same
//     columns", per the plan). Type/Who pays/Sessions/Owes/Status/Portal, every one of them.
const PEOPLE_ALL_EXTRA = `${TAGS_EXPR},
       ${WHO_PAYS},
       ${SESSIONS},
       ${OWES},
       ${STATUS},
       ${PORTAL}`;

export const PEOPLE_LISTS = Object.freeze({
  // ══ PEOPLE — the list plus FIVE team filters ═══════════════════════════════

  // ★★★ TASK 12.17 — RE-POINTED FROM THE RAW P2.1 CONTACT COLUMNS TO THE DERIVED FACTS: Who pays,
  //     Sessions, Owes (money-gated, dropped from `columns` server-side for a viewer without
  //     `invoice.view` — see the list route), Status. `summarySql` adds `{clients, quiet}` beside
  //     the rows, read by the route and returned as `summary`.
  '/people/all': {
    title: 'People', recordType: 'person',
    columns: [
      NAME,
      { field: 'tags',       label: 'Tags',     format: 'tags' },
      { field: 'program_ids', label: 'Programs', format: 'programs' },
      { field: 'who_pays',   label: 'Who pays', format: 'text' },
      { field: 'sessions',   label: 'Sessions', format: 'number' },
      { field: 'owes_minor', label: 'Owes',      format: 'money', currency: 'owes_currency', requires: 'invoice.view' },
      { field: 'status',     label: 'Status',   format: 'enum' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsers',
      headline: 'Add your first person',
      line: 'Everyone your practice works with — clients, parents, leads and your own team.',
      action: { label: 'Add person', href: '/people/all?new=1' },
    }),
    sql: peopleQuery(PEOPLE_ALL_EXTRA, `u.role <> 'staff'`),
    // ★ `clients` = the practice's non-lead client rows this viewer can see; `quiet` = the subset of
    //   those with no COMPLETED booking in the last 30 days — a wider window than `STATUS`'s own
    //   28-day "quiet_<n>_weeks" threshold, deliberately: this is the round-number dashboard figure
    //   named in the plan ("quiet = active clients with no booking in 30 days"), not a re-derivation
    //   of the per-row label.
    summarySql: `
      SELECT
        count(*) FILTER (WHERE u.role IN ('adult_client', 'adolescent_client')
                            AND u.lifecycle_status <> 'lead')::int AS clients,
        count(*) FILTER (WHERE u.role IN ('adult_client', 'adolescent_client')
                            AND u.lifecycle_status <> 'lead'
                            AND NOT EXISTS (
                              SELECT 1
                                FROM keystone.booking_participant bp
                                JOIN keystone.booking b
                                  ON b.tenant_id = bp.tenant_id AND b.id = bp.booking_id
                               WHERE bp.app_user_id = u.id AND b.state = 'completed'
                                 AND b.starts_at >= now() - interval '30 days'))::int AS quiet
        FROM keystone.app_user u
       WHERE ${scoped('person', 'u')}`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ SECTION C (the maintainer, pasted brief, 1 Oct 2026) — "rebuild People tabs as Active (default) ·
  //     Lead · All · Paused · Former, driven by the existing lifecycle_status column, each with an
  //     Adult/Adolescent/Parent filter." `/people/all` and `/people/leads` already existed; these
  //     three are new — same role scope and same projection as `/people/all` (PEOPLE_ALL_EXTRA),
  //     narrowed to one lifecycle_status each. The Adult/Adolescent/Parent split is NOT three more
  //     descriptors — it is the SAME tag-filter-over-one-list idiom the 29 Sep ruling already
  //     established for `/people/all` (see that ruling's own comment above PEOPLE_CHILDREN in
  //     `src/nav/sections.mjs`): `tags` is already selected on every row here, and the screen
  //     filters client-side, exactly like its existing Status dropdown.
  '/people/active': {
    title: 'Active', recordType: 'person',
    columns: [
      NAME,
      { field: 'tags',       label: 'Tags',     format: 'tags' },
      { field: 'program_ids', label: 'Programs', format: 'programs' },
      { field: 'who_pays',   label: 'Who pays', format: 'text' },
      { field: 'sessions',   label: 'Sessions', format: 'number' },
      { field: 'owes_minor', label: 'Owes',      format: 'money', currency: 'owes_currency', requires: 'invoice.view' },
      { field: 'status',     label: 'Status',   format: 'enum' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsers',
      headline: 'No active clients yet',
      line: 'A client becomes active once they book, or when you move them here yourself.',
      action: { label: 'Add client', href: '/people/active?new=1' },
    }),
    sql: peopleQuery(PEOPLE_ALL_EXTRA,
      `u.role IN ('adult_client','adolescent_client') AND u.lifecycle_status = 'active'`),
    summarySql: `
      SELECT count(*)::int AS count
        FROM keystone.app_user u
       WHERE ${scoped('person', 'u')}
         AND u.role IN ('adult_client','adolescent_client') AND u.lifecycle_status = 'active'`,
  },

  '/people/paused': {
    title: 'Paused', recordType: 'person',
    columns: [
      NAME,
      { field: 'tags',       label: 'Tags',     format: 'tags' },
      { field: 'program_ids', label: 'Programs', format: 'programs' },
      { field: 'who_pays',   label: 'Who pays', format: 'text' },
      { field: 'sessions',   label: 'Sessions', format: 'number' },
      { field: 'owes_minor', label: 'Owes',      format: 'money', currency: 'owes_currency', requires: 'invoice.view' },
      { field: 'status',     label: 'Status',   format: 'enum' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsers',
      headline: 'Nobody is paused',
      line: 'Paused means taking a break, not leaving — they keep their record and come back to Active.',
      action: null,
    }),
    sql: peopleQuery(PEOPLE_ALL_EXTRA,
      `u.role IN ('adult_client','adolescent_client') AND u.lifecycle_status = 'paused'`),
    summarySql: `
      SELECT count(*)::int AS count
        FROM keystone.app_user u
       WHERE ${scoped('person', 'u')}
         AND u.role IN ('adult_client','adolescent_client') AND u.lifecycle_status = 'paused'`,
  },

  '/people/former': {
    title: 'Former', recordType: 'person',
    columns: [
      NAME,
      { field: 'tags',       label: 'Tags',     format: 'tags' },
      { field: 'program_ids', label: 'Programs', format: 'programs' },
      { field: 'who_pays',   label: 'Who pays', format: 'text' },
      { field: 'sessions',   label: 'Sessions', format: 'number' },
      { field: 'owes_minor', label: 'Owes',      format: 'money', currency: 'owes_currency', requires: 'invoice.view' },
      { field: 'status',     label: 'Status',   format: 'enum' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsers',
      headline: 'Nobody former yet',
      line: 'Former clients keep their whole record. Moving someone back to Active brings everything with them.',
      action: null,
    }),
    sql: peopleQuery(PEOPLE_ALL_EXTRA,
      `u.role IN ('adult_client','adolescent_client') AND u.lifecycle_status = 'former'`),
    summarySql: `
      SELECT count(*)::int AS count
        FROM keystone.app_user u
       WHERE ${scoped('person', 'u')}
         AND u.role IN ('adult_client','adolescent_client') AND u.lifecycle_status = 'former'`,
  },

  // ★★ P6.4 — the label. §2.7: THERE IS NO TRANSLATION LAYER AND THIS IS THE PLAIN ENGLISH WORD,
  //    on purpose. The NAV row already follows a tenant's rename (`sections.mjs:62` carries
  //    `termKey: 'userType.clientPlural'` with `fallback: 'Clients'`, resolved at `:277`); the LIST
  //    TITLE does not, because the title is read straight off this descriptor by
  //    `routes/index.mjs:562` and that file is not this batch's to edit.
  //  ★★★ SO THE SIDEBAR AND THE HEADING CAN DISAGREE FOR A RENAMED TENANT — sidebar "Members",
  //      heading "Clients". That is recorded in the handoff with the one-line fix rather than
  //      papered over here, because the fix belongs in the route and a second resolver in this
  //      file would be a second answer to the same question.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ GROUP A REWORK, WORKSTREAM 2 [TY, RULED 22 Sep 2026] — `example`/`rail`/`steps` PORTED
  //     VERBATIM FROM `specs/mockups/ListEmpty.frame.html`, READ FRESH THIS WORKSTREAM. `headline`
  //     was already right; `line` is now the frame's own sentence (was a paraphrase — "Adding one
  //     creates their record, their portal login and their document history" vs. the frame's "Each
  //     one gets a record, a private portal sign-in and their own document and payment history" —
  //     close enough to have shipped unnoticed, which is exactly the maintainer's complaint about this whole
  //     checkpoint: close is not the same as ported).
  //
  //   ★★ FLAGGED, NOT SILENTLY DROPPED: the frame also shows a photo beside the header. `/people/
  //      clients` is deliberately OUTSIDE the six checklist-tied routes `slatePhotoFor()` covers
  //      (`slatePhotos.js` — R6/R8's own tie-breaker, "photos only where a PRACTICE's setup
  //      sequence puts one, not all 26 first-run screens"). the maintainer named this frame's photo explicitly
  //      when he listed what's missing, which reads as overriding that tie-breaker for this one
  //      screen — but sourcing a new licensed, self-hosted, no-identifiable-person image with a
  //      recorded `PHOTO-SOURCES.md` provenance entry is its own task, not one to rush inside this
  //      edit. Left off this pass; `/people/clients` renders with no photo (an EmptyState with
  //      `photo=null` degrades to one column, by design) until that asset exists.
  //   ★ "Download template" (the frame's second rail link) is OMITTED, not ported: no template-
  //     generation capability exists anywhere in `src/` today, and a button that downloads nothing
  //     is the exact "a lie is a worse dead end than a silence" case this component's own header
  //     comment names. "Import a file" points at the real `/settings/import` screen instead.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 12.17 — "same columns" as `/people/all`, per the plan; only the predicate narrows.
  '/people/clients': {
    title: 'Clients', recordType: 'person',
    columns: [
      NAME,
      { field: 'tags',       label: 'Tags',     format: 'tags' },
      { field: 'program_ids', label: 'Programs', format: 'programs' },
      { field: 'who_pays',   label: 'Who pays', format: 'text' },
      { field: 'sessions',   label: 'Sessions', format: 'number' },
      { field: 'owes_minor', label: 'Owes',      format: 'money', currency: 'owes_currency', requires: 'invoice.view' },
      { field: 'status',     label: 'Status',   format: 'enum' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUserHeart',
      headline: 'Add your first client',
      line: `The people you coach. Each one gets a record, a private portal sign-in and their own document and payment history.`,
      action: { label: 'Add client', href: '/people/clients?new=1' },
    }),
    sql: peopleQuery(PEOPLE_ALL_EXTRA, `u.role = 'adult_client'`),
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P6.5 — MINORITY IS **DATED**, NOT ASSERTED BY ROLE.
  //
  //   0076 on `date_of_birth`: *"`role = adolescent_client` is a claim with no date behind it and
  //   nothing that expires; a date of birth answers itself."* So the list shows the DATE, and the
  //   AGE that date implies, and a reader can see for themselves whether the claim still holds.
  //
  // ★★ AGE IS DERIVED AT READ TIME AND IS NOT A COLUMN — deliberately, and `p2_person_fields` §5
  //    asserts the same about `next appointment`, `lifetime value` and `balance`. A stored age is
  //    wrong the day after it is written.
  //
  // ★★★ AND THE MEMBERSHIP PREDICATE STAYS `role`, WHICH IS NOT A CONTRADICTION — IT IS THE SAFE
  //     DIRECTION OF THE SAME ARGUMENT. `date_of_birth` is NULLABLE and [MEASURED] null for all 43
  //     people; a predicate of `age < 18` would return an EMPTY list and silently drop every
  //     adolescent whose birthday nobody has recorded. Dropping a minor from the minors list is a
  //     far worse failure than showing one whose date is unknown. ★ The screen therefore states
  //     the date and lets it be missing, which is the honest shape; the predicate does not
  //     pretend to know what the data does not say.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 12.17 — columns become Name · Age · Who pays · Sessions · Last came · State (`status`
  //     re-labelled — the same three-way/four-way decision `/people/all`'s Status column reads).
  //     `summarySql` adds `{count}`.
  '/people/adolescents': {
    title: 'Adolescents', recordType: 'person',
    columns: [
      NAME,
      // ★ the maintainer, 29 Sep 2026 — "tags shown on every row." Added alongside this list's own
      //   specialised columns (Age/Last came), which stay — the ruling asks for tags
      //   EVERYWHERE, not for these lists to become identical to `/people/all`.
      { field: 'tags',       label: 'Tags',      format: 'tags' },
      { field: 'age',        label: 'Age',       format: 'number' },
      { field: 'who_pays',   label: 'Who pays',  format: 'text' },
      { field: 'sessions',   label: 'Sessions',  format: 'number' },
      { field: 'last_came',  label: 'Last came', format: 'date' },
      { field: 'status',     label: 'State',     format: 'enum' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUserHeart',
      headline: 'No adolescent clients yet',
      line: 'Clients under 18. Each needs a parent or guardian linked before they can be booked.',
      action: { label: 'Add client', href: '/people/adolescents?new=1' },
    }),
    sql: peopleQuery(
      // ★★★ THE DATE ITSELF HAS TO BE SELECTED, NOT ONLY DECLARED. [EXECUTED 2026-09-15] the first
      //     version of this descriptor named `date_of_birth` as a column and selected only `age`;
      //     the cell rendered "—" for a person whose birthday the database held, and the list
      //     looked exactly like one over an empty column. A declared column the query does not
      //     return is the silent half of the "label without a value" defect P2.1 exists to fix.
      //     ★ `age` is no longer a DECLARED column (12.17 dropped `date_of_birth`/`Age`'s neighbour
      //       from `columns`), but it is still selected here — the value still needs a source, and
      //       an undeclared field costs nothing (same idiom as `child_links`/`caseload_count`).
      `${TAGS_EXPR},
         date_part('year', age(u.date_of_birth))::int AS age,
         ${WHO_PAYS},
         ${SESSIONS},
         ${LAST_CAME},
         ${STATUS}`,
      `u.role = 'adolescent_client'`),
    summarySql: `
      SELECT count(*)::int AS count,
             count(*) FILTER (WHERE u.consent_status IS DISTINCT FROM 'granted')::int AS waiting_consent
        FROM keystone.app_user u
       WHERE ${scoped('person', 'u')} AND u.role = 'adolescent_client'`,
  },

  // ★★★ P6.6 — a parent row NAMES ITS CHILDREN, and `child_links` lets a table open one. P1.6's
  //     own close record says *"§VISUAL is carried by P1 CLOSE; P6.6 (/people/parents) is where
  //     this link reaches a screen"* — this is that screen.
  //   ★★ [MEASURED 2026-09-15] `keystone.guardian` holds **0 rows** and `src/people/guardians.mjs`
  //      has no importer outside its own gate, so this column renders `—` in the live product
  //      today. The relation is real and enforced; nothing can yet WRITE one. Same shape as the
  //      P2.1 columns above, recorded rather than hidden.
  // ★★★ TASK 12.17 — title "Parents and payers"; predicate widens to every payer-group contact
  //     (12.5/CT-F27), not only `role = 'parent'`; `Children`/`child_links` STAY SELECTED
  //     (undeclared — see the header note above `CHILDREN_OF_U`) but the DECLARED columns become
  //     Name · Who pays (`'Pays for ' || n`, n = payer-group members they're the contact of PLUS
  //     guardian children) · State (`owing`/`paid_up`, gated on `invoice.view` same as `OWES`).
  '/people/parents': {
    title: 'Parents and payers', recordType: 'person',
    columns: [
      NAME,
      // ★ the maintainer, 29 Sep 2026 — "tags shown on every row."
      { field: 'tags',     label: 'Tags',      format: 'tags' },
      { field: 'who_pays', label: 'Who pays', format: 'text' },
      { field: 'state',    label: 'State',     format: 'enum' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsers',
      headline: 'No parents or guardians yet',
      line: 'A parent appears here once linked to an adolescent client.',
      action: { label: 'Add person', href: '/people/parents?new=1' },
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★★ TOUCH-UP · WORKSTREAM 6.1 — `ListNoPermission.frame.html``s two states for a Coach: a`
      //     populated list (`notice`, its banner text VERBATIM) and this file's own empty
      //     counterpart. A parent is linked automatically once an adolescent names one — a Coach
      //     never adds one directly regardless of the list's contents — so `action: null` here
      //     for the SAME reason services drops its CTA above: the "Add person" button works for an
      //     Owner/Admin but 403s for a Coach, and a control that fails for the viewer looking at it
      //     is the dead-control class this project does not ship (F401). `line` needs no second
      //     variant — "appears here once linked" was never a claim that YOU add one.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      noWrite: {
        action: null,
        notice: 'You can view parents. Adding or editing them is done by the practice owner.',
      },
    }),
    sql: peopleQuery(
      `${TAGS_EXPR},
         ${CHILDREN_OF_U(`string_agg(c.display_name, ', ' ORDER BY c.display_name)`)} AS children,
         ${CHILDREN_OF_U(
           `coalesce(json_agg(json_build_object('id', c.id, 'name', c.display_name)
                              ORDER BY c.display_name), '[]'::json)`)} AS child_links,
         'Pays for ' || (
           coalesce((SELECT count(*)::int
                       FROM keystone.payer_group_member pgm
                       JOIN keystone.payer_group pg
                         ON pg.tenant_id = pgm.tenant_id AND pg.id = pgm.payer_group_id
                      WHERE pg.contact_user_id = u.id AND pg.archived_at IS NULL), 0)
           + coalesce(${CHILDREN_OF_U('count(*)')}, 0)
         ) AS who_pays,
         CASE
           WHEN keystone.user_may($1, 'invoice', 'view', u.owner_user_id)
            AND coalesce((SELECT po.owes_minor
                            FROM keystone.person_owes po
                           WHERE po.person_id = u.id), 0) > 0
             THEN 'owing'
           ELSE 'paid_up'
         END AS state,
         ${PORTAL}`,
      // ★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role`; a guardian is any adult_client who
      //   holds a real `keystone.guardian` row (the Parent TAG, computed the same way TAGS_EXPR
      //   does). The payer-group-contact disjunct is UNCHANGED — this screen is "Parents and
      //   payers", deliberately wider than just the Parent tag (an employer paying for someone is
      //   a payer here with no guardian link at all).
      `EXISTS (SELECT 1 FROM keystone.guardian g WHERE g.guardian_user_id = u.id)
        OR u.id IN (SELECT contact_user_id FROM keystone.payer_group WHERE archived_at IS NULL)`),
    summarySql: `
      SELECT count(*)::int AS count
        FROM keystone.app_user u
       WHERE ${scoped('person', 'u')}
         AND (EXISTS (SELECT 1 FROM keystone.guardian g WHERE g.guardian_user_id = u.id)
              OR u.id IN (SELECT contact_user_id FROM keystone.payer_group WHERE archived_at IS NULL))`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P6.7 — RE-POINTED AT THE LIFECYCLE STATUS COLUMN. 0076 asked for this by name:
  //     *"**P6.7 re-points `/people/leads` at this.**"* A lead is now a STORED STATE rather than an
  //     absence, so moving somebody to `active` removes them from this list AND LEAVES BEHIND THE
  //     FACT THAT THEY WERE A LEAD — which the derived definition could not do, because there was
  //     nowhere for the fact to live.
  //
  // ★★★ THE ENGAGEMENT CLAUSES ARE STILL HERE AND THAT IS **TRANSITIONAL**, NOT A HEDGE — the same
  //     shape as 0075's `scope_not_yet_configured()` disjunct, and it is stated with its clearing
  //     condition exactly as 0075 states its own.
  //   ★★ WHY IT CANNOT BE DROPPED YET, MEASURED: `lifecycle_status` is `NOT NULL DEFAULT 'lead'`,
  //      0076 ships **no backfill**, and nothing in `src/` ever writes the column. [MEASURED
  //      2026-09-15] **43 of 43 people are 'lead'.** A predicate of `lifecycle_status = 'lead'`
  //      alone would therefore return EVERY client in the practice and call them all prospects —
  //      strictly worse than the definition it replaced.
  //   ★★★ CLEARING CONDITION, PRECISELY: when (a) a migration backfills `lifecycle_status` for the
  //       people who are demonstrably further along, and (b) a write path can set it, DELETE THE
  //       THREE `NOT EXISTS` CLAUSES. Until both hold, removing them is not a simplification — it
  //       is the list losing its meaning.
  //   ★ The column is load-bearing TODAY regardless: set a lead to 'active' and they leave this
  //     list immediately, with no booking, package or signature required. That is the re-point,
  //     and it is what my gate asserts by moving one person and re-reading.
  //
  // ★★ `role IN (client roles)` STAYS. It is not the stage question — it is the KIND question, and
  //    0076 is explicit that they are different axes. Without it a staff member or a parent who
  //    has never been moved off the default would be listed as a sales prospect.
  //
  // ★★★ TASK 12.17 — columns become Name · Sessions · State (`lead_next_step`, staff-set free
  //     text). `summarySql` adds `{count, fromBookingPageThisWeek}`. [MEASURED, this task —
  //     `grep -rn "source:" src/booking/publicBooking.mjs` → `src/booking/publicBooking.mjs:394`
  //     writes `source: "public_booking"`.] The plan's own literal `'booking_page'` is WRONG —
  //     settled here to the value the writer actually stamps, per the plan's own "settle at
  //     REFRESH" instruction, so the sub-count is a real count and not silently omitted.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  '/people/leads': {
    title: 'Leads', recordType: 'person',
    columns: [
      NAME,
      // ★ the maintainer, 29 Sep 2026 — "tags shown on every row."
      { field: 'tags',           label: 'Tags',      format: 'tags' },
      { field: 'sessions',       label: 'Sessions', format: 'number' },
      { field: 'lead_next_step', label: 'State',    format: 'text' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUserPlus',
      headline: 'No leads yet',
      line: 'Someone who has enquired but is not a client. Leads become clients when they book.',
      action: { label: 'Add lead', href: '/people/leads?new=1' },
    }),
    sql: peopleQuery(
      `${TAGS_EXPR},
         ${SESSIONS},
         u.lead_next_step,
         ${PORTAL}`,
      `u.role IN ('adult_client','adolescent_client')
      AND u.lifecycle_status = 'lead'
      AND NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp WHERE bp.app_user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM keystone.entitlement e
                       WHERE e.owner_user_id = u.id AND e.status = 'active')
      AND ${notExecutedAnyDocumentFragment('u')}`),
    summarySql: `
      SELECT
        count(*)::int AS count,
        count(*) FILTER (WHERE u.source = 'public_booking'
                            AND u.created_at >= now() - interval '7 days')::int
          AS "fromBookingPageThisWeek"
        FROM keystone.app_user u
       WHERE ${scoped('person', 'u')}
         AND u.role IN ('adult_client','adolescent_client')
         AND u.lifecycle_status = 'lead'
         AND NOT EXISTS (SELECT 1 FROM keystone.booking_participant bp WHERE bp.app_user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM keystone.entitlement e
                          WHERE e.owner_user_id = u.id AND e.status = 'active')
         AND ${notExecutedAnyDocumentFragment('u')}`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 12.17 — NEW. Archived people, using `scopedArchived` (`_shared.mjs`) rather than
  //     `scoped` — the seam that exists precisely because `scoped('person','u')` unconditionally
  //     appends `AND archived_at IS NULL` (P2.9), so a list whose SUBJECT is the archived state
  //     could never use it: it would read as correctly scoped and return zero rows, forever.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  '/people/archived': {
    title: 'Archived people', recordType: 'person',
    columns: [
      NAME,
      { field: 'tags',        label: 'Tags',        format: 'tags' },
      { field: 'archived_at', label: 'Archived on',  format: 'date' },
      { field: 'archived_by', label: 'Archived by',  format: 'text' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsers',
      headline: 'Nobody archived',
      line: 'Archived people are out of the way, not gone.',
      action: null,
    }),
    sql: `
  SELECT u.id, u.display_name, u.last_name, u.email, u.mobile_phone, u.role, u.staff_role,
         u.lifecycle_status,
         ${TAGS_EXPR},
         u.archived_at,
         ab.display_name AS archived_by
    FROM keystone.app_user u
    LEFT JOIN keystone.app_user ab
      ON ab.tenant_id = u.tenant_id AND ab.id = u.archived_by
   WHERE ${scopedArchived('person', 'u')} AND u.role <> 'staff'
   ORDER BY u.archived_at DESC, u.id`,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 1.2 (spec 01 §2 TeamList, §3) — TWO EXTRA, UNDECLARED SELECT EXPRESSIONS, ADDED HERE
  //     RATHER THAN GROWING A SECOND QUERY. `firebase_uid` is what TeamList's own bespoke screen
  //     joins against `GET /api/people/team/two-step-status` (§2's separate call, keyed by
  //     firebase_uid per §3's own wiring note); `caseload_count` is the "Access" column's "{n}
  //     clients" figure for a Coach row. Both are DELIBERATELY absent from `STAFF_COLUMNS` — an
  //     undeclared row field is never rendered by the generic `ListView` (`_shared.mjs`'s own
  //     `child_links` precedent gives the identical reason: "the identifier it carries cannot reach
  //     the DOM as text"). TeamList does not render through the generic ListView at all (it is a
  //     dedicated screen, `webui/src/lib/screens/people/TeamListScreen.svelte`), so this is purely
  //     extra data for that screen's own fetch of this SAME route — not a second declaration of it.
  // ★★★ TASK 12.17 — adds THREE more undeclared fields the same way: `sessions_this_year`
  //     (bookings HOSTED this calendar year, cancelled excluded (F98) — `host_id`, not `booking_participant`, unlike the
  //     People `SESSIONS` constant above), `where_they_work` (locations of shifts in the next 28
  //     days, OQ-12.9), `away` (current/upcoming time off in the next 28 days, or absent).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  '/people/team': {
    title: 'Team', recordType: 'person', columns: STAFF_COLUMNS,
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsersGroup',
      headline: 'Invite your first colleague',
      line: `Coaches, admins and anyone else who signs in. You are the only one here so far.`,
      action: { label: 'Invite', href: '/people/team?invite=1' },
    }),
    sql: peopleQuery(
      `u.firebase_uid,
       (SELECT count(*)::int FROM keystone.app_user c
          WHERE c.owner_user_id = u.id AND c.archived_at IS NULL) AS caseload_count,
       (SELECT count(*)::int FROM keystone.booking b
          WHERE b.tenant_id = u.tenant_id AND b.host_id = u.id AND b.state <> 'cancelled'
            AND b.starts_at >= date_trunc('year', now())
            AND b.starts_at < date_trunc('year', now()) + interval '1 year') AS sessions_this_year,
       (SELECT string_agg(DISTINCT l.name, ', ' ORDER BY l.name)
          FROM keystone.staff_shift ss
          JOIN keystone.location l ON l.tenant_id = ss.tenant_id AND l.id = ss.location_id
         WHERE ss.tenant_id = u.tenant_id AND ss.app_user_id = u.id
           AND ss.on_date BETWEEN current_date AND current_date + 28) AS where_they_work,
       (SELECT 'Away ' || to_char(t.starts_on, 'FMDD') || '–' || to_char(t.ends_on, 'FMDD Mon')
          FROM keystone.time_off t
         WHERE t.tenant_id = u.tenant_id AND t.app_user_id = u.id
           AND t.starts_on <= current_date + 28 AND t.ends_on >= current_date
         ORDER BY t.starts_on
         LIMIT 1) AS away`,
      // ★ RUN-2 T9 (26 Sep 2026): a person offboarded (src/people/offboard.mjs step 10 sets
      //   lifecycle_status 'former') no longer holds a seat (src/people/seats.mjs:24) and is no
      //   longer on the team — the roster excluded nobody, so it disagreed with the seat count.
      `u.role = 'staff' AND u.lifecycle_status <> 'former'`),
  },
  // ★★★ TASK 1.2 (spec 01 §11) — THE FOUR ROLE-SPLIT ROWS ARE RETIRED HERE, NOT JUST LEFT UNLINKED.
  //     `super-admin-1`, `super-admins`, `admins` and `coaches` used to be separate queries below this
  //     comment; §11 says it in as many words: "TeamList (§2) replaces the four role-split lists
  //     (super-admin-1, super-admins, admins, coaches) with the one combined roster." `/people/team`
  //     above is that one combined roster now (every staff row, one query), so a person reachable
  //     from any of the four old paths is reachable from `/people/team` — nothing here goes dark, the
  //     four ways of asking for a subset of it are gone. The matching nav children are removed in the
  //     SAME change (`src/nav/sections.mjs`'s `PEOPLE_CHILDREN.team.children`). `/people/team/invites`
  //     immediately below is untouched — §11 keeps it, unchanged, and TeamList's own pending-invites
  //     section reads it as-is.

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 8.15 — `/people/team/invites` IS NOW REAL. P6.13's refusal above (kept in git history,
  //     not reproduced here) gave three reasons: no table, nothing to resend, nothing to revoke.
  //     `keystone.invite` (8.1/0202), `resendInvite` (8.14b, composing 8.6's `createInvite`/
  //     `revokeInvite`) and `revokeInvite` itself answer all three — LISTED here, RESENT by
  //     `PersonActions.svelte`'s dialog, REVOKED as a side effect of every resend. `buildState.mjs`'s
  //     matching refusal row is deleted in the SAME task, per `p6_all_83_rows.mjs` §5 (see below).
  //
  // ★★ `status` IS DERIVED IN SQL, NEVER STORED — a stored status column and the timestamps it was
  //    copied from disagree the first time one write misses, and then the screen and the truth are
  //    two different things. `accepted` beats `revoked` beats `expired` beats the default `pending`,
  //    in that order, matching `keystone.invite`'s own `invite_not_both` CHECK (0202) that an
  //    `accepted_at` and a `revoked_at` never coexist.
  //
  // ★★★ THE SCOPE PREDICATE IS ON THE INVITER, NOT THE INVITEE. `u` here is the STAFF person who
  //     sent the invitation (`i.invited_by`), and every staff row owns itself
  //     (`app_user_staff_owns_self_trg`, 0071) — so `scoped('person', 'u')` reads exactly as "can
  //     this viewer see the person who sent this invitation", which for a Coach (`person: owned`)
  //     is true only for their OWN invitations and for an Admin/Owner (`person: everything`) is
  //     true for every invitation the practice has sent. Same single predicate every other list in
  //     this file uses, not a second hand-written scope.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  '/people/team/invites': {
    title: 'Invites', recordType: 'person',
    columns: [
      EMAIL,
      // ★ F154 (23 Oct 2026): the screen shows words ("Coach", "Accepted"), not the stored values ("staff", "accepted").
      { field: 'role_label',      label: 'Role',       format: 'text' },
      { field: 'invited_by_name', label: 'Invited by', format: 'text' },
      { field: 'sent_at',         label: 'Sent',        format: 'date' },
      { field: 'status_label',    label: 'Status',      format: 'text' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUserPlus',
      headline: 'No invitations sent',
      line: 'Invite someone from Team, and it will show up here until they accept it.',
      action: { label: 'Invite', href: '/people/team' },
    }),
    sql: `
  SELECT i.id, i.email, i.role AS invited_role, i.staff_role AS invited_staff_role, u.display_name AS invited_by_name,
         i.created_at AS sent_at,
         CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted'
              WHEN i.revoked_at  IS NOT NULL THEN 'revoked'
              WHEN i.expires_at < now()      THEN 'expired'
              ELSE 'pending' END AS status,
         CASE WHEN i.accepted_at IS NOT NULL THEN 'Accepted'
              WHEN i.revoked_at  IS NOT NULL THEN 'Cancelled'
              WHEN i.expires_at < now()      THEN 'Expired'
              ELSE 'Waiting' END AS status_label,
         CASE i.staff_role WHEN 'owner' THEN 'Owner' WHEN 'admin' THEN 'Admin' WHEN 'member' THEN 'Coach'
              ELSE initcap(replace(i.role, '_', ' ')) END AS role_label
    FROM keystone.invite i
    JOIN keystone.app_user u ON u.tenant_id = i.tenant_id AND u.id = i.invited_by
   WHERE ${scoped('person', 'u')}
   ORDER BY i.created_at DESC, i.id`,
  },

  // ══ ACCOUNTS ═══════════════════════════════════════════════════════════════
});
