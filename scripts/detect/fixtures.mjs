// PDF FIELD DETECTION · THE TWELVE SYNTHETIC FIXTURES (PDF-FIELD-DETECTION-SPEC §6). Made-up office paperwork with ground truth, no real person's data. Every fixture returns { name, bytes, truth, expect }.
// truth: [{ type, page, x, y, w, h, role? }] in page fractions (y from the top); a detected field is right when it is on the same page, of the same type, with its centre inside the truth box (grown a little).
// Run `node scripts/detect/fixtures.mjs <dir>` to write the PDFs and their truth files; the tests build them in memory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, degrees } from "@cantoo/pdf-lib";
import PDFKit from "pdfkit";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { openPdf, renderPage } from "../../src/documents/detect/render.mjs";

export const W = 612, H = 792;
const black = rgb(0, 0, 0);
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export class Pg {
  constructor(doc, page, font, bold, no, truth) { Object.assign(this, { doc, page, font, bold, no, truth }); }
  t(str, x, yb, { size = 11, b = false, color = black, font = null } = {}) { this.page.drawText(str, { x, y: H - yb, size, font: font ?? (b ? this.bold : this.font), color }); return (font ?? (b ? this.bold : this.font)).widthOfTextAtSize(str, size); }
  line(x, yt, w, th = 0.8) { this.page.drawLine({ start: { x, y: H - yt }, end: { x: x + w, y: H - yt }, thickness: th, color: black }); }
  box(x, yt, s) { this.page.drawRectangle({ x, y: H - yt - s, width: s, height: s, borderWidth: 1, borderColor: black }); }
  rect(x, yt, w, h) { this.page.drawRectangle({ x, y: H - yt - h, width: w, height: h, borderWidth: 0.8, borderColor: black }); }
  bar(x, yt, w, h) { this.page.drawRectangle({ x, y: H - yt - h, width: w, height: h, color: rgb(1, 0.93, 0.2), opacity: 1 }); }
  para(lines, x, yb, size = 10, lead = 14) { lines.forEach((l, i) => this.t(l, x, yb + i * lead, { size })); return yb + lines.length * lead; }
  /** Label, then the line to write on; records the truth. under: label printed below the line. */
  blank(label, x, yb, w, type, role = null, { under = false, size = 11, gap = 6 } = {}) {
    let lx = x, ly = yb + 2;
    if (under) { this.line(x, yb, w); this.t(label, x, yb + 12, { size: 9 }); ly = yb; }
    else { const tw = this.t(label, x, yb, { size }); lx = x + tw + gap; this.line(lx, ly, w); }
    this.truth.push({ type, page: this.no, x: lx / W, y: (ly - 16) / H, w: w / W, h: 18 / H, ...(role ? { role } : {}) });
    return lx + w;
  }
  check(x, yb, s = 11, label = null, role = null, group = null) {
    this.box(x, yb - s + 1, s); if (label) this.t(label, x + s + 5, yb, { size: 10 });
    this.truth.push({ type: "checkbox", page: this.no, x: x / W, y: (yb - s + 1) / H, w: s / W, h: s / H, ...(group ? { group } : {}) });
  }
}

export async function start(extra = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const truth = [];
  const add = () => { const page = doc.addPage([W, H]); const no = doc.getPageCount(); return new Pg(doc, page, font, bold, no, truth); };
  return { doc, font, bold, truth, add, ...extra };
}

