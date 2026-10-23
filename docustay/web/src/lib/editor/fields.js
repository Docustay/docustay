import { FIELD_TYPES } from "../flow/flowDefinition.js";
import { SMART } from "../flow/palette.js";
// The field editor's model: what a new field of each kind looks like, the colour of each person's seat, and snapping. Coordinates are fractions of the page (0–1), so they survive any zoom.
export const FIELD_DEFAULTS = {
  signature: { w: 0.28, h: 0.055, label: "Signature" }, initials: { w: 0.08, h: 0.04, label: "Initials" }, date_signed: { w: 0.16, h: 0.03, label: "Date signed" },
  text: { w: 0.28, h: 0.03, label: "Text" }, checkbox: { w: 0.03, h: 0.022, label: "Checkbox" }, dropdown: { w: 0.22, h: 0.03, label: "Choice", options: ["Option 1", "Option 2"] },
  image: { w: 0.2, h: 0.1, label: "Picture" }, multiselect: { w: 0.28, h: 0.045, label: "Pick any", options: ["Option 1", "Option 2", "Option 3"] }, stamp: { w: 0.2, h: 0.09, label: "Stamp" }, file: { w: 0.3, h: 0.03, label: "File upload" },
  payment: { w: 0.26, h: 0.045, label: "Payment", amount_minor: 5000, currency: "usd" },
  // smart text fields: the person's own name or email, or a labelled box
  number: { w: 0.16, h: 0.03, label: "Number" }, date: { w: 0.16, h: 0.03, label: "Date" }, phone: { w: 0.2, h: 0.03, label: "Phone" }, zip: { w: 0.12, h: 0.03, label: "ZIP code" },
  select: { w: 0.22, h: 0.03, label: "Choose one", options: ["Option 1", "Option 2"] },
  smart_name: { w: 0.28, h: 0.03, label: "Name" }, smart_email: { w: 0.28, h: 0.03, label: "Email" }, company: { w: 0.28, h: 0.03, label: "Company" }, title: { w: 0.28, h: 0.03, label: "Title" },
};
// the palette is the flow definition's field types that the placement editor can draw (has a default size for)
export const TOOLS = FIELD_TYPES.filter((f) => FIELD_DEFAULTS[f.id]).map((f) => [f.id, f.label]);
export const SEAT_COLOURS = ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f"];
export const seatColour = (key) => SEAT_COLOURS[(Number(String(key).split("_")[1]) - 1 + SEAT_COLOURS.length * 4) % SEAT_COLOURS.length];
export const rid = () => `f${Math.random().toString(36).slice(2, 9)}`;
export const clamp = (f) => ({ ...f, w: Math.min(Math.max(0.01, f.w), 1), h: Math.min(Math.max(0.01, f.h), 1), x: Math.min(Math.max(0, f.x), 1 - Math.min(Math.max(0.01, f.w), 1)), y: Math.min(Math.max(0, f.y), 1 - Math.min(Math.max(0.01, f.h), 1)) });
export const snap = (v, off = false, step = 0.0025) => (off ? v : Math.round(v / step) * step);
// R13-D049: the palette offers these, but a PDF holds no "number", "date", "phone", "zip" or "select" box of its own: each is a text box with a format, and "Choose one" is a dropdown
const PDF_FORMATTED = Object.freeze({
  number: { type: "text", validation: "number" }, date: { type: "text", validation: "date" }, phone: { type: "text", validation: "phone" }, zip: { type: "text", validation: "zip" }, select: { type: "dropdown" },
});
export function newField(type, role, page, x, y) {
  const d = FIELD_DEFAULTS[type];
  const sm = SMART[type] ?? PDF_FORMATTED[type];
  return clamp({ id: rid(), type: sm ? sm.type : type, role, page, x, y, w: d.w, h: d.h, required: true, label: d.label, ...(sm?.autofill ? { autofill: sm.autofill } : {}), ...(sm?.validation ? { validation: sm.validation } : {}), ...(d.options ? { options: [...d.options] } : {}), ...(d.amount_minor ? { amount_minor: d.amount_minor, currency: d.currency } : {}) });
}
export function fromSuggestion(s, role, roles = null) {
  const d = FIELD_DEFAULTS[s.type] ?? FIELD_DEFAULTS.text;
  const mine = s.role && (!roles || roles.includes(s.role)) ? s.role : role;      // a detected suggestion knows whose it is; a plain one takes the seat being placed
  return clamp({ id: rid(), type: s.type, role: mine, page: s.page, x: s.x, y: s.y, w: s.w, h: s.h, required: true, label: s.label || d.label, ...(s.format && s.format !== "none" ? { validation: s.format } : {}), ...(s.sensitive ? { sensitive: true } : {}), ...(s.autofill ? { autofill: s.autofill, editable: true } : {}), tooltip: s.label || d.label, ...(d.options ? { options: [...d.options] } : {}), ...(d.amount_minor ? { amount_minor: d.amount_minor, currency: d.currency } : {}) });
}
// R13-D025 / R13-D026: the detector names people by the words printed on the page (Landlord, Tenant, Witness) and numbers them signer_1, signer_2 … in the order they first appear. Those numbers
// mean nothing about the people the sender actually added, so a suggestion is put on a REAL seat before it becomes a field: the detected people, in order, onto the signers added, in order.
// It never names a seat nobody fills. A witness is not a seat (the witness signs in their own step after the person they witness), so witness boxes get no seat at all.
const WITNESS_WORDS = /witness|testigo|zeuge|t[eé]moin|testimone|testemunha|getuige|свидетель/i;
const centre = (s) => [s.x + s.w / 2, s.y + s.h / 2];
const dist = (a, b) => { const [ax, ay] = centre(a), [bx, by] = centre(b); return (ax - bx) ** 2 + (ay - by) ** 2; };
const reading = (a, b) => a.page - b.page || a.y - b.y || a.x - b.x;
/**
 * @param suggestions  detected suggestions ({ id, type, role, page, x, y, w, h })
 * @param seats        the keys of the signer seats actually on the document, in order
 * @param labelOf      key → the label the detector gave that person (to recognise a witness)
 * @returns { role: Map<suggestion id → seat key>, witness: Set<suggestion id> }  — a suggestion in neither has no detected person and takes the seat being placed
 */
