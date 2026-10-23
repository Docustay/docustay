// PDF FIELD DETECTION (PDF-FIELD-DETECTION-SPEC §4–§7): the words, the picture, the twelve synthetic fixtures scored against their ground truth, the packet split, the hostile files, the cache and the time limit.
// Every "found" assertion has a paired control: a page with nothing to find finds nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, PDFName, PDFString, PDFDict } from "@cantoo/pdf-lib";
import { classifyLabel, roleOf } from "../src/documents/detect/labels.mjs";
import { analyse } from "../src/documents/detect/geometry.mjs";
import { detectFields } from "../src/documents/detect/engine.mjs";
import { detect, clearDetectionCache } from "../src/documents/detect/index.mjs";
import { ocrWords, stopOcr } from "../src/documents/detect/ocr.mjs";
import { suggestionsFrom } from "../src/documents/detect/toBody.mjs";
import { parsePdfBodyData } from "../src/documents/pdfBody.mjs";
import { stripActiveContent, inspectPdf } from "../src/documents/pdfProcess.mjs";
import { locateTags } from "../src/documents/textTagPlacement.mjs";
import { FIXTURE_NAMES, HELD_OUT_NAMES, buildFixture, buildHeldOut, score } from "../scripts/detect/fixtures.mjs";

test.after(async () => { await stopOcr(); });

test("labels: what a printed word asks for, in several languages, and what it does not", () => {
  const t = (s) => classifyLabel(s)?.type ?? null;
  assert.equal(t("Participant Signature:"), "signature"); assert.equal(t("Initial here"), "initials"); assert.equal(t("Date:"), "date_signed"); assert.equal(t("Print Name"), "text");
  assert.equal(t("Unterschrift Zeuge"), "signature"); assert.equal(t("Firma del participante"), "signature"); assert.equal(t("Fecha"), "date_signed"); assert.equal(t("التوقيع"), "signature");
  assert.equal(classifyLabel("Date of Birth").type, "text", "a birth date is typed, not the date of signing"); assert.equal(classifyLabel("SSN").sensitive, true); assert.equal(classifyLabel("Client Email").format, "email");
  // controls: ordinary words are not labels, and a short word is not found inside a longer one
  assert.equal(t("Update notes"), null); assert.equal(t("Hotel"), null); assert.equal(t("Thank you for your business"), null);
  assert.equal(roleOf("Witness Signature"), "witness"); assert.equal(roleOf("Case Manager Signature"), "case_manager"); assert.equal(roleOf("Parent/Guardian"), "guardian"); assert.equal(roleOf("Date:"), null);
});

function raster(w, h, draw) { const rgba = new Uint8ClampedArray(w * h * 4).fill(255); const px = (x, y, r = 0, g = 0, b = 0) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; }; draw(px); return { w, h, rgba }; }
test("geometry: a line, a box, a tick box and a yellow bar are found; a blank page and a letter-like shape are not", () => {
  const r = analyse(raster(1275, 1650, (p) => {
    for (let x = 100; x < 400; x += 1) { p(x, 200); p(x, 201); }                                   // an underline
    for (let k = 0; k < 26; k += 1) { p(100 + k, 400); p(100 + k, 425); p(100, 400 + k); p(125, 400 + k); p(101 + k, 401); p(101 + k, 424); p(101, 401 + k); p(124, 401 + k); }   // a tick box
    for (let x = 100; x < 400; x += 1) for (let y = 600; y < 618; y += 1) p(x, y, 255, 236, 50);   // a yellow bar
  }));
  assert.equal(r.lines.length, 1); assert.ok(r.lines[0].w > 280); assert.equal(r.checks.length, 1); assert.equal(r.bars.length, 1);
  const none = analyse(raster(1275, 1650, () => {}));
  assert.deepEqual([none.lines.length, none.cells.length, none.checks.length, none.bars.length], [0, 0, 0, 0]);
  // a filled disc and a C-shaped stroke are not tick boxes
  const odd = analyse(raster(1275, 1650, (p) => { for (let y = -12; y <= 12; y += 1) for (let x = -12; x <= 12; x += 1) if (x * x + y * y <= 144) p(300 + x, 300 + y); for (let k = 0; k < 26; k += 1) { p(500 + k, 500); p(500 + k, 525); p(500, 500 + k); } }));
  assert.equal(odd.checks.length, 0, "a disc and a C are not boxes");
});