/** Turn every page into a picture: tilt, shade, blur-ish noise. The result has no text layer, like a scan or a photograph. */
export async function rasterise(bytes, { deg = 1.2, shade = 0, noise = 10, keystone = 0, dpi = 150 } = {}) {
  const { pdf } = await openPdf(bytes), out = await PDFDocument.create();
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const img = await renderPage(pdf, p, { dpi }), { w, h } = img, src = img.rgba;
    const c = createCanvas(w, h), ctx = c.getContext("2d"), dst = ctx.createImageData(w, h);
    const s = Math.sin((deg * Math.PI) / 180), co = Math.cos((deg * Math.PI) / 180);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const k = keystone * ((y / h) - 0.5), dx = (x - w / 2) / (1 + k), dy = y - h / 2;
      const sx = Math.round(w / 2 + dx * co + dy * s), sy = Math.round(h / 2 - dx * s + dy * co);
      let r = 255, g = 255, b = 255;
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) { const i = (sy * w + sx) * 4; r = src[i]; g = src[i + 1]; b = src[i + 2]; }
      const sh = shade ? 1 - shade * (x / w) * 0.8 - shade * (y / h) * 0.4 : 1, nz = (rnd() - 0.5) * noise * 2;
      const o = (y * w + x) * 4; dst.data[o] = Math.max(0, Math.min(255, r * sh + nz)); dst.data[o + 1] = Math.max(0, Math.min(255, g * sh + nz)); dst.data[o + 2] = Math.max(0, Math.min(255, b * sh + nz)); dst.data[o + 3] = 255;
    }
    ctx.putImageData(dst, 0, 0);
    const png = await out.embedPng(c.toBuffer("image/png")), page = out.addPage([W, H]); page.drawImage(png, { x: 0, y: 0, width: W, height: H });
  }
  return out.save();
}

