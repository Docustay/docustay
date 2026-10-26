// PDF FIELD DETECTION · REMEMBER THIS FORM (PDF-FIELD-DETECTION-SPEC §5). A form a workspace sends again is not detected again: the fields the person finally placed last time come back as the suggestions, with their seats.
// A page is recognised by its picture hash (engine.mjs pageHash): the same printed form gives nearly the same 64 bits whatever has been written on it. Stored per workspace in document_form_layout (migration 0691); a self-host keeps it in its own database.
const MAX_BITS = 6;                                         // of 64, per page
const pop = (n) => { let c = 0; while (n) { c += Number(n & 1n); n >>= 1n; } return c; };
export const distance = (a, b) => pop(BigInt(`0x${a}`) ^ BigInt(`0x${b}`));
// A page whose picture hash has hardly any dark blocks (a near-blank page, a hostile file) looks the same as every other near-blank page: recognising it would hand one form's boxes to a different form (found live in Pass 3: an onboarding form got another document's Name/Signature/Date boxes). Such a page is never matched and never kept.
const recognisable = (hash) => pop(BigInt(`0x${hash}`)) > MAX_BITS * 2;
export function sameLayout(a, b, maxBits = MAX_BITS) { return a.length === b.length && a.every((p, i) => recognisable(p.hash) && recognisable(b[i].hash) && distance(p.hash, b[i].hash) <= maxBits); }

/** The remembered layout for these pages, or null. Counts the use. */
export async function findLayout(tx, { pages }) {
  const { rows } = await tx.query(`SELECT id, name, pages, roles, fields FROM keystone.document_form_layout WHERE page_count = $1 ORDER BY updated_at DESC LIMIT 300`, [pages.length]);
  const hit = rows.find((r) => sameLayout(r.pages, pages));
  if (!hit) return null;
  await tx.query(`UPDATE keystone.document_form_layout SET uses = uses + 1 WHERE id = $1`, [hit.id]);
  return hit;
}

/** Keep (or refresh) the layout of a sent document. `fields` are the final placed fields; the seats travel with them. */
export async function rememberLayout(tx, { tenantId, pages, name, fields, roles, actorUserId = null }) {
  if (!pages?.length || !fields?.length || !pages.every((p) => recognisable(p.hash))) return null;
  const { rows } = await tx.query(`SELECT id, pages FROM keystone.document_form_layout WHERE page_count = $1 LIMIT 300`, [pages.length]);
  const same = rows.find((r) => sameLayout(r.pages, pages, 3));
  const stored = fields.map(({ id, type, role, page, x, y, w, h, label, validation, sensitive, autofill }) => ({ id, type, role, page, x, y, w, h, ...(label ? { label } : {}), ...(validation ? { validation } : {}), ...(sensitive ? { sensitive: true } : {}), ...(autofill ? { autofill } : {}) }));
  if (same) { await tx.query(`UPDATE keystone.document_form_layout SET fields = $2::jsonb, roles = $3::jsonb, updated_at = now() WHERE id = $1`, [same.id, JSON.stringify(stored), JSON.stringify(roles ?? [])]); return same.id; }
  const { rows: [r] } = await tx.query(
    `INSERT INTO keystone.document_form_layout (tenant_id, name, page_count, pages, roles, fields, created_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7) RETURNING id`,
    [tenantId, String(name || "Form").slice(0, 200), pages.length, JSON.stringify(pages.map((p) => ({ hash: p.hash }))), JSON.stringify(roles ?? []), JSON.stringify(stored), actorUserId]);
  return r.id;
}

/** A remembered layout as the editor's suggestions: sure of itself (the person placed these), still waiting to be accepted. */
export function suggestionsFromLayout(layout) {
  const suggestions = layout.fields.map((f, i) => ({ id: `r${i + 1}`, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, why: `placed the last time this form was sent`, confidence: 1, source: "remembered", role: f.role, ...(f.label ? { label: f.label } : {}), ...(f.validation ? { format: f.validation } : {}), ...(f.sensitive ? { sensitive: true } : {}), ...(f.autofill ? { autofill: f.autofill } : {}) }));
  return { roles: layout.roles.length ? layout.roles : [{ key: "signer_1", label: "Signer 1" }], suggestions };
}
