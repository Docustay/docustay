// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B10 — TASKS. WHAT AN EVENT CHAIN LEAVES BEHIND.
//
// ★★★ `keystone.task` EXISTED (P20.3) AND NOTHING READ IT. The row's own reason said so. What was
//     also missing is the SCOPE AXIS: `OWNERSHIP.task` read `ownable: false` with the note
//     *"/tasks/mine (P6.55) needs an assignee; that is where this gets an owner"* — and this is that
//     item. `task.assignee_id` was already a column; nothing had ever pointed ownership at it.
//
// ★★★ `mine` AND `team` ARE DIFFERENT QUESTIONS AND THE DIFFERENCE IS NOT COSMETIC.
//     · `/tasks/mine` — assigned TO ME. An explicit `assignee_id = $1`.
//     · `/tasks/team` — everything my SCOPE permits, which for an admin is the practice and for a
//       coach is what they own. That is `scoped()`, and it is a different set.
//   ★★ Using `scoped()` alone for "mine" would show an admin EVERY task and call it theirs.
//
// ★ AN UNCLAIMED TASK IS A REAL STATE. `assignee_id` is nullable — a task an event chain raised
//   that nobody has picked up must still be visible on the team list, or the queue hides exactly the
//   work that needs a person.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { scoped, emptyOf,
} from "./_shared.mjs";

const TASK_COLUMNS = [
  { field: 'title',        label: 'Task',                format: 'text' },
  { field: 'written_by',   label: 'Who',                 format: 'text' },
  { field: 'about',        label: 'About',               format: 'text' },
  { field: 'due_at',       label: 'Due',                 format: 'datetime' },
  { field: 'topic',        label: 'Where it came from',  format: 'enum' },
  { field: 'state',        label: 'State',               format: 'enum' },
];

// ★ Open tasks and recently closed (30 days). A queue that shows only open work would hide the
//   completion status that matters to coaches reviewing the week.
const taskList = (where) => `
  SELECT t.id, t.title, t.topic, t.due_at, t.snoozed_until, t.closed_at, t.created_at,
         t.subject_type, t.subject_id, (t.created_by_event_id IS NOT NULL) AS made_automatically,
         cu.display_name AS written_by,
         coalesce(u.display_name, '— unassigned —') AS assignee,
         t.assignee_id,
         CASE
           WHEN t.subject_id = t.assignee_id AND t.created_by_event_id IS NULL THEN NULL
           WHEN t.subject_type = 'person' THEN (
             SELECT display_name FROM keystone.app_user au WHERE au.id = t.subject_id
           )
           WHEN t.subject_type = 'account' THEN (
             SELECT name FROM keystone.account ac WHERE ac.id = t.subject_id
           )
           WHEN t.subject_type = 'booking' THEN (
             SELECT display_name FROM keystone.booking_participant bp
              WHERE bp.booking_id = t.subject_id AND bp.party <> 'coach'
              ORDER BY display_name LIMIT 1
           )
           ELSE NULL
         END AS about,
         CASE
           WHEN t.closed_at IS NOT NULL THEN 'done'
           WHEN t.snoozed_until > now() AT TIME ZONE tn.timezone THEN 'snoozed'
           WHEN t.due_at::date < (now() AT TIME ZONE tn.timezone)::date THEN 'overdue'
           WHEN t.due_at::date = (now() AT TIME ZONE tn.timezone)::date THEN 'today'
           ELSE 'open'
         END AS state
    FROM keystone.task t
    LEFT JOIN keystone.app_user u ON u.id = t.assignee_id
    LEFT JOIN keystone.app_user cu ON cu.id = t.created_by_app_user_id
    LEFT JOIN keystone.tenant tn ON tn.id = t.tenant_id
   WHERE (t.closed_at IS NULL OR t.closed_at > now() - interval '30 days') AND (${where})
   ORDER BY t.due_at NULLS LAST, t.created_at, t.id`;

export const TASKS_LISTS = Object.freeze({
  '/tasks/mine': {
    title: 'My tasks', recordType: null, columns: TASK_COLUMNS,
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconCheckbox',
      headline: 'Nothing on your plate',
      line: 'Tasks assigned to you appear here. An empty list means you are caught up.',
      action: { label: 'Add task', href: '/tasks/mine?new=1' },
    }),
    sql: taskList(`t.assignee_id = $1 AND ${scoped('task', 't')}`),
  },

  '/tasks/team': {
    title: 'Team tasks', recordType: null, columns: TASK_COLUMNS,
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconUsersGroup',
      headline: 'Nothing outstanding across the team',
      line: 'Every open task, whoever it belongs to.',
      action: { label: 'Add task', href: '/tasks/team?new=1' },
    }),
    sql: taskList(scoped('task', 't')),
  },
});
