// src/documents/reference.mjs — THE DEVELOPER'S OWN REFERENCE ON A DOCUMENT (FP-C1, 7 Oct 2026): `metadata` (key-value text they choose) and `externalId` (their id), on documents, templates and, per seat, on the people of a document.
// Pure checks first (no database), then the three small reads/writes. Values are text only; nothing here is ever shown to a signer.
import { invalid } from "../http/errors.mjs";

const KEY = /^[A-Za-z0-9_.-]{1,40}$/;
const MAX_KEYS = 20, MAX_VALUE = 500, MAX_EXTERNAL = 200;

/** Metadata as stored: an object of short text values. Numbers and booleans are kept as text; anything else is refused with the key named. */
export function cleanMetadata(value, field = "metadata") {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw invalid(`${field} must be an object of text values`, { field });
  const keys = Object.keys(value);
  if (keys.length > MAX_KEYS) throw invalid(`${field} can hold at most ${MAX_KEYS} keys`, { field });
  const out = {};
  for (const k of keys) {
    if (!KEY.test(k)) throw invalid(`${field} key “${k.slice(0, 40)}” must be 1–40 letters, digits, dot, dash or underscore`, { field });
    const v = value[k];
    if (typeof v === "number" || typeof v === "boolean") { out[k] = String(v); continue; }
    if (typeof v !== "string") throw invalid(`${field}.${k} must be text`, { field });
    if (v.length > MAX_VALUE) throw invalid(`${field}.${k} must be ${MAX_VALUE} characters or fewer`, { field });
    out[k] = v;
  }
  return out;
}

export function cleanExternalId(value, field = "externalId") {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_EXTERNAL) throw invalid(`${field} must be text of at most ${MAX_EXTERNAL} characters`, { field });
  return value;
}

/** The reference a request carries: the document's own, plus one per named seat. */
export function cleanReference({ metadata, externalId, people } = {}) {
  const partyRefs = {};
  for (const [i, p] of (Array.isArray(people) ? people : []).entries()) {
    const seat = p?.seat ?? p?.role ?? null, ext = cleanExternalId(p?.externalId, `parties[${i}].externalId`), md = cleanMetadata(p?.metadata, `parties[${i}].metadata`);
    if (seat && (ext || Object.keys(md).length)) partyRefs[seat] = { externalId: ext, metadata: md };
  }
  return { metadata: cleanMetadata(metadata), externalId: cleanExternalId(externalId), partyRefs };
}

const isEmptyReference = (r) => !r.externalId && Object.keys(r.metadata).length === 0 && Object.keys(r.partyRefs).length === 0;

/** Keep a reference on a document that exists. An empty reference changes nothing. */
export async function saveDocumentReference(tx, instanceId, ref) {
  if (!ref || isEmptyReference(ref)) return;
  await tx.query(`UPDATE keystone.document_instance SET metadata = $2::jsonb, external_id = $3, party_refs = $4::jsonb WHERE id = $1`, [instanceId, JSON.stringify(ref.metadata), ref.externalId, JSON.stringify(ref.partyRefs)]);
}

export async function saveTemplateReference(tx, templateId, ref) {
  if (!ref || (!ref.externalId && Object.keys(ref.metadata).length === 0)) return;
  await tx.query(`UPDATE keystone.document_template SET metadata = $2::jsonb, external_id = $3 WHERE id = $1`, [templateId, JSON.stringify(ref.metadata), ref.externalId]);
}

/** What a response and a webhook carry for this document. */
export async function documentReference(tx, instanceId) {
  const { rows: [r] } = await tx.query(`SELECT metadata, external_id, party_refs FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  return r ? { externalId: r.external_id ?? null, metadata: r.metadata ?? {}, partyRefs: r.party_refs ?? {} } : null;
}

/** What a webhook adds to a document's events at delivery: the developer's own reference and where the document came from. Read through the viewer-free lookup (migration 0713), because
 *  the delivery job has no viewer and document_instance's row security hid the row from documentReference (no webhook on the wire carried these before, 11 Oct 2026). null: no such document. */
export async function documentEventReference(tx, { instanceId }) {
  // the workspace is the transaction's own scope (withTenant set it), so this can never name another workspace's document
  const { rows: [r] } = await tx.query(`SELECT * FROM keystone.document_event_reference(nullif(current_setting('keystone.tenant_id', true), '')::uuid, $1)`, [instanceId]);
  if (!r) return null;
  return { externalId: r.external_id ?? null, metadata: r.metadata ?? {}, parties: r.party_refs ?? {}, test: r.is_test === true, source: r.form_template_id ? "form" : "sent", form: r.form_template_id ? { id: r.form_template_id, name: r.form_name } : null };
}

/** List filters from a query string: `externalId=…` and `metadata[key]=value`. Returns SQL for an instance alias `i` and its params. */
export function referenceFilter(query, start) {
  const where = [], params = [];
  const ext = query.externalId ?? query.external_id;
  if (ext !== undefined && ext !== "") { params.push(String(ext)); where.push(`i.external_id = $${start + params.length - 1}`); }
  const md = {};
  for (const [k, v] of Object.entries(query)) { const m = /^metadata\[([^\]]+)\]$/.exec(k); if (m) md[m[1]] = String(v); }
  if (Object.keys(md).length) { cleanMetadata(md, "metadata filter"); params.push(JSON.stringify(md)); where.push(`i.metadata @> $${start + params.length - 1}::jsonb`); }
  return { where, params };
}
