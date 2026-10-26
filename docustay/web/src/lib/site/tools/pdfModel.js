// The shared model of the two PDF tools (sign a PDF, fill a PDF). Everything here runs in the visitor's browser; no function in this folder makes a network request.
//
// ITEMS. Each thing placed on a page is one plain object. Positions are in PDF points of the DISPLAYED page (origin top-left, after the page's own rotation), so the same numbers work for the screen and the file.
//   { id, type, page (1-based), x, y, w, h, value?, image?, size?, source, confidence?, label?, field? }
//   type: "signature" | "initials" | "date" | "text" | "check" | "field" (a form field the PDF already has; `field` = { kind, name, option?, options? })
//   source: "user" (placed by the visitor) | "detected" (placed by a detector, shown as a suggestion until accepted)
//
// DETECTION HOOK. specs/final-push/PDF-FIELD-DETECTION-SPEC.md describes the pipeline that will one day pre-place boxes on an uploaded PDF. This is where it plugs in: register a detector with
// `registerDetector(async ({ bytes, pdf, pages }) => [ { type, page, rect: [x, y, w, h], label?, role?, confidence?, source? } ])` (rect in displayed points, the spec's section 4 and 8 output).
// Nothing is built here: with no detector registered, `runDetectors` returns an empty list and the tools behave exactly as without it. A detector runs in the browser and must not send the file anywhere.
const detectors = [];
export const registerDetector = (fn) => { detectors.push(fn); };
export const detectorCount = () => detectors.length;
export async function runDetectors(ctx) {
  const out = [];
  for (const d of detectors) { try { for (const f of (await d(ctx)) ?? []) out.push(fromDetected(f)); } catch { /* a failing detector never blocks the tool */ } }
  return out;
}
const TYPE_DEFAULT = { signature: [150, 48], initials: [56, 32], date: [92, 20], text: [150, 20], check: [18, 18] };
export const defaultSize = (type) => TYPE_DEFAULT[type] ?? [120, 20];
let counter = 0;
export const newId = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;
export function fromDetected(f) {
  const [x, y, w, h] = f.rect; return { id: newId(), type: f.type ?? "text", page: f.page ?? 1, x, y, w, h, value: "", source: "detected", confidence: f.confidence ?? 0.5, label: f.label ?? "" };
}
/** A page's own rotation and size from pdf.js (displayed points). */
export function pageGeometry(pdfjsPage) { const v = pdfjsPage.getViewport({ scale: 1 }); return { w: v.width, h: v.height, rotation: ((pdfjsPage.rotate % 360) + 360) % 360 }; }
/** Map a point on the displayed page (top-left origin) to the file's own user space. W and H are the cropbox size before rotation; cx and cy its origin. */
export function toUser(rot, W, H, cx, cy, px, py) {
  if (rot === 90) return [cx + py, cy + px];
  if (rot === 180) return [cx + (W - px), cy + py];
  if (rot === 270) return [cx + (W - py), cy + (H - px)];
  return [cx + px, cy + (H - py)];
}
export const todayText = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const initialsOf = (name) => name.trim().split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase()).slice(0, 3).join("");
export const MAX_BYTES = 150 * 1024 * 1024;
