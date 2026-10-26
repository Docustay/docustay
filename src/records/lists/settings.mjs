// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B12 — THE SETTINGS SECTION'S LIST DESCRIPTORS (P6.68 · P6.73 · P6.74).
//
// ★★★ THREE OF THE EIGHTEEN SETTINGS ROWS ARE LISTS, AND A LIST DESCRIPTOR IS THE CHEAPEST HONEST
//     READ PATH IN THIS PROJECT. `GET /api/list/*` already authorises the section, binds the viewer
//     as `$1` and hands `ListView` its columns — so a descriptor here needs NO new route, NO
//     `App.jsx` entry and NO `api.js` tap, and the row works the moment this module is merged into
//     the index. The other fifteen rows are forms, redirects, or rows that already have a route.
//
// ★★★ AND THREE IS THE NUMBER **BECAUSE TWO READ PATHS FOR ONE ROW IS THE DEFECT THIS BATCH WAS
//     SENT TO FIX.** `api.view(path)` tries `/api/list{path}` FIRST and only falls back — so a
//     descriptor written over a row that already has a dedicated route does not supplement it, it
//     SILENTLY WINS and the route becomes dead code. That is exactly what happened to
//     `/settings/integrations`, where `App.jsx` intercepts before the `DEDICATED` lookup and both
//     `DEDICATED["/settings/integrations"]` and `api.integrations` are unreachable.
//   ★★ SO TWO DESCRIPTORS WERE WRITTEN AND DELETED AGAIN, DELIBERATELY:
//      · `/settings/roles` — a GRID needs a vocabulary (objects × verbs × scopes) and has to grey
//        out the scope control for the ownerless `setting` object. A flat column list cannot carry
//        that, so `GET /api/settings/roles` is the truth.
//      · `/settings/developer/audit-log` — `GET /api/developer/audit-log` already exists, is
//        authorised (`P0.4`), and resolves wording through `TOPIC_WORDING`'s fifty curated
//        sentences. A descriptor would have had to re-derive that wording in SQL: a second answer
//        to "what happened", and the newer one is always the wrong one.
//
// ★★ `scoped('setting', …)` RESOLVES TO `$1::uuid IS NOT NULL` AND THAT IS THE CORRECT ANSWER, NOT
//    A MISSING ONE. `setting` is in `OWNERLESS_OBJECTS` (`src/permissions/objects.mjs`) — a
//    practice's configuration has no coach attached to it — so `_shared.mjs:scoped()` emits the
//    fail-closed arity check rather than a `user_may` that would refuse everything below
//    `everything` a second time. ★ The REAL boundary on these rows is `authoriseSection`, and
//    `/settings` is `minRole: 'admin'` (`src/nav/sections.mjs:50`), inherited by every child.
//
// ★ NO `tenant_id` PREDICATE, DELIBERATELY. FORCE RLS applies it to every table below; a second
//   hand-written copy is the one that drifts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { scoped, emptyOf,
} from "./_shared.mjs";
import { documentCountRowFragment } from "../../documents/api.mjs";

