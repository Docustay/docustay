// PDF FIELD DETECTION · THE EDITOR'S SHAPE. Turns the engine's result into what a draft stores: the seats the people were grouped into and the dashed suggestions the editor draws and "Accept all" turns into fields. Pure: no imports.
const FORMAT = { date: "date", email: "email", phone: "phone", currency: "number" };
const WHY = { native: "a form field already in the file", line: "a line to write on", text: "a line to write on", box: "an empty box", table: "an empty table cell", checkbox: "a tick box", highlight: "a highlighted signing bar", known: "where this form puts it" };

export function suggestionsFrom(result, { cap = 500 } = {}) {
  const suggestions = result.fields.slice(0, cap).map((f) => ({
    id: f.id, type: f.type, page: f.page, x: f.x, y: f.y, w: Math.max(0.005, f.w), h: Math.max(0.005, f.h),
    why: f.label ? `found “${f.label.slice(0, 60)}”` : (WHY[f.source] ?? "found by the page layout"),
    confidence: f.confidence, source: f.source, ...(f.label ? { label: f.label.slice(0, 120) } : {}), role: f.role,
    ...(f.sensitive ? { sensitive: true } : {}), ...(f.kind === "name" || f.kind === "email" ? { autofill: f.kind } : {}), ...(FORMAT[f.format] ? { format: FORMAT[f.format] } : {}), ...(f.group ? { group: f.group } : {}),
    ...(f.source === "known" && result.recognised ? { knownForm: result.recognised.title } : {}),   // Run 7: a form the known-forms library recognised
  }));
  const s = result.summary;
  return {
    roles: result.roles, suggestions,
    note: { fields: suggestions.length, signers: result.roles.length, lowConfidence: suggestions.filter((x) => x.confidence < 0.6).length, pages: result.pages.map((p) => ({ page: p.page, kind: p.kind, fields: p.fields })), documents: result.documents, truncated: Boolean(s.truncated), timedOut: Boolean(s.timedOut) },
  };
}
