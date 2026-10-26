// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B9 — GROWTH. TWO ROWS THAT EXIST IN THE DATABASE AND HAD NO READ PATH.
//
// ★★★ THE TABLES WERE ALREADY THERE. `keystone.campaign` and `keystone.segment` were built by
//     P20.11, and `buildState.mjs` said so IN THE ROW'S OWN REASON — *"keystone.campaign EXISTS
//     (P20.11); no read path/list descriptor is written yet."* The row was honest about being
//     unbuilt and specific about why; this item is the descriptor that reason was waiting for.
//
// ★★ A LIST IS A SAVED FILTER, NEVER A SECOND SUBSCRIBER STORE. That ruling is why `/growth/lists`
//    reads `segment` — one row holding a `filter` — instead of a table of copied people. A second
//    store of who-is-a-person is a second answer that drifts the moment anyone is archived.
// ★ `/growth/funnels` and `/growth/pages` are CUT (Part G) and stay refusing: the Astro sites do
//   that work, and rebuilding Listmonk one ruling after cutting Listmonk would be the wrong lesson
//   learned twice.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { scoped, emptyOf,
} from "./_shared.mjs";

export const GROWTH_LISTS = Object.freeze({
  '/growth/campaigns': {
    title: 'Campaigns', recordType: null,
    columns: [
      { field: 'name',            label: 'Campaign', format: 'text' },
      { field: 'segment_name',    label: 'Audience', format: 'text' },
      { field: 'state',           label: 'State',    format: 'enum' },
      { field: 'recipient_count', label: 'Recipients', format: 'number' },
      { field: 'sent_at',         label: 'Sent',     format: 'datetime' },
    ],
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconSpeakerphone',
      headline: 'No campaigns yet',
      line: 'A campaign sends one message to one list.',
      action: { label: 'New campaign', href: '/growth/campaigns?new=1' },
      blockedAction: { label: 'Create a list', href: '/growth/lists?new=1' },
      blockedLine: 'A campaign needs a list to send to, and you have not built one yet.',
    }),
    sql: `SELECT c.id, c.name, c.state, c.recipient_count, c.sent_at,
                 coalesce(s.name, '— list deleted —') AS segment_name
            FROM keystone.campaign c
            LEFT JOIN keystone.segment s ON s.id = c.segment_id
           WHERE ${scoped('campaign', 'c')}
           ORDER BY coalesce(c.sent_at, c.created_at) DESC, c.id`,
  },

  '/growth/lists': {
    title: 'Lists', recordType: null,
    columns: [
      { field: 'name',       label: 'List',        format: 'text' },
      { field: 'used_by',    label: 'Campaigns',   format: 'number' },
      { field: 'created_at', label: 'Created',     format: 'date' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconList',
      headline: 'Create your first list',
      line: 'A group of people you send to. Build it from clients, leads or anyone in People.',
      action: { label: 'Create list', href: '/growth/lists?new=1' },
    }),
    // ★ RUN-2 C3 — `seed_key` added: Segments.svelte splits "keep themselves up to date" from "made by
    //   hand" on it, and without it every seeded list was filed as hand-made.
    sql: `SELECT s.id, s.name, s.created_at, s.seed_key,
                 (SELECT count(*) FROM keystone.campaign c WHERE c.segment_id = s.id)::int AS used_by
            FROM keystone.segment s
           WHERE ${scoped('segment', 's')}
           ORDER BY s.name, s.id`,
  },

  '/growth/pages': {
    title: 'Landing pages', recordType: null,
    columns: [
      { field: 'slug',         label: 'Slug',         format: 'text' },
      { field: 'title',        label: 'Title',        format: 'text' },
      { field: 'is_published', label: 'Published',    format: 'boolean' },
      { field: 'created_at',   label: 'Created',      format: 'date' },
    ],
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconFileText',
      headline: 'Create your first landing page',
      line: 'A publishable marketing page where potential clients learn about your practice.',
      action: { label: 'New page', href: '/growth/pages?new=1' },
    }),
    // ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): crashed production on boot —
    //   `ownerExpr` throws on an unrecognized permission OBJECT, and 'landing_page' is this
    //   table's NAME, not a registered object (ownership.mjs's own header warns object and
    //   table differ for some entries). `site` is the documented object for "a practice's
    //   client site(s) (05 §10)... configuration, not a record with a coach attached" — the
    //   closest, and correct, match for a landing page.
    sql: `SELECT lp.id, lp.slug, lp.title, lp.body, lp.is_published, lp.published_at, lp.created_at, lp.updated_at
            FROM keystone.landing_page lp
           WHERE ${scoped('site', 'lp')}
           ORDER BY lp.created_at DESC, lp.id`,
  },
});
