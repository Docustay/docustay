// What a person may put in a signing field — the same rules the server applies (src/documents/pdfBody.mjs validateFieldValue), so the page can say what is missing before the server has to refuse.
const V = {
  email: (v) => (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? null : "must be an email address"),
  phone: (v) => (/^[+()\-.\s0-9]{7,25}$/.test(v) && v.replace(/\D/g, "").length >= 7 ? null : "must be a phone number"),
  number: (v) => (v.trim() !== "" && Number.isFinite(Number(v)) ? null : "must be a number"),
  date: (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? null : "must be a date (YYYY-MM-DD)"; },   // R13-D232: a calendar check — Date.parse rolls 2026-02-31 over to 3 March
  zip: (v) => (/^\d{5}(-\d{4})?$/.test(v) ? null : "must be a ZIP code"),
};
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateFieldValue(field, value) {
  const empty = value === undefined || value === null || value === "";
  if (field.type === "date_signed") return null;
  if (empty) return field.required ? "is required" : null;
  if (typeof value !== "string") return "has the wrong shape";
  if (["signature", "initials", "image", "stamp"].includes(field.type)) return PNG.test(value) && value.length <= 204800 ? null : "must be a picture under 200 KB";
  if (field.type === "checkbox") return value === "true" || value === "false" ? (field.required && value === "false" ? "must be ticked" : null) : "must be ticked or not";
  if (field.type === "dropdown") return (field.options ?? []).includes(value) ? null : "must be one of the choices";
  if (field.type === "multiselect") { let l; try { l = JSON.parse(value); } catch { return "has the wrong shape"; } if (!Array.isArray(l) || l.some((x) => typeof x !== "string") || new Set(l).size !== l.length) return "has the wrong shape"; if (l.some((x) => !(field.options ?? []).includes(x))) return "must be from the choices"; return field.required && l.length === 0 ? "needs at least one choice" : null; }
  if (field.type === "payment") return value === "paid" ? null : "needs to be paid";
  if (field.type === "file") return UUID.test(value) ? null : "needs an uploaded file";
  if (value.length > (field.max_length ?? 500)) return `must be ${field.max_length ?? 500} characters or fewer`;
  const rule = field.validation && field.validation !== "none" ? V[field.validation] : null;
  return rule ? rule(value) : null;
}
