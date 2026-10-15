// Part 30 item 8 — REPORTS: what was sent, what finished, how long it took, by day, template, team and sender, plus a per-document CSV. Practice (test-mode) documents are never counted, and a person sees only
// what the team rule lets them see (the same SQL function as the lists), so a report cannot reveal a document the list would hide.
import { invalid } from "../http/errors.mjs";
import { ports } from "./ports.mjs";

const DAY = 86400000, MAX_DAYS = 800;
const ymd = (d) => d.toISOString().slice(0, 10);
const parseDay = (v, field) => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw invalid(`${field} must be a date like 2026-10-31`, { field }); return v; };

/** Normalises the asked-for window. `to` is INCLUSIVE; the default is the last 30 days ending today in the workspace's time zone. */
export function reportWindow({ from = null, to = null, now = new Date(), tz = "UTC" } = {}) {
  const end = to ? parseDay(to, "to") : new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);   // "today" is the workspace's own today
  const start = from ? parseDay(from, "from") : ymd(new Date(Date.parse(`${end}T00:00:00Z`) - 29 * DAY));
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY + 1;
  if (days < 1) throw invalid("from must be on or before to", { field: "from" });
  if (days > MAX_DAYS) throw invalid(`A report covers at most ${MAX_DAYS} days.`, { field: "from" });
  return { from: start, to: end, days };
}

const SCOPE = `i.builder = 'pdf' AND i.archived_at IS NULL AND (i.package_lead_id IS NULL OR i.package_lead_id = i.id) AND NOT i.is_test
  AND keystone.document_team_visible(nullif(current_setting('keystone.user_id', true), '')::uuid, i.team_id, i.created_by)
  AND ($3::uuid IS NULL OR i.team_id = $3)`;