const FIXTURES = {
  async scanUnderlines() {
    const f = await start(), p = f.add();
    p.t("Participation Agreement", 72, 90, { size: 20, b: true });
    p.para(["This agreement is between the participant and the agency named below.", "By signing, the participant agrees to attend the sessions that are scheduled and to tell", "the agency about any change that affects the plan."], 72, 120);
    p.blank("Participant Name:", 72, 220, 250, "text");
    p.blank("Participant Signature:", 72, 290, 170, "signature", "client"); p.blank("Date:", 380, 290, 110, "date_signed", "client");
    p.blank("Witness Signature:", 72, 360, 170, "signature", "witness"); p.blank("Date:", 380, 360, 110, "date_signed", "witness");
    p.blank("Case Manager Signature:", 72, 430, 150, "signature", "case_manager"); p.blank("Date:", 380, 430, 110, "date_signed", "case_manager");
    const bytes = await rasterise(await f.doc.save(), { deg: 1.2, noise: 12 });
    return { name: "scan-underlines", bytes, truth: f.truth, expect: { scanned: true, signers: 3 } };
  },
  async checklists() {
    const f = await start(), p = f.add();
    p.t("Intake Checklist", 72, 90, { size: 20, b: true });
    p.blank("Name:", 72, 130, 260, "text");
    p.t("Current situation", 72, 175, { b: true });
    p.check(72, 200, 11, "Housing needs"); p.check(110, 222, 11, "Shelter"); p.check(190, 222, 11, "Transitional"); p.check(290, 222, 11, "Other");
    p.check(72, 250, 11, "Employment support"); p.check(110, 272, 11, "Resume help"); p.check(210, 272, 11, "Job search");
    p.check(72, 300, 11, "Health insurance"); p.check(110, 322, 11, "Medicaid"); p.check(190, 322, 11, "Marketplace");
    p.t("Check only one", 72, 360, { b: true });
    p.check(72, 385, 11, "Weekly"); p.check(150, 385, 11, "Every two weeks"); p.check(280, 385, 11, "Monthly");
    return { name: "checklists", bytes: await f.doc.save(), truth: f.truth, expect: {} };
  },
  async tablePlan() {
    const f = await start(), p = f.add();
    p.t("Action Plan", 72, 90, { size: 20, b: true });
    p.blank("Participant Name:", 72, 130, 240, "text");
    const x0 = 72, cols = [170, 190, 108], rowH = 30, y0 = 170;
    const heads = ["Action step", "Person responsible", "Date"];
    let x = x0; heads.forEach((h, i) => { p.rect(x, y0, cols[i], rowH); p.t(h, x + 6, y0 + 19, { size: 10, b: true }); x += cols[i]; });
    for (let r = 1; r <= 4; r += 1) { x = x0; cols.forEach((cw, i) => { p.rect(x, y0 + r * rowH, cw, rowH); f.truth.push({ type: i === 2 ? "text" : "text", page: 1, x: (x + 2) / W, y: (y0 + r * rowH + 2) / H, w: (cw - 4) / W, h: (rowH - 4) / H, table: true }); x += cw; }); }
    p.blank("Participant Signature:", 72, 400, 210, "signature", "client"); p.blank("Date:", 380, 400, 110, "date_signed", "client");
    return { name: "table-plan", bytes: await f.doc.save(), truth: f.truth, expect: {} };
  },
  async consentHighlight() {
    const f = await start(), p = f.add();
    p.t("Consent for Services", 72, 90, { size: 20, b: true });
    p.para(["I understand the services described to me and I agree to take part.", "I may stop at any time by telling the staff in writing."], 72, 120);
    const row = (label, yt, role) => { p.bar(72, yt, 230, 16); p.line(72, yt + 16, 230); p.t(label, 72, yt + 30, { size: 9 }); f.truth.push({ type: "signature", page: 1, x: 72 / W, y: yt / H, w: 230 / W, h: 18 / H, role }); p.t("Date", 340, yt + 30, { size: 9 }); p.line(340, yt + 16, 110); f.truth.push({ type: "date_signed", page: 1, x: 340 / W, y: (yt) / H, w: 110 / W, h: 18 / H, role }); };
    row("Client signature", 230, "client"); row("Parent/Guardian signature", 320, "guardian"); row("Staff signature", 410, "agency");
    return { name: "consent-highlight", bytes: await f.doc.save(), truth: f.truth, expect: { signers: 3 } };
  },
  async sidewaysRates() {
    const f = await start(), p = f.add(); p.page.setRotation(degrees(90));
    p.t("Rate Schedule", 72, 90, { size: 20, b: true });
    const cols = [150, 120, 120, 120]; const rows = [["Service", "Weekly", "Monthly", "Annual"], ["Coaching", "$45", "$180", "$2,100"], ["Group", "$20", "$80", "$900"], ["Intake", "$60", "$60", "$60"]];
    rows.forEach((r, ri) => { let x = 72; r.forEach((c, ci) => { p.rect(x, 130 + ri * 28, cols[ci], 28); p.t(c, x + 6, 130 + ri * 28 + 18, { size: 10, b: ri === 0 }); x += cols[ci]; }); });
    return { name: "sideways-rates", bytes: await f.doc.save(), truth: [], expect: { referencePages: [1] } };
  },
  async mixedPacket() {
    const f = await start();
    let p = f.add(); p.t("Intake Form", 72, 90, { size: 20, b: true }); p.blank("Name:", 72, 140, 250, "text"); p.blank("Client Signature:", 72, 220, 210, "signature", "client"); p.blank("Date:", 360, 220, 110, "date_signed", "client");
    p = f.add(); p.t("Our Services", 72, 100, { size: 24, b: true }); p.para(["We offer coaching, groups and housing support.", "Call us any weekday between nine and five.", "", "• Individual coaching", "• Weekly groups", "• Family sessions"], 72, 140, 12, 18);
    p = f.add(); p.t("Rate Schedule", 72, 100, { size: 20, b: true }); [["Coaching", "$45"], ["Group", "$20"], ["Intake", "$60"]].forEach((r, i) => { p.rect(72, 140 + i * 28, 160, 28); p.t(r[0], 78, 158 + i * 28, { size: 10 }); p.rect(232, 140 + i * 28, 90, 28); p.t(r[1], 238, 158 + i * 28, { size: 10 }); });
    p = f.add(); p.t("Release of Information", 72, 90, { size: 20, b: true }); p.blank("Participant Name:", 72, 140, 230, "text"); p.blank("Participant Signature:", 72, 220, 200, "signature", "client"); p.blank("Date:", 380, 220, 100, "date_signed", "client"); p.blank("Witness Signature:", 72, 290, 200, "signature", "witness"); p.blank("Date:", 380, 290, 100, "date_signed", "witness");
    return { name: "mixed-packet", bytes: await f.doc.save(), truth: f.truth, expect: { documents: ["form", "reference", "form"], referencePages: [2, 3] } };
  },
  async acroForm() {
    const f = await start(), p = f.add(); p.t("Registration", 72, 90, { size: 20, b: true });
    const form = f.doc.getForm();
    p.t("Full name", 72, 135); const tf = form.createTextField("full_name"); tf.addToPage(p.page, { x: 160, y: H - 140, width: 220, height: 18 });
    p.t("Email", 72, 175); const em = form.createTextField("email_address"); em.addToPage(p.page, { x: 160, y: H - 180, width: 220, height: 18 });
    p.t("I agree", 72, 215); const cb = form.createCheckBox("agree"); cb.addToPage(p.page, { x: 160, y: H - 225, width: 14, height: 14 });
    p.t("Plan", 72, 255); const dd = form.createDropdown("plan"); dd.addOptions(["Basic", "Plus"]); dd.addToPage(p.page, { x: 160, y: H - 260, width: 140, height: 18 });
    const t = [["text", 160, 122, 220, 18], ["text", 160, 162, 220, 18], ["checkbox", 160, 211, 14, 14], ["dropdown", 160, 242, 140, 18]];
    t.forEach(([type, x, yt, w, h]) => f.truth.push({ type, page: 1, x: x / W, y: yt / H, w: w / W, h: h / H }));
    return { name: "acroform", bytes: await f.doc.save(), truth: f.truth, expect: { native: 4 } };
  },
  async textTags() {
    const f = await start(), p = f.add(); p.t("Purchase Agreement", 72, 90, { size: 20, b: true });
    p.t("Buyer: {{Buyer name;type=text;role=Buyer}}", 72, 140); p.t("Buyer signature: {{Buyer signature;type=signature;role=Buyer}}", 72, 190); p.t("Seller signature: {{Seller signature;type=signature;role=Seller}}", 72, 240);
    return { name: "text-tags", bytes: await f.doc.save(), truth: [], expect: { tags: 3 } };
  },
  async yesNo() {
    const f = await start(), p = f.add(); p.t("Screening Questions", 72, 90, { size: 20, b: true });
    p.t("1. Do you have a driver's license?", 72, 140); p.check(90, 165, 11, "Yes"); p.check(160, 165, 11, "No");
    p.t("2. Are you currently employed?", 72, 210); p.check(90, 235, 11, "Yes"); p.check(160, 235, 11, "No");
    p.t("3. Do you have a place to stay tonight?", 72, 280);
    p.t("Yes", 90, 306, { size: 10 }); p.line(112, 308, 28); f.truth.push({ type: "checkbox", page: 1, x: 112 / W, y: 296 / H, w: 28 / W, h: 14 / H });
    p.t("No", 170, 306, { size: 10 }); p.line(186, 308, 28); f.truth.push({ type: "checkbox", page: 1, x: 186 / W, y: 296 / H, w: 28 / W, h: 14 / H });
    return { name: "yes-no", bytes: await f.doc.save(), truth: f.truth, expect: { groups: 3 } };
  },
  async photographed() {
    const f = await start(), p = f.add(); p.t("Lease Acknowledgement", 72, 90, { size: 20, b: true });
    p.para(["The tenant has received the keys and the house rules.", "The landlord confirms the deposit has been paid in full."], 72, 125);
    p.blank("Tenant Signature:", 72, 230, 210, "signature", "tenant"); p.blank("Date:", 360, 230, 110, "date_signed", "tenant");
    p.blank("Landlord Signature:", 72, 310, 210, "signature", "landlord"); p.blank("Date:", 360, 310, 110, "date_signed", "landlord");
    p.blank("Tenant Name:", 72, 390, 240, "text");
    const bytes = await rasterise(await f.doc.save(), { deg: 2.0, shade: 0.35, noise: 14, keystone: 0.04 });
    return { name: "photographed", bytes, truth: f.truth, expect: { scanned: true, signers: 2 } };
  },
  async nonEnglish() {
    const f = await start(), p = f.add(); p.t("Acuerdo de Participacion", 72, 90, { size: 20, b: true });
    p.blank("Nombre:", 72, 150, 240, "text"); p.blank("Firma del participante:", 72, 220, 190, "signature", "client"); p.blank("Fecha:", 380, 220, 100, "date_signed", "client");
    p.t("Teilnahmevereinbarung", 72, 300, { size: 16, b: true });
    p.blank("Unterschrift Zeuge:", 72, 340, 190, "signature", "witness"); p.blank("Datum:", 380, 340, 100, "date_signed", "witness");
    return { name: "non-english", bytes: await f.doc.save(), truth: f.truth, expect: {} };
  },
  async rtl() {
    // drawn with pdfkit (as the product's own certificate is): it shapes and orders Arabic, so the text layer is what a real Arabic form carries
    const truth = [], fontFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/documents/fonts/PlexSansArabic-Regular.ttf");
    const doc = new PDFKit({ size: [W, H], margin: 0, compress: false }), chunks = []; doc.on("data", (c) => chunks.push(c));
    doc.font(fontFile);
    doc.fontSize(20).text("اتفاقية المشاركة", 72, 70, { width: 468, align: "right", features: ["rtla"] });
    const row = (label, yb, type, role) => {
      doc.fontSize(12); const tw = doc.widthOfString(label, { features: ["rtla"] }), right = 540;
      doc.text(label, right - tw, yb - 12, { features: ["rtla"], lineBreak: false });
      const lx = 120, lw = right - tw - 8 - lx; doc.moveTo(lx, yb + 2).lineTo(lx + lw, yb + 2).lineWidth(0.8).stroke("#000");
      truth.push({ type, page: 1, x: lx / W, y: (yb + 2 - 16) / H, w: lw / W, h: 18 / H, ...(role ? { role } : {}) });
    };
    row("الاسم:", 160, "text"); row("التوقيع:", 230, "signature", "client"); row("التاريخ:", 300, "date_signed", "client");
    const done = new Promise((r) => doc.on("end", r)); doc.end(); await done;
    return { name: "rtl", bytes: new Uint8Array(Buffer.concat(chunks)), truth, expect: {} };
  },
};