const camel = (s) => s;
const RESULTS = new Map();
async function run(name) { if (!RESULTS.has(name)) { const fx = await buildFixture(name); RESULTS.set(name, { fx, r: await detectFields(fx.bytes, { ocr: ocrWords }) }); } return RESULTS.get(name); }

for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}: boxes land on the truth with the right type and the right people`, async () => {
    const { fx, r } = await run(name), s = score(fx.truth, r.fields);
    if (fx.truth.length) { assert.ok(s.recall >= 0.85, `${fx.name}: recall ${(s.recall * 100).toFixed(0)}% (${s.hit}/${s.truth})`); assert.ok(s.precision >= 0.8, `${fx.name}: precision ${(s.precision * 100).toFixed(0)}% (${s.found} found)`); assert.ok(s.roles >= 0.99, `${fx.name}: roles ${s.roles}`); }
    else assert.equal(r.fields.length, 0, `${fx.name}: nothing to find, nothing found`);
    if (fx.expect.signers) assert.equal(r.roles.length, fx.expect.signers, "signers");
    if (fx.expect.native) assert.equal(r.fields.filter((f) => f.source === "native").length, fx.expect.native);
    if (fx.expect.referencePages) for (const p of fx.expect.referencePages) assert.equal(r.pages.find((x) => x.page === p).kind, "reference", `page ${p} is a reference page`);
    if (fx.expect.documents) assert.deepEqual(r.documents.map((d) => d.kind), fx.expect.documents, "the packet is split into forms and reference pages");
    if (fx.expect.scanned) assert.ok(r.pages[0].scanned, "read as a picture");
  });
}
test("fixtures: overall recall and precision across all twelve", async () => {
  let T = 0, H = 0, F = 0, U = 0;
  for (const n of FIXTURE_NAMES) { const { fx, r } = await run(n), s = score(fx.truth, r.fields); T += s.truth; H += s.hit; F += s.found; U += Math.round(s.precision * s.found); }
  console.log(`# detection: recall ${(H / T * 100).toFixed(1)}% precision ${(U / F * 100).toFixed(1)}% over ${T} truth boxes`);
  assert.ok(H / T >= 0.95, "overall recall"); assert.ok(U / F >= 0.9, "overall precision");
});
test("fixture yes-no: tick boxes that answer one question are one single-choice group", async () => {
  const { r } = await run("yesNo"); const groups = new Set(r.fields.filter((f) => f.group).map((f) => f.group));
  assert.ok(groups.size >= 2, `groups: ${groups.size}`); for (const g of groups) assert.equal(r.fields.filter((f) => f.group === g).length, 2);
});
test("fixture text-tags: the tag path still reads them (layer 2 stays)", async () => {
  const { fx } = await run("textTags"); const found = await locateTags(fx.bytes);
  assert.equal(found.errors.length, 0); assert.equal(found.tags.length, fx.expect.tags);
});
test("fixture table-plan: a date column is typed in, a date beside a signature is filled by signing", async () => {
  const { r } = await run("tablePlan");
  assert.ok(r.fields.filter((f) => f.source === "table" && f.format === "date").every((f) => f.type === "text")); assert.ok(r.fields.some((f) => f.type === "date_signed" && f.source !== "table"));
});

test("control: a page of plain paragraphs has no fields and is a reference page", async () => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), p = doc.addPage([612, 792]);
  for (let i = 0; i < 30; i += 1) p.drawText(`This is line ${i} of running text that mentions a name, a date and a signature in a sentence.`, { x: 60, y: 740 - i * 20, size: 10, font });
  const r = await detectFields(await doc.save());
  assert.equal(r.fields.length, 0); assert.equal(r.pages[0].kind, "reference");
});

test("the result fits the draft's own shape: roles and suggestions pass the body schema", async () => {
  const { r } = await run("consentHighlight"), out = suggestionsFrom(r);
  const body = { kind: "pdf", schema_version: 1, file: { file_id: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64), page_count: 1, pages: [{ w: 612, h: 792 }], name: "x.pdf" }, roles: out.roles, fields: [], suggestions: out.suggestions };
  assert.doesNotThrow(() => parsePdfBodyData(body)); assert.equal(out.note.signers, 3);
  assert.throws(() => parsePdfBodyData({ ...body, suggestions: [{ ...out.suggestions[0], role: "boss" }] }), "a role that is not a seat is refused");
});

