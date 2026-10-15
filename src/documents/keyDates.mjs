// src/documents/keyDates.mjs — THE CONTRACT REPOSITORY'S KEY DATES (Run 9 Part 3.4; rulings R9-h, R9-i; migration 0721).
//
// ★ R9-h: key dates come from the signed document's OWN boxes. A date box whose label reads like a start, an end, a notice or a renewal date — and a number or payment
//   box whose label reads like a value — is that key date. No AI: until Scribe is configured nothing is guessed, because a wrong date is worse than none. Every date can be
//   corrected by a person, and the correction is what is shown (source 'person'); a later read of the boxes never overwrites it.
// ★ R9-i: renewal reminders (Pro, `renewal_reminders`) — the daily sweep, 30 days and 7 days before a NOTICE date, one in-app notice and one owner email each, once.
// ★ The boxes are read when the document is sealed (pdfArchive) and, for documents signed before this existed, by the sweep (KEY_DATES_BACKFILL_FACT). Hidden boxes
//   have no stored value, so a box a rule left out is never a key date.
import { emit } from "../events/outbox.mjs";
import { invalid, notFound } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";

const KEY_DATE_KINDS = Object.freeze(["start", "end", "notice", "renewal", "value"]);
// Words in a box's label, in the order they are tried ("Renewal notice date" is a notice date, "Lease end" an end date). English first, then the most common
// words of the other languages Docustay speaks; a label that matches nothing is not a key date.
const LABEL_WORDS = [
  ["notice", /\b(notice|notify|notification|cancel by|opt[- ]?out|aviso|préavis|preaviso|kündigung|opzegging|wypowiedzeni)/i],
  ["renewal", /\b(renew|renewal|renews|renovaci|renouvel|verlängerung|verleng|rinnov|odnowien)/i],
  ["end", /\b(end|ends|ending|expir|terminat|until|through|fin\b|fecha de fin|date de fin|ende\b|einde|scadenz|vencim|zakończ)/i],
  ["start", /\b(start|starts|commence|effective|begin|move[- ]?in|inicio|début|beginn|ingang|inizio|rozpocz)/i],
];
const VALUE_WORDS = /\b(value|total|amount|fee|fees|price|rent|salary|cost|deposit|importe|montant|betrag|bedrag|valor|importo|kwota|wert)\b/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A box's label → the key-date kind it names, or null. `amount`: the box holds a number (or is a payment). Pure. */
export function kindOfLabel(label, { amount = false } = {}) {
  const l = String(label ?? "").trim();
  if (!l) return null;
  if (amount) return VALUE_WORDS.test(l) ? "value" : null;
  for (const [kind, re] of LABEL_WORDS) if (re.test(l)) return kind;
  return null;
}

/** The key dates a document's boxes give, from their stored values (and what the sender locked in). One per kind: the first box down the pages. Pure.
 *  → [{ kind, date | null, amountMinor | null, currency | null, fieldId, label }] */