// HELD-OUT LAYOUTS: written AFTER the detector was tuned on the twelve above, and not used to tune it. They are the honest measure of how it does on a form it has not seen.
const HELD_OUT = {
  async labelsUnder() {
    const f = await start(), p = f.add(); p.t("Service Authorization", 72, 90, { size: 18, b: true });
    p.blank("Client Signature", 72, 200, 200, "signature", "client", { under: true }); p.blank("Date", 340, 200, 120, "date_signed", "client", { under: true });
    p.blank("Provider Signature", 72, 290, 200, "signature", "case_manager", { under: true }); p.blank("Date", 340, 290, 120, "date_signed", "case_manager", { under: true });
    p.blank("Print name", 72, 380, 200, "text", null, { under: true });
    return { name: "held-labels-under", bytes: await f.doc.save(), truth: f.truth, expect: {} };
  },
  async xMarkers() {
    const f = await start(), p = f.add(); p.t("Loan Acknowledgement", 72, 90, { size: 18, b: true });
    p.t("X", 72, 238, { size: 14, b: true }); p.line(88, 240, 230); p.t("Borrower signature", 88, 253, { size: 8 }); f.truth.push({ type: "signature", page: 1, x: 88 / W, y: 222 / H, w: 230 / W, h: 18 / H, role: "client" });
    p.t("X", 72, 338, { size: 14, b: true }); p.line(88, 340, 230); p.t("Lender signature", 88, 353, { size: 8 }); f.truth.push({ type: "signature", page: 1, x: 88 / W, y: 322 / H, w: 230 / W, h: 18 / H, role: "agency" });
    return { name: "held-x-markers", bytes: await f.doc.save(), truth: f.truth, expect: {} };
  },
  async denseTwoColumn() {
    const f = await start(), p = f.add(); p.t("Registration Form", 72, 80, { size: 18, b: true });
    const L = ["Name:", "Address:", "City:", "Phone:", "Email:"], R = ["Zip:", "State:", "Employer:", "Date of birth:", "SSN:"];
    L.forEach((l, i) => p.blank(l, 60, 130 + i * 40, 150, "text")); R.forEach((l, i) => p.blank(l, 330, 130 + i * 40, 150, "text"));
    p.blank("Applicant Signature:", 60, 400, 170, "signature", "client"); p.blank("Date:", 400, 400, 100, "date_signed", "client");
    return { name: "held-dense", bytes: await f.doc.save(), truth: f.truth, expect: {} };
  },
  async textBlanks() {
    const f = await start(), p = f.add(); p.t("Waiver", 72, 80, { size: 18, b: true });
    const row = (label, yb, type, role, dots) => { const tw = p.t(label, 72, yb); const run = dots ? "." .repeat(60) : "_".repeat(34); const w = p.t(run, 72 + tw + 6, yb); f.truth.push({ type, page: 1, x: (72 + tw + 6) / W, y: (yb - 14) / H, w: w / W, h: 18 / H, ...(role ? { role } : {}) }); };
    row("Name:", 150, "text", null, false); row("Signature:", 220, "signature", "client", false); row("Date:", 290, "date_signed", "client", true);
    return { name: "held-text-blanks", bytes: await f.doc.save(), truth: f.truth, expect: {} };
  },
};
export const HELD_OUT_NAMES = Object.keys(HELD_OUT);
export const buildHeldOut = (n) => HELD_OUT[n]();