test("hostile: scripts and embedded files are removed from the kept copy; a clean file is returned untouched", async () => {
  const doc = await PDFDocument.create(); doc.addPage([612, 792]);
  const js = doc.context.obj({ S: PDFName.of("JavaScript"), JS: PDFString.of("app.alert('x')") });
  doc.catalog.set(PDFName.of("OpenAction"), js);
  doc.catalog.set(PDFName.of("Names"), doc.context.obj({ EmbeddedFiles: doc.context.obj({ Names: [] }), JavaScript: doc.context.obj({ Names: [] }) }));
  const dirty = await doc.save(), r = await stripActiveContent(dirty);
  assert.ok(r.removed.includes("open action") && r.removed.includes("embedded files") && r.removed.includes("script"), r.removed.join());
  assert.doesNotMatch(Buffer.from(r.bytes).toString("latin1"), /app\.alert|\/OpenAction/); await inspectPdf(r.bytes);
  const clean = await (async () => { const d = await PDFDocument.create(); d.addPage([612, 792]); return d.save(); })();
  const c = await stripActiveContent(clean); assert.equal(c.bytes, clean); assert.deepEqual(c.removed, []);
});
test("hostile: a huge page is drawn at a capped size and a many-page file is read only to the page limit", async () => {
  const big = await PDFDocument.create(); big.addPage([14400, 14400]);
  const t = Date.now(); const r = await detectFields(await big.save()); assert.ok(Date.now() - t < 20000); assert.equal(r.fields.length, 0);
  const many = await PDFDocument.create(); for (let i = 0; i < 12; i += 1) many.addPage([200, 200]);
  const m = await detectFields(await many.save(), { maxPages: 5 }); assert.equal(m.summary.pagesRead, 5); assert.equal(m.summary.truncated, true);
});
test("the door: a second call on the same file is served from the cache; a time limit stops the work and reports it", async () => {
  clearDetectionCache(); const { fx } = await run("checklists");
  const a = await detect(fx.bytes, { ocr: false }); assert.equal(a.ok, true); assert.equal(a.cached, false);
  const b = await detect(fx.bytes, { ocr: false }); assert.equal(b.cached, true);
  const other = await buildFixture("consentHighlight"); const slow = await detect(other.bytes, { ocr: false, timeoutMs: 1 }); assert.equal(slow.ok, false); assert.equal(slow.reason, "timeout");
  const bad = await detect(new Uint8Array([1, 2, 3]), { ocr: false }); assert.equal(bad.ok, false, "garbage never throws into an upload");
});

for (const name of HELD_OUT_NAMES) {
  test(`held-out layout ${name}: written after the detector was tuned, not used to tune it`, async () => {
    const fx = await buildHeldOut(name), r = await detectFields(fx.bytes, { ocr: ocrWords }), s = score(fx.truth, r.fields);
    assert.ok(s.recall >= 0.9, `${fx.name}: recall ${(s.recall * 100).toFixed(0)}% (${s.hit}/${s.truth})`); assert.ok(s.precision >= 0.85, `${fx.name}: precision ${(s.precision * 100).toFixed(0)}%`); assert.ok(s.roles >= 0.99, `roles ${s.roles}`);
  });
}

