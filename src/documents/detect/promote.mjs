// PDF FIELD DETECTION · SUGGESTIONS → FIELDS. The one place a detected suggestion becomes a placed field, for the API's `fields:"auto"`, Scribe, and "remember this form". (The editor's own "Accept all" does the same in the browser, lib/editor/fields.js.)
// Pure: no imports. Only suggestions at or above `minConfidence` are placed; the rest stay as suggestions for a person to look at.
const DEFAULT_LABEL = { signature: "Signature", initials: "Initials", date_signed: "Date signed", text: "Text", checkbox: "Checkbox", dropdown: "Choice" };

export function promoteSuggestions(body, { minConfidence = 0.6, onlyTypes = null } = {}) {
  const sug = body.suggestions ?? [];
  const take = sug.filter((s) => (s.confidence ?? 1) >= minConfidence && (!onlyTypes || onlyTypes.includes(s.type)));
  const used = new Set((body.fields ?? []).map((f) => f.id));
  const roles = new Set((body.roles ?? []).map((r) => r.key)), first = body.roles?.[0]?.key ?? "signer_1";
  const fields = take.map((s, i) => {
    let id = `f_${s.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60); while (used.has(id)) id = `${id}_${i}`; used.add(id);
    return {
      id, type: s.type, role: s.role && roles.has(s.role) ? s.role : first, page: s.page, x: s.x, y: s.y, w: Math.min(s.w, 1 - s.x), h: Math.min(s.h, 1 - s.y), required: true,
      label: s.label || DEFAULT_LABEL[s.type] || "Field", ...(s.format && s.format !== "none" ? { validation: s.format } : {}), ...(s.sensitive ? { sensitive: true } : {}), ...(s.autofill ? { autofill: s.autofill, editable: true } : {}), tooltip: (s.label || DEFAULT_LABEL[s.type] || "Field").slice(0, 300),
      ...(s.type === "dropdown" ? { options: ["Option 1", "Option 2"] } : {}),
    };
  });
  const left = sug.filter((s) => !take.includes(s));
  const next = { ...body, fields: [...(body.fields ?? []), ...fields] };
  if (left.length) next.suggestions = left; else delete next.suggestions;
  return { body: next, placed: fields.length, left: left.length };
}