export function mapSuggestionSeats(suggestions, { seats = [], labelOf = () => "" } = {}) {
  const role = new Map(), witness = new Set(), keys = [...new Set(seats)];
  if (!keys.length) return { role, witness };
  const isWitness = (s) => WITNESS_WORDS.test(String(labelOf(s.role) ?? ""));
  const named = suggestions.filter((s) => s.role);
  for (const s of named) if (isWitness(s)) witness.add(s.id);
  const people = [];                                            // detected people other than a witness, in the order the detector met them
  for (const s of [...named].sort(reading)) if (!witness.has(s.id) && !people.includes(s.role)) people.push(s.role);
  if (people.every((k) => /^signer_\d+$/.test(k))) people.sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));
  const seatFor = (i) => keys[Math.min(i, keys.length - 1)];
  const base = new Map(people.map((k, i) => [k, seatFor(i)]));
  const spare = keys.slice(people.length);                      // seats the detector found no one for: a second, side-by-side block of the same person ("Tenant 1", "Tenant 2") takes them in turn
  const own = new Map();                                        // suggestion id → seat, for the extra blocks
  for (const k of people) {
    const sigs = named.filter((s) => s.role === k && s.type === "signature" && !witness.has(s.id)).sort(reading);
    const blocks = [];                                          // the signature boxes that stand for a separate person: a later box on a page where this person already signs
    sigs.forEach((s) => { if (sigs.some((o) => o !== s && o.page === s.page && reading(o, s) < 0)) blocks.push(s); });
    blocks.forEach((s) => { if (spare.length) own.set(s.id, spare.shift()); });
    if (own.size) for (const s of named) {                      // what sits beside an extra block (its date, its initials) goes with it
      if (s.role !== k || own.has(s.id) || witness.has(s.id) || s.type === "signature") continue;
      const near = sigs.filter((o) => o.page === s.page).sort((a, b) => dist(a, s) - dist(b, s))[0];
      if (near && own.has(near.id)) own.set(s.id, own.get(near.id));
    }
  }
  for (const s of named) if (!witness.has(s.id)) role.set(s.id, own.get(s.id) ?? base.get(s.role));
  return { role, witness };
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