import { promoteSuggestions } from "../src/documents/detect/promote.mjs";
import { detectUpload } from "../src/documents/detect/api.mjs";
test("promote: only the sure suggestions become fields, the unsure stay suggestions, ids never collide", async () => {
  const { r } = await run("scanUnderlines"), out = suggestionsFrom(r);
  const body = { kind: "pdf", schema_version: 1, file: { file_id: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64), page_count: 1, pages: [{ w: 612, h: 792 }], name: "x.pdf" }, roles: out.roles, fields: [], suggestions: [...out.suggestions, { ...out.suggestions[0], id: "weak", confidence: 0.3 }] };
  const p = promoteSuggestions(body, { minConfidence: 0.6 });
  assert.equal(p.placed, out.suggestions.length); assert.equal(p.left, 1); assert.equal(p.body.suggestions.length, 1); assert.equal(p.body.suggestions[0].id, "weak");
  assert.doesNotThrow(() => parsePdfBodyData(p.body), "the promoted body is a valid draft body");
  assert.equal(new Set(p.body.fields.map((f) => f.id)).size, p.body.fields.length);
  const none = promoteSuggestions(body, { minConfidence: 0.99 }); assert.equal(none.placed, 0, "control: nothing is placed when nothing is sure enough");
});
test("the detect-only call: a PDF gives fields; garbage and a Word file are refused in plain words", async () => {
  const fx = await buildFixture("consentHighlight"), r = await detectUpload({ bytes: Buffer.from(fx.bytes), fileName: "consent.pdf", ocr: false });
  assert.equal(r.summary.signers, 3); assert.ok(r.fields.every((f) => typeof f.uncertain === "boolean" && f.confidence > 0)); assert.ok(r.fields.some((f) => f.type === "signature" && f.confidence >= 0.9));
  await assert.rejects(() => detectUpload({ bytes: Buffer.from("not a pdf at all"), fileName: "x.pdf" }), /only accepts PDF files/i);
});

import { distance } from "../src/documents/detect/remember.mjs";
test("page hashes: the same fixture twice is the same form; different forms are not", async () => {
  const hashOf = async (name) => { const fx = await buildFixture(name); return (await detect(fx.bytes, { hashOnly: true, ocr: false })).result.pages[0].hash; };   // the fingerprint comes from the fingerprint-only call used at upload
  const a = await hashOf("checklists"), b = await hashOf("checklists"), c = await hashOf("tablePlan"), d = await hashOf("consentHighlight");
  assert.equal(distance(a, b), 0); assert.ok(distance(a, c) > 6, `checklists vs table ${distance(a, c)}`); assert.ok(distance(c, d) > 6, `table vs consent ${distance(c, d)}`);
});

import { validateTask1, validateTask2, validateCheck } from "../src/documents/detect/aiFindPure.mjs";
test("AI look: the model's answers are checked by plain code: numbers outside the list, bad types, a stray seat and a tick box turned into a signature are all ignored", () => {
  const cands = [{ n: 1, type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.03, label: "Name" }, { n: 2, type: "checkbox", x: 0.1, y: 0.3, w: 0.012, h: 0.012 }, { n: 3, type: "text", x: 0.1, y: 0.5, w: 0.3, h: 0.03 }];
  // task 1: only numbers from the list count; a non-form page keeps nothing even if it lists numbers
  assert.deepEqual(validateTask1({ form_page: true, keep: [1, 2, 99, "x", 2, -1, 1.5] }, 3), { form: true, keep: [1, 2] });
  assert.deepEqual(validateTask1({ form_page: false, keep: [1, 2] }, 3), { form: false, keep: [] }, "a page that is not a form keeps nothing");
  assert.equal(validateTask1({ keep: [1] }, 3), null, "no form_page flag: not usable"); assert.equal(validateTask1(null, 3), null);
  assert.deepEqual(validateTask1({ form_page: true, keep: [] }, 3), { form: false, keep: [] });
  // task 2: the type, label and person; unknown things fall back to the program's own
  const seats = new Set(["signer_1", "signer_2"]);
  const out = validateTask2({ boxes: [{ n: 1, type: "signature", label: "Tenant signature", role: "signer_2" }, { n: 2, type: "signature", label: "x", role: "signer_9" }, { n: 3, type: "launch_missiles", role: "Landlord" }, { n: 7, type: "text" }] }, cands, [1, 2, 3], seats);
  assert.equal(out.length, 3, "one entry per kept number, nothing for a number that was not kept");
  assert.deepEqual([out[0].type, out[0].label, out[0].roleKey], ["signature", "Tenant signature", "signer_2"]);
  assert.equal(out[1].type, "checkbox", "a small square stays a tick box whatever the model says"); assert.equal(out[1].roleKey, undefined); assert.equal(out[1].roleName, undefined, "an unknown seat key is not taken as a person's name");
  assert.equal(out[2].type, "text", "an unknown type falls back to the program's own"); assert.equal(out[2].roleName, "Landlord", "a name with no seat becomes a new person");
  assert.equal(validateTask2({ boxes: [{ n: 3, type: "checkbox" }] }, cands, [3], seats)[0].type, "text", "a wide box never turns into a tick box");
  // the second check can only drop what was kept
  assert.deepEqual(validateCheck({ wrong: [2, 5, "z"] }, [1, 2]), [2]); assert.deepEqual(validateCheck({ wrong: [] }, [1, 2]), [], "control: nothing wrong, nothing dropped");
});