export const FIXTURE_NAMES = Object.keys(FIXTURES);
export const buildFixture = (n) => FIXTURES[n]();

/** How right was the detection? Recall = truth boxes found with the right type; precision = detected fields that sit on a truth box; roles = detected seats that map consistently onto the true roles. */
export function score(truth, fields, { tol = 0.012 } = {}) {
  const used = new Set(); let hit = 0; const pairs = [];
  for (const t of truth) {
    const i = fields.findIndex((f, k) => !used.has(k) && f.page === t.page && f.type === t.type && f.x + f.w / 2 >= t.x - tol && f.x + f.w / 2 <= t.x + t.w + tol && f.y + f.h / 2 >= t.y - tol && f.y + f.h / 2 <= t.y + t.h + tol);
    if (i >= 0) { used.add(i); hit += 1; pairs.push([t, fields[i]]); }
  }
  const map = new Map(); let rolesOk = 0, rolesN = 0;
  for (const [t, f] of pairs) if (t.role) { rolesN += 1; const m = map.get(f.role); if (m === undefined) { map.set(f.role, t.role); rolesOk += 1; } else if (m === t.role) rolesOk += 1; }
  const injective = new Set(map.values()).size === map.size;
  return { truth: truth.length, found: fields.length, hit, recall: truth.length ? hit / truth.length : 1, precision: fields.length ? used.size / fields.length : 1, roles: rolesN ? (injective ? rolesOk / rolesN : 0) : 1 };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  fs.mkdirSync(process.argv[2], { recursive: true });
  for (const n of FIXTURE_NAMES) { const r = await buildFixture(n); fs.writeFileSync(path.join(process.argv[2], `${r.name}.pdf`), r.bytes); fs.writeFileSync(path.join(process.argv[2], `${r.name}.truth.json`), JSON.stringify({ truth: r.truth, expect: r.expect }, null, 1)); console.log(r.name, r.truth.length); }
}