export function pickKeyDates(fields, values) {
  const valueOf = (f) => { const v = values[f.id]; if (v != null && v !== "") return String(v); return f.locked && f.default != null && !String(f.default).includes("{{") ? String(f.default) : null; };
  const order = [...fields].sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x));
  const currency = (fields.find((f) => f.type === "payment" && f.currency)?.currency ?? null)?.toLowerCase() ?? null;
  const out = new Map();
  for (const f of order) {
    if (f.sensitive) continue;   // Run 9 (the sensitive-values guard): a sensitive box (a date of birth) is never a key date
    if (f.type === "text" && f.validation === "date") {
      const kind = kindOfLabel(f.label); const v = valueOf(f);
      if (kind && v && ISO_DAY.test(v) && !Number.isNaN(Date.parse(v)) && !out.has(kind)) out.set(kind, { kind, date: v, amountMinor: null, currency: null, fieldId: f.id, label: f.label ?? null });
    } else if ((f.type === "text" && f.validation === "number") || (f.type === "payment" && Number.isInteger(f.amount_minor))) {
      if (out.has("value") || kindOfLabel(f.label || (f.type === "payment" ? "amount" : ""), { amount: true }) !== "value") continue;
      const minor = f.type === "payment" ? f.amount_minor : (() => { const n = Number(String(valueOf(f) ?? "").replace(/[,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; })();
      if (minor != null && (f.type !== "payment" || values[f.id] === "paid")) out.set("value", { kind: "value", date: null, amountMinor: minor, currency: f.type === "payment" ? String(f.currency ?? "usd").toLowerCase() : currency, fieldId: f.id, label: f.label ?? null });
    }
  }
  return [...out.values()];
}

/** Reads one signed document's boxes into document_key_date (never over a person's correction) and stamps the document. Idempotent. → number of key dates found */
export async function readKeyDates(tx, { tenantId, instanceId }) {
  const { rows: [d] } = await tx.query(`SELECT id, state, builder, template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (!d || d.builder !== "pdf" || d.state !== "executed") return 0;
  const body = parsePdfBodyData(d.template_body_snapshot);
  const { rows } = await tx.query(`SELECT field_id, value FROM keystone.document_field_value WHERE instance_id = $1`, [instanceId]);
  const found = pickKeyDates(body.fields ?? [], Object.fromEntries(rows.map((r) => [r.field_id, r.value])));
  for (const k of found) {
    await tx.query(
      `INSERT INTO keystone.document_key_date (tenant_id, instance_id, kind, date_value, amount_minor, currency, source, field_id, label)
       VALUES ($1,$2,$3,$4,$5,$6,'field',$7,$8) ON CONFLICT (tenant_id, instance_id, kind) DO NOTHING`,
      [tenantId, instanceId, k.kind, k.date, k.amountMinor, k.currency, k.fieldId, k.label ? String(k.label).slice(0, 200) : null]);
  }
  // the stamp: as the worker (no signed-in person) this always lands; inside a signer's own session it does not (their policy ends at "signed"), and the sweep reads it again, harmlessly
  await tx.query(`UPDATE keystone.document_instance SET key_dates_read_at = now() WHERE id = $1 AND state = 'executed' AND key_dates_read_at IS NULL`, [instanceId]);
  return found.length;
}

const LIST_CAP = 500;
/** The Contracts page: every signed document (one row per send) with its key dates, the strip's numbers and six months of signings. `q` searches titles, people and amounts. */
export async function listContracts(tx, { q = null, limit = 200 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), LIST_CAP);
  const term = typeof q === "string" && q.trim() ? q.trim().slice(0, 120) : null;
  const { rows } = await tx.query(
    `SELECT i.id, i.title, i.executed_at,
            (SELECT coalesce(json_agg(json_build_object('name', p.name, 'email', p.email) ORDER BY p.position, p.created_at), '[]'::json) FROM keystone.document_party p
              WHERE p.instance_id = i.id AND p.action_role = 'signer' AND p.status = 'signed') AS people,
            (SELECT coalesce(json_agg(json_build_object('kind', k.kind, 'date', k.date_value, 'amountMinor', k.amount_minor, 'currency', k.currency, 'source', k.source, 'label', k.label, 'documentId', k.instance_id)
                                      ORDER BY (k.instance_id = i.id) DESC, k.created_at), '[]'::json)
               FROM keystone.document_key_date k JOIN keystone.document_instance m ON m.id = k.instance_id
              WHERE m.id = i.id OR m.package_lead_id = i.id) AS dates
       FROM keystone.document_instance i
      WHERE i.builder = 'pdf' AND i.state = 'executed' AND i.archived_at IS NULL AND i.package_lead_id IS NULL AND i.is_test = false
        AND ($1::text IS NULL OR i.title ILIKE '%' || $1 || '%'
             OR EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = i.id AND (p.name ILIKE '%' || $1 || '%' OR p.email ILIKE '%' || $1 || '%'))
             OR EXISTS (SELECT 1 FROM keystone.document_key_date k WHERE k.instance_id = i.id AND k.amount_minor IS NOT NULL
                         AND (to_char(k.amount_minor / 100.0, 'FM999999999990.00') LIKE '%' || replace($1, ',', '') || '%')))
      ORDER BY i.executed_at DESC NULLS LAST LIMIT $2`, [term, n]);
  const today = new Date().toISOString().slice(0, 10), in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const contracts = rows.map((r) => {
    const by = {}; for (const k of r.dates ?? []) if (!by[k.kind]) by[k.kind] = { ...k, date: k.date ? String(k.date).slice(0, 10) : null };
    return { id: r.id, title: r.title, executedAt: r.executed_at, people: r.people ?? [], dates: by };
  });
  // the strip: counts over every signed contract, not just this page of the list
  const { rows: [s] } = await tx.query(
    `SELECT count(*)::int AS signed,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM keystone.document_key_date k JOIN keystone.document_instance m ON m.id = k.instance_id
                                           WHERE (m.id = i.id OR m.package_lead_id = i.id) AND k.kind IN ('renewal','end','notice') AND k.date_value BETWEEN $1::date AND $2::date))::int AS renewing
       FROM keystone.document_instance i WHERE i.builder = 'pdf' AND i.state = 'executed' AND i.archived_at IS NULL AND i.package_lead_id IS NULL AND i.is_test = false`, [today, in30]);
  const { rows: values } = await tx.query(
    `SELECT coalesce(k.currency, '') AS currency, sum(k.amount_minor)::bigint AS minor
       FROM keystone.document_key_date k JOIN keystone.document_instance i ON i.id = k.instance_id
      WHERE k.kind = 'value' AND k.amount_minor IS NOT NULL AND i.state = 'executed' AND i.archived_at IS NULL AND i.is_test = false
        AND NOT EXISTS (SELECT 1 FROM keystone.document_key_date e WHERE e.instance_id = k.instance_id AND e.kind = 'end' AND e.date_value < $1::date)
      GROUP BY 1 ORDER BY 2 DESC`, [today]);
  const { rows: months } = await tx.query(
    `SELECT to_char(date_trunc('month', g), 'YYYY-MM') AS month,
            (SELECT count(*)::int FROM keystone.document_instance i WHERE i.builder = 'pdf' AND i.state = 'executed' AND i.package_lead_id IS NULL AND i.is_test = false
                AND i.executed_at >= date_trunc('month', g) AND i.executed_at < date_trunc('month', g) + interval '1 month') AS signed
       FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS g ORDER BY 1`);
  return {
    contracts,
    summary: { signed: s.signed, renewingIn30Days: s.renewing, valueUnderContract: values.map((v) => ({ currency: v.currency || null, amountMinor: Number(v.minor) })), months },
    truncated: rows.length === n,
  };
}

/** The person page: the key dates of the signed documents they signed, soonest first (past dates after). */
export async function keyDatesForEmail(tx, { email }) {
  if (!email) return [];
  const { rows } = await tx.query(
    `SELECT DISTINCT ON (k.id) k.kind, k.date_value, k.label, k.source, coalesce(i.package_lead_id, i.id) AS document_id, coalesce(l.title, i.title) AS title
       FROM keystone.document_key_date k JOIN keystone.document_instance i ON i.id = k.instance_id
       LEFT JOIN keystone.document_instance l ON l.id = i.package_lead_id
      WHERE k.date_value IS NOT NULL AND i.state = 'executed' AND i.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = coalesce(i.package_lead_id, i.id) AND lower(p.email) = lower($1))`, [email]);
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => ({ kind: r.kind, date: String(r.date_value instanceof Date ? r.date_value.toISOString() : r.date_value).slice(0, 10), label: r.label, source: r.source, documentId: r.document_id, title: r.title }))
    .sort((a, b) => ((a.date < today) - (b.date < today)) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** A person corrects (or clears) one key date of a signed document. `date` is "YYYY-MM-DD" or null; for `value`, `amountMinor` (≥ 0) or null. The correction is what is shown
 *  from then on, and a moved notice date is reminded again. */
export async function correctKeyDate(tx, { tenantId, instanceId, kind, date = null, amountMinor = null, currency = null, actorUserId = null }) {
  if (!KEY_DATE_KINDS.includes(kind)) throw invalid(`kind must be one of ${KEY_DATE_KINDS.join(", ")}`, { field: "kind" });
  const { rows: [d] } = await tx.query(`SELECT id, state, builder FROM keystone.document_instance WHERE id = $1 AND archived_at IS NULL`, [instanceId]);
  if (!d || d.builder !== "pdf") throw notFound("That document is not in this workspace.");
  if (d.state !== "executed") throw invalid("Key dates belong to signed documents; this one is not signed yet.", { code: "not_signed" });
  if (kind === "value") {
    if (amountMinor !== null && !(Number.isInteger(amountMinor) && amountMinor >= 0 && amountMinor < 1e13)) throw invalid("The value must be a whole number of cents, zero or more.", { field: "amountMinor" });
    if (currency !== null && !/^[a-z]{3}$/i.test(String(currency))) throw invalid("The currency must be a three-letter code such as usd.", { field: "currency" });
  } else if (date !== null && !(ISO_DAY.test(String(date)) && !Number.isNaN(Date.parse(date)))) throw invalid("Use a date such as 2027-09-30.", { field: "date" });
  const { rows: [row] } = await tx.query(
    `INSERT INTO keystone.document_key_date (tenant_id, instance_id, kind, date_value, amount_minor, currency, source, corrected_by, corrected_at)
     VALUES ($1,$2,$3,$4,$5,$6,'person',$7,now())
     ON CONFLICT (tenant_id, instance_id, kind) DO UPDATE SET date_value = EXCLUDED.date_value, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency, source = 'person',
            corrected_by = EXCLUDED.corrected_by, corrected_at = now(), updated_at = now(),
            reminded_30_at = CASE WHEN document_key_date.date_value IS DISTINCT FROM EXCLUDED.date_value THEN NULL ELSE document_key_date.reminded_30_at END,
            reminded_7_at  = CASE WHEN document_key_date.date_value IS DISTINCT FROM EXCLUDED.date_value THEN NULL ELSE document_key_date.reminded_7_at END
     RETURNING kind, date_value, amount_minor, currency, source, corrected_at`,
    [tenantId, instanceId, kind, kind === "value" ? null : date, kind === "value" ? amountMinor : null, kind === "value" && amountMinor !== null ? String(currency ?? "usd").toLowerCase() : null, actorUserId]);
  return { kind: row.kind, date: row.date_value ? String(row.date_value instanceof Date ? row.date_value.toISOString() : row.date_value).slice(0, 10) : null, amountMinor: row.amount_minor == null ? null : Number(row.amount_minor), currency: row.currency, source: row.source, correctedAt: row.corrected_at };
}

// ── the sweep (src/time/due.mjs, through the front door) ─────────────────────────────────────────

/** Documents signed before 0721, and any whose seal ran in a signer's own session: read their boxes, up to 50 a sweep. */
export const KEY_DATES_BACKFILL_FACT = {
  key: "document_key_dates_read",
  why: "a signed document's date and amount boxes have not been read into the contract repository yet",
  sweepAll: async (tx, { tenantId }) => {
    const { rows } = await tx.query(
      `SELECT id FROM keystone.document_instance WHERE tenant_id = $1 AND builder = 'pdf' AND state = 'executed' AND archived_at IS NULL AND key_dates_read_at IS NULL ORDER BY executed_at LIMIT 50`, [tenantId]);
    const out = [];
    for (const r of rows) out.push(`document ${r.id}: ${await readKeyDates(tx, { tenantId, instanceId: r.id })} key date(s) read`);
    return out;
  },
};

/** R9-i — 30 and 7 days before a notice date: one in-app notice and one owner email (the generic listener), each once. Pro only; on Free nothing is stamped, so an upgrade
 *  inside the window still reminds. A date first known inside the 7-day window gets the 7-day reminder only. */
export const KEY_DATE_DUE_FACT = {
  key: "document_key_date_due",
  why: "a signed contract's notice date is 30 or 7 days away and nobody has been reminded",
  find: (tx, { tenantId }) => tx.query(
    `SELECT id, instance_id, date_value, (date_value - current_date) AS days, reminded_30_at, reminded_7_at FROM keystone.document_key_date
      WHERE tenant_id = $1 AND kind = 'notice' AND date_value BETWEEN current_date AND current_date + 30
        AND ((date_value > current_date + 7 AND reminded_30_at IS NULL) OR (date_value <= current_date + 7 AND reminded_7_at IS NULL))
      ORDER BY date_value`, [tenantId]),
  act: async (tx, { tenantId, row }) => {
    if ((await (await ports()).entitlements?.isEntitled?.(tx, { tenantId, item: "renewal_reminders" })) !== true) return null;
    const near = Number(row.days) <= 7;
    const { rowCount } = await tx.query(
      near ? `UPDATE keystone.document_key_date SET reminded_7_at = now(), reminded_30_at = coalesce(reminded_30_at, now()), updated_at = now() WHERE id = $1 AND reminded_7_at IS NULL`
           : `UPDATE keystone.document_key_date SET reminded_30_at = now(), updated_at = now() WHERE id = $1 AND reminded_30_at IS NULL`, [row.id]);
    if (rowCount === 0) return null;
    const date = String(row.date_value instanceof Date ? row.date_value.toISOString() : row.date_value).slice(0, 10);
    // ★ no title, no names, no amount in the event: the listener looks the document up itself (the blocked-list discipline the whole registry follows)
    await emit(tx, { tenantId, topic: "documents.key_date.due", emittedBy: "documents", subjectType: "document", subjectId: row.instance_id, actor: "worker",
      payload: { kind: "notice", date, days: Number(row.days), window: near ? 7 : 30 } });
    return `document ${row.instance_id}: notice date ${date} reminded (${near ? 7 : 30}-day)`;
  },
};