import fs from "node:fs";
test("sensitive blanks: an SSN or date of birth is flagged, carried into the placed field, and no module reads signed values except signing and the sealed copy", async () => {
  const fx = await buildHeldOut("denseTwoColumn"), r = await detectFields(fx.bytes), ssn = r.fields.find((f) => /ssn/i.test(f.label ?? "")), dob = r.fields.find((f) => /birth/i.test(f.label ?? ""));
  assert.equal(ssn?.sensitive, true); assert.equal(dob?.sensitive, true); assert.ok(!r.fields.find((f) => /^name$/i.test(f.label ?? ""))?.sensitive, "control: a name is not sensitive");
  const out = suggestionsFrom(r), body = { kind: "pdf", schema_version: 1, file: { file_id: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64), page_count: 1, pages: [{ w: 612, h: 792 }], name: "x.pdf" }, roles: out.roles, fields: [], suggestions: out.suggestions };
  const placed = promoteSuggestions(body).body.fields.find((f) => /ssn/i.test(f.label ?? "")); assert.equal(placed.sensitive, true); assert.doesNotThrow(() => parsePdfBodyData(promoteSuggestions(body).body));
  const where = new Map();   // file name → folder: src/documents, and pro/documents where the closed add-on exists (the public export has none)
  for (const dir of ["src/documents", "pro/documents"]) if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith(".mjs") && /document_field_value/.test(fs.readFileSync(`${dir}/${f}`, "utf8"))) where.set(String(f), dir);
  const readers = [...where.keys()];
  // (Docustay v1: key dates and automations were removed, so only the archive and the signing step read a sensitive box)
  assert.deepEqual(readers.sort(), ["pdfArchive.mjs", "pdfSigning.mjs"], "a new reader of signed values must decide how to mask sensitive ones");
  // signing stores the values and the sealed copy prints them, by design; every OTHER reader must say what it does with a sensitive one
  for (const f of readers.filter((x) => !["pdfArchive.mjs", "pdfSigning.mjs"].includes(x))) assert.match(fs.readFileSync(`${where.get(f)}/${f}`, "utf8"), /\.sensitive\b/, `${f} reads signed values and does nothing about sensitive ones`);
});

test("checklists: 'Check only one' makes a single-choice group, and a sub-choice is named after the box it sits under", async () => {
  const { r } = await run("checklists"), boxes = r.fields.filter((f) => f.type === "checkbox");
  const weekly = boxes.find((f) => /weekly/i.test(f.label ?? "")), monthly = boxes.find((f) => /monthly/i.test(f.label ?? "")), every = boxes.find((f) => /every two/i.test(f.label ?? ""));
  assert.ok(weekly?.group && weekly.group === monthly?.group && weekly.group === every?.group, "the three frequency boxes are one group");
  assert.ok(boxes.some((f) => /^Housing needs › Shelter$/.test(f.label ?? "")), boxes.map((b) => b.label).join(" | "));
  assert.ok(!boxes.find((f) => /^Housing needs$/.test(f.label ?? ""))?.group, "control: a top-level box with no 'check one' line is not in a group");
});

test("the editor's helper module still exports everything the editor imports (a build, not svelte-check, is what catches a missing one)", async () => {
  const src = fs.readFileSync("docustay/web/src/lib/editor/FieldsStep.svelte", "utf8"), m = /import \{([^}]+)\} from "\.\/fields\.js"/.exec(src);
  const mod = await import("../docustay/web/src/lib/editor/fields.js");
  for (const n of m[1].split(",").map((x) => x.trim()).filter(Boolean)) assert.equal(typeof mod[n] !== "undefined", true, `fields.js must export ${n}`);
});
