import { FIELD_TYPES } from "../flow/flowDefinition.js";
import { SMART } from "../flow/palette.js";
// The field editor's model: what a new field of each kind looks like, the colour of each person's seat, and snapping. Coordinates are fractions of the page (0–1), so they survive any zoom.
export const FIELD_DEFAULTS = {
  signature: { w: 0.28, h: 0.055, label: "Signature" }, initials: { w: 0.08, h: 0.04, label: "Initials" }, date_signed: { w: 0.16, h: 0.03, label: "Date signed" },
  text: { w: 0.28, h: 0.03, label: "Text" }, checkbox: { w: 0.03, h: 0.022, label: "Checkbox" }, dropdown: { w: 0.22, h: 0.03, label: "Choice", options: ["Option 1", "Option 2"] },
  image: { w: 0.2, h: 0.1, label: "Picture" }, multiselect: { w: 0.28, h: 0.045, label: "Pick any", options: ["Option 1", "Option 2", "Option 3"] }, stamp: { w: 0.2, h: 0.09, label: "Stamp" }, file: { w: 0.3, h: 0.03, label: "File upload" },
  payment: { w: 0.26, h: 0.045, label: "Payment", amount_minor: 5000, currency: "usd" },
  // smart text fields: the person's own name or email, or a labelled box
  smart_name: { w: 0.28, h: 0.03, label: "Name" }, smart_email: { w: 0.28, h: 0.03, label: "Email" }, company: { w: 0.28, h: 0.03, label: "Company" }, title: { w: 0.28, h: 0.03, label: "Title" },
};
// the palette is the flow definition's field types that the placement editor can draw (has a default size for)
export const TOOLS = FIELD_TYPES.filter((f) => FIELD_DEFAULTS[f.id]).map((f) => [f.id, f.label]);
export const SEAT_COLOURS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f"];
export const seatColour = (key) => SEAT_COLOURS[(Number(String(key).split("_")[1]) - 1 + SEAT_COLOURS.length * 4) % SEAT_COLOURS.length];
export const rid = () => `f${Math.random().toString(36).slice(2, 9)}`;
export const clamp = (f) => ({ ...f, w: Math.min(Math.max(0.01, f.w), 1), h: Math.min(Math.max(0.01, f.h), 1), x: Math.min(Math.max(0, f.x), 1 - Math.min(Math.max(0.01, f.w), 1)), y: Math.min(Math.max(0, f.y), 1 - Math.min(Math.max(0.01, f.h), 1)) });
export const snap = (v, off = false, step = 0.0025) => (off ? v : Math.round(v / step) * step);
export function newField(type, role, page, x, y) {
  const d = FIELD_DEFAULTS[type];
  const sm = SMART[type];
  return clamp({ id: rid(), type: sm ? sm.type : type, role, page, x, y, w: d.w, h: d.h, required: true, label: d.label, ...(sm?.autofill ? { autofill: sm.autofill } : {}), ...(sm?.validation ? { validation: sm.validation } : {}), ...(d.options ? { options: [...d.options] } : {}), ...(d.amount_minor ? { amount_minor: d.amount_minor, currency: d.currency } : {}) });
}
export function fromSuggestion(s, role, roles = null) {
  const d = FIELD_DEFAULTS[s.type] ?? FIELD_DEFAULTS.text;
  const mine = s.role && (!roles || roles.includes(s.role)) ? s.role : role;      // a detected suggestion knows whose it is; a plain one takes the seat being placed
  return clamp({ id: rid(), type: s.type, role: mine, page: s.page, x: s.x, y: s.y, w: s.w, h: s.h, required: true, label: s.label || d.label, ...(s.format && s.format !== "none" ? { validation: s.format } : {}), ...(s.sensitive ? { sensitive: true } : {}), ...(s.autofill ? { autofill: s.autofill, editable: true } : {}), tooltip: s.label || d.label, ...(d.options ? { options: [...d.options] } : {}), ...(d.amount_minor ? { amount_minor: d.amount_minor, currency: d.currency } : {}) });
}
/** What the detector found, in one line's worth of numbers (the banner above the pages). */
export function detectionSummary(suggestions) {
  const found = suggestions.filter((s) => s.confidence != null);
  if (!found.length) return null;
  return { fields: found.length, signers: new Set(found.map((s) => s.role).filter(Boolean)).size || 1, low: found.filter((s) => s.confidence < 0.6).length };
}
/** Resize by dragging a corner: `dir` is "nw" | "ne" | "sw" | "se"; dx, dy are fractions of the page. Keeps the opposite corner fixed. */
export function resized(f, dir, dx, dy) {
  let { x, y, w, h } = f;
  if (dir.includes("e")) w += dx; else { x += dx; w -= dx; }
  if (dir.includes("s")) h += dy; else { y += dy; h -= dy; }
  if (w < 0.01) { if (!dir.includes("e")) x -= 0.01 - w; w = 0.01; }
  if (h < 0.01) { if (!dir.includes("s")) y -= 0.01 - h; h = 0.01; }
  return clamp({ ...f, x, y, w, h });
}
