// Writes the placed items into a copy of the visitor's PDF with pdf-lib (MIT), in the browser. The original bytes are never changed and never sent anywhere.
import { toUser } from "./pdfModel.js";
const dataUrlToBytes = (u) => { const b = atob(u.split(",")[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
/** @returns {{ bytes: Uint8Array, notes: string[] }} */
export async function writePdf(srcBytes, items, { flatten = false } = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = await import("pdf-lib");
  const notes = [];
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages(), imgCache = new Map();
  // 1) fields the PDF already has
  const fieldItems = items.filter((i) => i.type === "field");
  if (fieldItems.length) {
    const form = doc.getForm();
    for (const it of fieldItems) {
      try {
        const f = form.getFieldMaybe?.(it.field.name) ?? form.getField(it.field.name);
        if (f instanceof PDFTextField) { if (it.value != null && it.value !== "") f.setText(String(it.value)); }
        else if (f instanceof PDFCheckBox) { if (it.value) f.check(); else f.uncheck(); }
        else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (it.value) f.select(String(it.value)); }
        else if (f instanceof PDFRadioGroup) { if (it.value === it.field.option && it.value) f.select(it.field.option); }
      } catch (e) { notes.push(`Could not write the field "${it.field.name}": ${String(e.message ?? e).slice(0, 80)}`); }
    }
    try { form.updateFieldAppearances(font); } catch { /* appearance refresh is best effort */ }
    if (flatten) { try { form.flatten(); } catch { notes.push("The fields could not be made non-editable, so they stay editable."); } }
  }
  // 2) everything placed by hand
  for (const it of items) {
    if (it.type === "field") continue;
    const page = pages[it.page - 1]; if (!page) continue;
    const rot = ((page.getRotation().angle % 360) + 360) % 360, cb = page.getCropBox?.() ?? { x: 0, y: 0, ...page.getSize() };
    const W = cb.width, H = cb.height, map = (px, py) => toUser(rot, W, H, cb.x, cb.y, px, py);
    if (it.type === "signature" || it.type === "initials") {
      if (!it.image) continue; let img = imgCache.get(it.image); if (!img) { img = await doc.embedPng(dataUrlToBytes(it.image)); imgCache.set(it.image, img); }
      const [ux, uy] = map(it.x, it.y + it.h); page.drawImage(img, { x: ux, y: uy, width: it.w, height: it.h, rotate: degrees(rot) });
    } else if (it.type === "check") {
      const s = it.w, p = (fx, fy) => map(it.x + fx * s, it.y + fy * it.h); const a = p(0.16, 0.54), b = p(0.4, 0.8), c = p(0.86, 0.2);
      const t = Math.max(1.2, s * 0.12), col = rgb(0.1, 0.1, 0.1);
      page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: t, color: col }); page.drawLine({ start: { x: b[0], y: b[1] }, end: { x: c[0], y: c[1] }, thickness: t, color: col });
    } else if (it.type === "text" || it.type === "date") {
      let text = String(it.value ?? ""); if (!text) continue; const size = it.size ?? 12; let safe = text;
      try { font.encodeText(safe); } catch { safe = [...safe].map((ch) => { try { font.encodeText(ch); return ch; } catch { return "?"; } }).join(""); notes.push("Some characters cannot be written into a PDF with the built-in font and were replaced by ?."); }
      const [ux, uy] = map(it.x + 2, it.y + it.h / 2 + size * 0.32); page.drawText(safe, { x: ux, y: uy, size, font, color: rgb(0.1, 0.1, 0.1), rotate: degrees(rot) });
    }
  }
  const out = await doc.save();
  return { bytes: out, notes: [...new Set(notes)] };
}
/** The form fields a PDF already has, with their boxes on the displayed page. Reads only; nothing is changed. */
export async function readFields(srcBytes, geoms) {
  const { PDFDocument, PDFName, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = await import("pdf-lib");
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true, updateMetadata: false }), pages = doc.getPages();
  let form; try { form = doc.getForm(); } catch { return []; }
  const out = [];
  const pageIndexOf = (widget) => { const ref = widget.P?.(); if (ref) { const i = pages.findIndex((p) => p.ref === ref); if (i >= 0) return i; } for (let i = 0; i < pages.length; i++) { const annots = pages[i].node.Annots?.(); if (annots) for (let k = 0; k < annots.size(); k++) if (annots.get(k) === widget.dict || doc.context.lookup(annots.get(k)) === widget.dict) return i; } return 0; };
  for (const f of form.getFields()) {
    let kind = null; if (f instanceof PDFTextField) kind = "text"; else if (f instanceof PDFCheckBox) kind = "check"; else if (f instanceof PDFDropdown || f instanceof PDFOptionList) kind = "choice"; else if (f instanceof PDFRadioGroup) kind = "radio"; if (!kind) continue;
    const widgets = f.acroField.getWidgets(); let options; try { options = kind === "choice" ? f.getOptions() : kind === "radio" ? f.getOptions() : undefined; } catch { options = undefined; }
    widgets.forEach((w, wi) => {
      const pi = pageIndexOf(w), page = pages[pi], g = geoms[pi]; if (!page || !g) return; const r = w.getRectangle(), rot = g.rotation, cb = page.getCropBox?.() ?? { x: 0, y: 0, ...page.getSize() };
      const ux = r.x - cb.x, uy = r.y - cb.y, uw = r.width, uh = r.height; let x, y, w2 = uw, h2 = uh;
      if (rot === 0) { x = ux; y = cb.height - uy - uh; } else if (rot === 90) { x = uy; y = ux; w2 = uh; h2 = uw; } else if (rot === 180) { x = cb.width - ux - uw; y = uy; } else { x = cb.height - uy - uh; y = cb.width - ux - uw; w2 = uh; h2 = uw; }
      let option; if (kind === "radio") { try { option = (f.getOptions?.() ?? [])[wi]; } catch { option = undefined; } }
      let value = ""; try { value = kind === "text" ? f.getText() ?? "" : kind === "check" ? f.isChecked() : kind === "choice" ? (f.getSelected?.()[0] ?? "") : (f.getSelected?.() ?? ""); } catch { /* unreadable value */ }
      out.push({ page: pi + 1, x, y, w: w2, h: h2, name: f.getName(), kind, option, options, value });
    });
  }
  return out;
}
