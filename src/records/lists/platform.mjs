// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b — THE PLATFORM SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ★ S2.2 — the empty-state helper. This module deliberately imports nothing else from
//   `_shared.mjs` (see the note above); the empty state is the one shared piece it needs.
import { emptyOf } from "./_shared.mjs";

export const PLATFORM_LISTS = Object.freeze({
  '/platform/jobs': {
    title: 'Job queue',
    columns: [
      // ★★★ `queue` IS FIRST BECAUSE THERE ARE TWO OF THEM AND THE SCREEN SHOWED ONE. Without this
      //     column the two are indistinguishable and the list reads as a single healthy queue.
      { field: 'queue',      label: 'Queue',    format: 'enum' },
      { field: 'topic',      label: 'Topic',    format: 'text' },
      { field: 'emitted_by', label: 'Section',  format: 'enum' },
      { field: 'queue_state', label: 'State',   format: 'text' },
      { field: 'attempts',   label: 'Attempts', format: 'number' },
      { field: 'created_at', label: 'Raised',   format: 'datetime' },
      // ★ Stage 4 Task 8 — the give-up's plain reason (07 §4.7), exactly as the ledger stored it.
      { field: 'reason',     label: 'Why',      format: 'text' },
    ],
    // ★★★ F4 — `claimed` READS AS "IN PROGRESS" FOREVER. [MEAS 0016:68-81] claim_events selects
    //     WHERE status IN ('pending','failed'); 'claimed' is not in that list, and `claimed_at` is
    //     written and READ BY NOTHING. A worker that claims and crashes loses the event silently.
    //     ★ Until P18.6(a) adds the lease, this screen must not print the bare word `claimed` as
    //       though it meant work in flight — it says STUCK once the row is older than the lease
    //       window the fix will use. A screen that repeats a defect's vocabulary hides it.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconServer',
      headline: 'No jobs in the queue',
      line: 'Background work — emails, provisioning, reports. An empty queue is healthy.',
      action: null,
    }),
    // ★ Stage 4 Task 8: give-ups sort FIRST — under a plain newest-first LIMIT, an old unacknowledged give-up would be
    //   pushed off the screen by the next 200 routine outbox rows, which is the silence 07 §4 rule 6 forbids.
    sql: `
     SELECT * FROM (
      SELECT e.id::text AS id, 'outbox' AS queue, e.topic, e.emitted_by, e.attempts, e.created_at,
             CASE
               WHEN e.status = 'claimed' AND e.claimed_at < now() - interval '15 minutes'
                 THEN 'STUCK — claimed ' || floor(EXTRACT(epoch FROM now() - e.claimed_at) / 60)::int
                      || ' min ago and never released'
               WHEN e.status = 'claimed' THEN 'Claimed'
               ELSE initcap(e.status)
             END AS queue_state,
             NULL::text AS reason,
             NULL::bigint AS failure_id, NULL::int AS repeat_count, NULL::timestamptz AS last_seen_at,
             2 AS sort_group, e.created_at AS sort_at
        FROM keystone.event e
       WHERE $1::uuid IS NOT NULL
      UNION ALL
      SELECT j.id AS id, 'worker' AS queue, j.topic,
             'worker' AS emitted_by, j.attempts, j.run_at AS created_at,
             CASE
               WHEN j.attempts >= j.max_attempts
                 THEN 'PERMANENTLY FAILED after ' || j.attempts || ' attempts'
               WHEN j.last_error IS NOT NULL
                 THEN 'FAILING (' || j.attempts || '/' || j.max_attempts || ') — '
                      || regexp_replace(j.last_error, '\\s+', ' ', 'g')
               ELSE 'Queued'
             END AS queue_state,
             NULL::text AS reason,
             NULL::bigint AS failure_id, NULL::int AS repeat_count, NULL::timestamptz AS last_seen_at,
             2 AS sort_group, j.run_at AS sort_at
        -- ★★★ THROUGH A FUNCTION, NOT THE TABLE, AND THE REASON IS A SECURITY BOUNDARY I BROKE.
        --     Migration 0105 granted the application request role USAGE on the worker schema so this
        --     branch could read the jobs table directly. p21a_role_matrix asserts in terms that the
        --     request role must have NEITHER the queue schema nor the tenant lister: the
        --     two-identity split (one role serves requests, another runs the queue) is a real
        --     containment boundary, so a request-path injection cannot read or rewrite the queue.
        --     ★★ I did not edit that test; I widened the SYSTEM until its subject stopped being
        --        true, which is the same defect wearing a disguise. 0106 revokes the grants.
        --   ★ The function is SECURITY DEFINER, owned by the auth owner, and gated INSIDE itself on
        --     caller_is_platform() — the same shape the tenant lister uses. A non-platform caller
        --     gets zero rows rather than an error, so the queue's existence is not leaked either.
        --   ★★ AND NOTE THE BACKTICKS ARE GONE FROM THIS COMMENT ON PURPOSE. It lives inside a JS
        --      template literal, where a backtick TERMINATES THE STRING and breaks module load for
        --      every gate that imports this file. That is F243, and I wrote it here one hour after
        --      warning another agent about it. Describe the shape; never quote the identifier.
        FROM keystone.platform_list_worker_jobs() j
       WHERE $1::uuid IS NOT NULL
      UNION ALL
      -- ★★★ STAGE 4 TASK 8 — EVERY GIVE-UP HAS AN OWNER (07 §4 rule 6). The give-up ledger's UNACKNOWLEDGED rows,
      --     through a platform-gated definer (0156) like the branch above: a practice's context gets zero rows. A row
      --     that counts repeats says how many and when the last was (task-6-report Q3: one open give-up, not one a
      --     minute). A practice-owned give-up ALSO has a task in that practice; the platform still sees all of them.
      SELECT 'gave_up:' || f.id AS id, 'gave up' AS queue, f.task_identifier AS topic,
             'worker' AS emitted_by, NULL::int AS attempts, f.gave_up_at AS created_at,
             'GAVE UP — not yet acknowledged'
               || CASE WHEN f.repeat_count > 1
                       THEN ' · ' || f.repeat_count || ' times, last ' || to_char(f.last_seen_at, 'YYYY-MM-DD HH24:MI')
                       ELSE '' END
               -- ★★ R69b (0158) — only when EVERY give-up counted on this row has been handed to a practice task.
               --    One un-owned give-up on the row and this line must not appear: it would say somebody is on it
               --    when nobody is, which is the whole harm R69b exists to prevent.
               || CASE WHEN f.handed_off_count >= f.identity_count THEN ' · handed to the practice' ELSE '' END
               || coalesce(' · practice ' || left(f.tenant_id::text, 8), '') AS queue_state,
             f.reason AS reason,
             -- ★★★ STAGE 4 TASK 10 — WHAT THE TWO BUTTONS NEED, AND THE THIRD IS THE ONE THAT MATTERS.
             --     failure_id is WHICH give-up to act on; repeat_count and last_seen_at are the VERSION the
             --     person had on screen. Both actions send them back and 0160 refuses the write if either moved
             --     (progress.md M-3): between the load and the click a give-up can repeat, and the reason they
             --     typed would then be about a smaller problem than the one they are closing.
             --   ★ Every branch of this UNION carries all three (NULL where there is no ledger row), because a
             --     UNION whose branches disagree about their columns does not compile, and a screen that read
             --     the column only when it happened to be there would show the buttons on rows that have none.
             f.id AS failure_id, f.repeat_count, f.last_seen_at,
             -- ★★★ I-3 — GROUP 0: an unacknowledged give-up is never pushed off this screen, and it sorts by its LATEST
             --     occurrence, not by when it was first raised. A row that gave up in March and again this morning is
             --     this morning's problem. gave_up_at stays in the Raised column; last_seen_at decides the order.
             0 AS sort_group, f.last_seen_at AS sort_at
        FROM keystone.platform_list_job_failures() f
       WHERE $1::uuid IS NOT NULL
      UNION ALL
      -- ★★ A LISTENER THAT DIED (job.gave_up platform facts, 0138/0142 — the platform-gated reader that already
      --    existed). Its reason stays on the practice's own delivery row; the fact carries ids and counts only.
      SELECT 'fact:' || e.id AS id, 'gave up' AS queue, coalesce(e.facts->>'listener', e.subject) AS topic,
             'outbox' AS emitted_by, (e.facts->>'attempts')::int AS attempts, e.created_at,
             'LISTENER GAVE UP'
               || coalesce(' · practice ' || left(e.facts->>'tenant_id', 8), '') AS queue_state,
             'Stopped after ' || coalesce(e.facts->>'attempts', '?') || ' attempt(s) on ' || e.subject
               || coalesce(', event ' || (e.facts->>'event_id'), '')
               || ' — the reason is on that event''s delivery record in the practice' AS reason,
             NULL::bigint AS failure_id, NULL::int AS repeat_count, NULL::timestamptz AS last_seen_at,
             -- ★★ I-3 — GROUP 1: dead listeners are give-ups too and stay ahead of routine rows, but they are their own
             --    bounded section BEHIND the ledger. [MEASURED, review I-3] a flood of these (the reader returns up to
             --    500) shared one 200-row window with the ledger and pushed unacknowledged give-ups off the screen —
             --    07 §4 rule 6's silence, arriving through the list rather than through the queue.
             1 AS sort_group, e.created_at AS sort_at
        FROM keystone.platform_list_platform_events(500) e
       WHERE $1::uuid IS NOT NULL AND e.kind = 'job.gave_up'
     ) q
     ORDER BY q.sort_group, q.sort_at DESC, q.id
     LIMIT 200`,
  },
});