export const SETTINGS_LISTS = Object.freeze({
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // P6.68 — /settings/data · WHAT THIS PRACTICE HOLDS, AND WHEN IT LAST CHANGED
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ THE ROW IS AN OBJECT, NOT A RECORD, AND THAT IS WHAT MAKES THIS AN EXPORT SCREEN. "A tenant
  //     exports their own data" (P6.68's PROVES) begins with the tenant being able to SEE what
  //     there is to export. A list of every person and every invoice is the other eleven screens.
  // ★★★ EVERY BRANCH CARRIES **ITS OWN OBJECT'S** SCOPE PREDICATE, AND THE FIRST VERSION OF THIS
  //     DESCRIPTOR DID NOT. It used `scoped('setting', …)` on all six branches, reasoning that this
  //     is a settings screen. `setting` is OWNERLESS, so `scoped()` correctly emitted the bare
  //     `$1::uuid IS NOT NULL` arity guard — and every count was then unscoped.
  //   ★★ THAT IS NARROW ON THE ROW AXIS AND **SILENT ON THE VERB AXIS** (`F253`, made twice in one
  //      phase). A coach holding `person: none` still got a People count: the number discloses the
  //      SIZE of what they may not see, and then links to a list that returns nothing. `lists.mjs`
  //      already records that exact defect on the home tiles — `a coach whose /people/all returned`
  //      2 rows saw a People tile reading 9" — and this reproduced it one screen over.
  //   ★ `db/gates/p1_scope_wired.mjs` caught it, by deriving "is this over an ownable object" from
  //     whether the SQL names `keystone.app_user` rather than from a map somebody maintains.
  // ★ `event` is not one of the eleven permission objects; the audit count keeps the ownerless
  //   `setting` predicate, which is the honest answer rather than a borrowed one.
  // ★★★ AND THE COLUMN IS LABELLED "VISIBLE TO YOU", NOT "RECORDS HELD", BECAUSE THAT IS WHAT IT
  //     NOW COUNTS. Scoping the counts correctly created a second, subtler dishonesty: a scoped 0
  //     and a genuine 0 render identically, so "you may not see any invoices" and "there are no
  //     invoices" would share a number — the empty-versus-denied collapse P4.10 exists to stop.
  //     Naming the column after the question it actually answers resolves it without inventing a
  //     per-object permission probe this screen has no other use for.
  // ★★★ AND THE OUTER `$1::uuid IS NOT NULL` GUARD — MY OWN GATE FOUND IT MISSING. The per-branch
  //     `scoped()` fails closed on the ROWS, but every branch is an AGGREGATE, and `count(*)` over
  //     zero rows still returns ONE ROW containing 0. So with no viewer this returned SIX ROWS OF
  //     ZERO: it disclosed nothing, and it said "this practice holds nothing" — a false statement
  //     about the world rather than a refusal. The arity guard has to be repeated on the OUTER
  //     select, because an aggregate leaves nothing for a WHERE to remove.
  // ★★ THE COMMENT LIVES HERE AND NOT IN THE SQL, AND THAT IS NOT A PREFERENCE (`F243`): the SQL is
  //    a TEMPLATE LITERAL, and a backtick inside it TERMINATES THE STRING. Writing this reasoning
  //    as a `--` comment beside the query broke module load for the whole file — and, through the
  //    index, for every other section's descriptors at once.
  // ★★★ NO "EXPORT" BUTTON IS DRAWN, AND THE EMPTY/NOTICE COPY SAYS WHY. There is no export route
  //     and no archive writer in this system [MEASURED: nothing in `src/` produces a tenant
  //     archive]. A button that produced no file would be the dead control this phase exists to
  //     remove, on the screen whose entire promise is "you can take your data with you".
  '/settings/data': {
    title: 'Data and audit',
    columns: [
      { field: 'object', label: 'Object',       format: 'text' },
      { field: 'held',   label: 'Visible to you', format: 'number' },
      { field: 'newest', label: 'Most recent',  format: 'datetime' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconDatabase',
      headline: 'Nothing recorded yet',
      line: 'Every object in your practice and when it last changed. This fills as you use the product.',
      action: null,
    }),
    sql: `
      SELECT * FROM (
        SELECT 'People'::text AS id, 'People'::text AS object,
               count(*)::int AS held, max(u.created_at) AS newest
          FROM keystone.app_user u WHERE ${scoped('person', 'u')}
        UNION ALL
        SELECT 'Accounts', 'Accounts', count(*)::int, max(a.created_at)
          FROM keystone.account a WHERE ${scoped('account', 'a')}
        UNION ALL
        ${documentCountRowFragment('d')}
        UNION ALL
        SELECT 'Sessions', 'Sessions', count(*)::int, max(b.created_at)
          FROM keystone.booking b WHERE ${scoped('engagement', 'b')}
        UNION ALL
        SELECT 'Invoices', 'Invoices', count(*)::int, max(i.created_at)
          FROM keystone.invoice i WHERE ${scoped('invoice', 'i')}
        UNION ALL
        SELECT 'Audit events', 'Audit events', count(*)::int, max(e.created_at)
          FROM keystone.event e WHERE ${scoped('setting', 'e')}
      ) held
       -- THE OUTER GUARD. See the note above the descriptor for why it is here.
       WHERE $1::uuid IS NOT NULL
       ORDER BY held DESC, object`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // P6.73 — /settings/developer/webhooks
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ THE SECRET IS NOT IN THIS QUERY AND MUST NEVER BE. `webhook_endpoint` carries
  //     `secret_envelope` (the wrapped secret) and `secret_fingerprint`. Only the FINGERPRINT is
  //     selected — an integrator needs to tell two endpoints apart, they do not need the key back,
  //     and there is no route in this product that can return one. The same law as the API key.
  // ★★ `disabled_reason` IS A COLUMN, because "disabled" and "disabled after twelve consecutive
  //    failures" are different facts and only the second one can be acted on.
  // ★★★ THE "FIRST BLOCKER IS A SECRET" NOTE THAT USED TO BE HERE WAS STALE, AND IT WAS LOAD-
  //     BEARING — IT IS WHY THE `?new=1` LINK BELOW WENT NOWHERE FOR SO LONG. It said
  //     `KEYSTONE_MASTER_KEY` was "provisioned nowhere", so no endpoint could be registered and a
  //     create button "would fail on press". Every session that read it re-concluded that the
  //     missing button was correct.
  //   ★★ BOTH HALVES ARE NOW FALSE, MEASURED 2026-09-16:
  //      · the key EXISTS in Secret Manager as `keystone-master-key` (F306, since 14 September);
  //      · and it is SET on the deployed service — `KEYSTONE_MASTER_KEY` is present in
  //        `keystone-app`'s production variables.
  //   ★★★ SO THE BUTTON IS REAL AS OF A12.1, and `Screen.svelte` answers this exact `?new=1`.
  //       ★ THE LESSON IS THE FINDING, NOT THE KEY: a comment recording a BLOCKER outlives the
  //         blocker, and unlike a failing test nothing turns red when it stops being true. This one
  //         cost the product its entire webhook-registration surface — and with it n8n's route to
  //         the 79 topics that have no handler — for as long as it sat here unchallenged.
  '/settings/developer/webhooks': {
    title: 'Webhooks',
    columns: [
      { field: 'name',      label: 'Endpoint',  format: 'text' },
      { field: 'url',       label: 'URL',       format: 'text' },
      { field: 'status',    label: 'Status',    format: 'enum' },
      { field: 'events',    label: 'Events',    format: 'number' },
      { field: 'delivered', label: 'Delivered', format: 'number' },
      { field: 'failing',   label: 'Failing',   format: 'number' },
      { field: 'detail',    label: 'Detail',    format: 'text' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconWebhook',
      headline: 'No endpoints yet',
      line: 'Send events to another system as they happen — n8n, Zapier, or your own.',
      action: { label: 'Add endpoint', href: '/settings/developer/webhooks?new=1' },
    }),
    sql: `
      SELECT w.id, w.name, w.url, w.status,
             coalesce(array_length(w.event_types, 1), 0) AS events,
             (SELECT count(*)::int FROM keystone.webhook_delivery d
               WHERE d.endpoint_id = w.id AND d.status = 'delivered') AS delivered,
             -- ★ Stage 3 T7 fix 1 (review T7-R5): FAILING counts (event, endpoint) PAIRS whose LATEST attempt
             --   did not deliver — not attempt rows. With retries, one pair that failed once and then delivered
             --   used to count 1, and one dead pair 6. An in-flight attempt is not failing.
             (SELECT count(*)::int FROM (
                SELECT DISTINCT ON (d.event_id) d.status
                  FROM keystone.webhook_delivery d
                 WHERE d.endpoint_id = w.id AND d.tenant_id = w.tenant_id
                 ORDER BY d.event_id, d.attempt DESC) latest
               WHERE latest.status IN ('failed','timed_out')) AS failing,
             coalesce(w.disabled_reason,
                      'signing key ' || left(w.secret_fingerprint, 12)) AS detail
        FROM keystone.webhook_endpoint w
       WHERE ${scoped('setting', 'w')}
         AND NOT (w.status = 'disabled' AND w.disabled_reason IS NOT DISTINCT FROM 'removed')   -- R13-D423
       ORDER BY w.created_at DESC, w.id`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // P6.74 — /settings/developer/embeds · THE STAFF-SIDE READ THAT `F94` SAYS IS MISSING
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ `embed_submission` IS INSERT-ONLY FOR THE `app_embed` ROLE **BY DESIGN, AND THAT DESIGN
  //     STAYS** (P6.74). A public form posts in and can read nothing back — that is the whole point
  //     of a publishable credential. The gap `F94` names is the OTHER end: **no staff surface could
  //     display a submission**, so a lead captured by an embedded form landed in a table nobody in
  //     the practice could open. This descriptor is that end, and it changes no policy: it is read
  //     by a STAFF session under `/settings` (`minRole: admin`), a different principal entirely.
  // ★ `promoted` says whether the submission became a person yet. A submission list without it
  //   reads as a backlog that never moves.
  '/settings/developer/embeds': {
    title: 'Embed submissions',
    columns: [
      { field: 'source',       label: 'Source',    format: 'text' },
      { field: 'summary',      label: 'Submitted', format: 'text' },
      { field: 'submitted_at', label: 'Received',  format: 'datetime' },
      { field: 'promoted',     label: 'Promoted',  format: 'text' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconCode',
      headline: 'No submissions yet',
      line: 'Forms embedded on your website drop their submissions here.',
      action: { label: 'Get embed code', href: '/settings/developer/embeds?embed=1' },
    }),
    sql: `
      SELECT s.id, s.source, s.submitted_at,
             left(coalesce(s.payload->>'email', s.payload->>'name',
                           s.payload->>'display_name', s.payload::text), 80) AS summary,
             CASE WHEN s.promoted_at IS NULL THEN 'not yet'
                  ELSE coalesce(s.promoted_to::text, 'yes') END AS promoted
        FROM keystone.embed_submission s
       WHERE ${scoped('setting', 's')}
       ORDER BY s.submitted_at DESC, s.id
       LIMIT 200`,
  },
});
