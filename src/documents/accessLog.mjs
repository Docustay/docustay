// Run 7 part 6 — THE ACCESS LOG (migration 0711). ALWAYS ON for every workspace (the maintainer, 11 Oct 2026: the Health data switch is gone, the log stays): every time someone on the team opens a
// document, downloads one of its files or exports documents or responses, one row is written: who (a snapshot of their name and email, through the people port), what, when, from where.
// Owners and admins list it and download it as CSV.
// ★ Never fails the request it records: a log write that fails is reported on the server and the person still gets their document.
import { ports } from "./ports.mjs";

const ACCESS_ACTIONS = Object.freeze(["view", "download", "export"]);

/** Record one access. `user` is the app user id of the person on the team. Returns true when a row was written. */
export async function noteAccess(tx, { tenantId, action, instanceId = null, title = null, what = null, userId = null, ip = null }) {
  if (!ACCESS_ACTIONS.includes(action)) throw new Error(`noteAccess: action must be one of ${ACCESS_ACTIONS.join(", ")}`);
  try {
    await tx.query(`SAVEPOINT access_log`);
    // the editor and the Track screen load one document through two calls: one open is one line (the same person, the same document, within ten seconds)
    if (action === "view" && instanceId && userId && (await tx.query(`SELECT 1 FROM keystone.document_access_event WHERE action = 'view' AND instance_id = $1 AND user_ref = $2 AND at > now() - interval '10 seconds' LIMIT 1`, [instanceId, userId])).rows.length) { await tx.query(`RELEASE SAVEPOINT access_log`); return false; }
    const person = userId ? (await (await ports()).people.byIds(tx, [userId]))[0] ?? null : null;
    let docTitle = title;
    if (instanceId && docTitle === null) docTitle = (await tx.query(`SELECT title FROM keystone.document_instance WHERE id = $1`, [instanceId])).rows[0]?.title ?? null;
    await tx.query(
      `INSERT INTO keystone.document_access_event (tenant_id, action, instance_id, title, what, user_ref, user_name, user_email, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::inet)`,
      [tenantId, action, instanceId, docTitle?.slice(0, 300) ?? null, what?.slice(0, 120) ?? null, userId, person?.display_name?.slice(0, 200) ?? null, person?.email?.slice(0, 320) ?? null, ip || null]);
    await tx.query(`RELEASE SAVEPOINT access_log`);
    return true;
  } catch (e) {
    await tx.query(`ROLLBACK TO SAVEPOINT access_log`).catch(() => {});
    console.error(`access log write failed (${action}): ${e.message}`);
    return false;
  }
}

/** The newest rows first, at most `limit`, optionally for one document. */
export async function listAccess(tx, { instanceId = null, limit = 200, before = null } = {}) {
  const { rows } = await tx.query(
    `SELECT id, at, action, instance_id, title, what, user_ref, user_name, user_email, host(ip) AS ip FROM keystone.document_access_event
      WHERE ($1::uuid IS NULL OR instance_id = $1) AND ($2::timestamptz IS NULL OR at < $2) ORDER BY at DESC LIMIT $3`,
    [instanceId, before, Math.max(1, Math.min(Number(limit) || 200, 1000))]);
  return { events: rows, on: true };
}

const cell = (v) => { const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v); return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
/** Every row of the period as CSV (owners keep this for six years). */
export async function accessCsv(tx, { from = null, to = null } = {}) {
  const { rows } = await tx.query(
    `SELECT at, action, title, what, user_name, user_email, host(ip) AS ip, instance_id FROM keystone.document_access_event
      WHERE ($1::timestamptz IS NULL OR at >= $1) AND ($2::timestamptz IS NULL OR at < $2) ORDER BY at`, [from, to]);
  const head = ["when", "action", "document", "what", "person", "email", "ip", "document id"];
  return { csv: [head.join(","), ...rows.map((r) => [r.at, r.action, r.title, r.what, r.user_name, r.user_email, r.ip, r.instance_id].map(cell).join(","))].join("\n") + "\n", name: "access-log.csv", count: rows.length };
}