export async function documentReport(tx, { tenantId, from = null, to = null, teamId = null } = {}) {
  const { timezone } = await (await ports()).brand.get(tx, { tenantId }).catch(() => ({ timezone: "UTC" }));
  const tz = timezone || "UTC";
  const w = reportWindow({ from, to, tz });
  // sent in the window / finished in the window are separate questions, each counted by its own date in the workspace's own time zone
  const lo = `(($1::date)::timestamp AT TIME ZONE $4)`, hi = `((($2::date) + 1)::timestamp AT TIME ZONE $4)`;
  const args = [w.from, w.to, teamId ?? null, tz];
  const { rows: [t] } = await tx.query(
    `SELECT count(*) FILTER (WHERE i.sent_at >= ${lo} AND i.sent_at < ${hi})::int AS sent,
            count(*) FILTER (WHERE i.executed_at >= ${lo} AND i.executed_at < ${hi})::int AS completed,
            count(*) FILTER (WHERE i.declined_at >= ${lo} AND i.declined_at < ${hi})::int AS declined,
            count(*) FILTER (WHERE i.state = 'expired' AND i.updated_at >= ${lo} AND i.updated_at < ${hi})::int AS expired,
            count(*) FILTER (WHERE i.voided_at >= ${lo} AND i.voided_at < ${hi})::int AS voided,
            count(*) FILTER (WHERE i.state IN ('sent','partially_signed'))::int AS waiting_now,
            round((avg(EXTRACT(epoch FROM i.executed_at - i.sent_at) / 3600) FILTER (WHERE i.executed_at >= ${lo} AND i.executed_at < ${hi} AND i.sent_at IS NOT NULL))::numeric, 1)::float8 AS avg_hours,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM i.executed_at - i.sent_at) / 3600) FILTER (WHERE i.executed_at >= ${lo} AND i.executed_at < ${hi} AND i.sent_at IS NOT NULL))::numeric, 1)::float8 AS median_hours
       FROM keystone.document_instance i WHERE ${SCOPE}`, args);
  // ★ Run 8 (R8-13): one grouped pass for "sent" and one for "completed" — the per-day subqueries scanned every document (and ran the team rule on each) twice for EVERY day: 60 scans for 30 days, 2.5 s for 250 documents
  const { rows: dayRows } = await tx.query(
    `WITH s AS (SELECT (i.sent_at AT TIME ZONE $4)::date AS day, count(*)::int AS n FROM keystone.document_instance i WHERE ${SCOPE} AND i.sent_at >= ${lo} AND i.sent_at < ${hi} GROUP BY 1),
          c AS (SELECT (i.executed_at AT TIME ZONE $4)::date AS day, count(*)::int AS n FROM keystone.document_instance i WHERE ${SCOPE} AND i.executed_at >= ${lo} AND i.executed_at < ${hi} GROUP BY 1)
     SELECT d::date AS day, coalesce(s.n, 0) AS sent, coalesce(c.n, 0) AS completed
       FROM generate_series($1::date, $2::date, interval '1 day') d LEFT JOIN s ON s.day = d::date LEFT JOIN c ON c.day = d::date ORDER BY 1`, args);
  const { rows: byTemplate } = await tx.query(
    `SELECT coalesce(tp.name, 'No template') AS name, count(*)::int AS sent,
            count(*) FILTER (WHERE i.state = 'executed')::int AS completed
       FROM keystone.document_instance i
       LEFT JOIN keystone.document_file f ON f.instance_id = i.id AND f.kind = 'original'
       LEFT JOIN keystone.document_template tp ON tp.id::text = f.meta->>'from_template'
      WHERE ${SCOPE} AND i.sent_at >= ${lo} AND i.sent_at < ${hi}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`, args);
  const { rows: byTeam } = await tx.query(
    `SELECT coalesce(tm.name, 'No team') AS name, count(*)::int AS sent, count(*) FILTER (WHERE i.state = 'executed')::int AS completed
       FROM keystone.document_instance i LEFT JOIN keystone.document_team tm ON tm.id = i.team_id
      WHERE ${SCOPE} AND i.sent_at >= ${lo} AND i.sent_at < ${hi} GROUP BY 1 ORDER BY 2 DESC, 1`, args);
  const { rows: senders } = await tx.query(
    `SELECT i.created_by AS id, count(*)::int AS sent, count(*) FILTER (WHERE i.state = 'executed')::int AS completed
       FROM keystone.document_instance i WHERE ${SCOPE} AND i.sent_at >= ${lo} AND i.sent_at < ${hi} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, args);
  // Run 7: form responses — each form's responses started in the window and how many of those were completed (signed by everyone)
  const { rows: byForm } = await tx.query(
    `SELECT coalesce((SELECT ft.name FROM keystone.document_template ft WHERE ft.family_id = coalesce(i.form_id, (SELECT x.family_id FROM keystone.document_template x WHERE x.id = i.template_id)) ORDER BY ft.version DESC LIMIT 1), 'A form') AS name,
            count(*)::int AS responses, count(*) FILTER (WHERE i.state = 'executed')::int AS completed
       FROM keystone.document_instance i WHERE ${SCOPE} AND i.source_channel = 'form' AND i.sent_at >= ${lo} AND i.sent_at < ${hi} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 20`, args);
  const formTotals = byForm.reduce((a, f) => ({ responses: a.responses + f.responses, completed: a.completed + f.completed }), { responses: 0, completed: 0 });
  const named = senders.some((s) => s.id) ? await (await ports()).people.byIds(tx, senders.filter((s) => s.id).map((s) => s.id)) : [];
  const nameOf = new Map(named.map((p) => [p.id, p.display_name]));
  return {
    window: w, timezone: tz,
    totals: { sent: t.sent, completed: t.completed, declined: t.declined, expired: t.expired, voided: t.voided, waitingNow: t.waiting_now,
      completionRate: t.sent ? Math.round((t.completed / t.sent) * 1000) / 10 : null, averageHoursToComplete: t.avg_hours, medianHoursToComplete: t.median_hours },
    byDay: dayRows.map((r) => ({ date: typeof r.day === "string" ? r.day.slice(0, 10) : ymd(r.day), sent: r.sent, completed: r.completed })),
    byTemplate, byTeam,
    forms: { responses: formTotals.responses, completed: formTotals.completed, completionRate: formTotals.responses ? Math.round((formTotals.completed / formTotals.responses) * 1000) / 10 : null,
      byForm: byForm.map((f) => ({ ...f, completionRate: f.responses ? Math.round((f.completed / f.responses) * 1000) / 10 : null })) },
    bySender: senders.map((s) => ({ name: s.id ? nameOf.get(s.id) ?? "Former team member" : "Unknown", sent: s.sent, completed: s.completed })),
  };
}

// D-034: the export uses the words the screens use (Completed, In progress, Cancelled), not the stored state names
export const CSV_STATUS = Object.freeze({ draft: "Draft", sent: "Sent", partially_signed: "In progress", executed: "Completed", declined: "Declined", expired: "Expired", void: "Cancelled" });
const csvCell = (v) => { const s = v == null ? "" : String(v); return /^[=+\-@\t\r]/.test(s) || /[",\n\r]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };   // a cell that starts like a formula is neutralised so a spreadsheet never runs it

/** One row per document sent in the window — the export. */
export async function documentReportCsv(tx, { tenantId, from = null, to = null, teamId = null } = {}) {
  const { timezone } = await (await ports()).brand.get(tx, { tenantId }).catch(() => ({ timezone: "UTC" }));
  const tz = timezone || "UTC";
  const w = reportWindow({ from, to, tz });
  const args = [w.from, w.to, teamId ?? null, tz];
  const { rows } = await tx.query(
    `SELECT i.id, i.title, i.state, tm.name AS team, i.created_by, i.sent_at, i.executed_at, i.declined_at,
            round((EXTRACT(epoch FROM i.executed_at - i.sent_at) / 3600)::numeric, 1)::float8 AS hours_to_complete,
            (SELECT count(*)::int FROM keystone.document_party p WHERE p.instance_id = i.id AND p.action_role IN ('signer','approver')) AS signers
       FROM keystone.document_instance i LEFT JOIN keystone.document_team tm ON tm.id = i.team_id
      WHERE ${SCOPE} AND i.sent_at >= (($1::date)::timestamp AT TIME ZONE $4) AND i.sent_at < ((($2::date) + 1)::timestamp AT TIME ZONE $4)
      ORDER BY i.sent_at, i.id`, args);
  const people = rows.some((r) => r.created_by) ? await (await ports()).people.byIds(tx, [...new Set(rows.map((r) => r.created_by).filter(Boolean))]) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.display_name]));
  const head = ["id", "title", "status", "team", "sent_by", "signers", "sent_at", "completed_at", "declined_at", "hours_to_complete"];
  const iso = (d) => (d ? new Date(d).toISOString() : "");
  const lines = [head.join(","), ...rows.map((r) => [r.id, r.title, CSV_STATUS[r.state] ?? r.state, r.team ?? "", nameOf.get(r.created_by) ?? "", r.signers, iso(r.sent_at), iso(r.executed_at), iso(r.declined_at), r.hours_to_complete ?? ""].map(csvCell).join(","))];
  return { csv: `${lines.join("\r\n")}\r\n`, rows: rows.length, window: w };
}
