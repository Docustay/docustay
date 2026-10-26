// SCRIBE AND AN UPLOADED PDF (PDF-FIELD-DETECTION-SPEC §5). Two tools: one LOOKS (runs the detector on the open draft's file and lists the boxes it found, free); one PROPOSES (a card the person accepts: which boxes to place, with the names, seats, required-ness and types the person asked for).
// The model never places a box itself: it chooses among the detector's own ids, plain code builds the fields, and nothing changes until the person presses Accept. Nothing here sends.
import { OBJ, STR, ID, EDIT, docIdOf, done, refuse } from "./toolkit.mjs";
import { parsePdfBodyData } from "../pdfBody.mjs";
import { readFileBytes } from "../files.mjs";
import { detect } from "../detect/index.mjs";
import { suggestionsFrom } from "../detect/toBody.mjs";
import { promoteSuggestions } from "../detect/promote.mjs";

const TYPES = ["signature", "initials", "date_signed", "text", "checkbox", "dropdown"];

async function draftAndDetection(ctx, input) {
  const id = docIdOf(ctx, input); if (!id) return { error: "No saved PDF draft is open. Ask the person to open the document first." };
  const { rows: [i] } = await ctx.db.query(`SELECT title, state, template_body_snapshot FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [id]);
  if (!i) return { error: "That is not a PDF draft." };
  if (i.state !== "draft") return { error: `That document is ${i.state}, so its boxes can no longer be changed.` };
  let body; try { body = parsePdfBodyData(i.template_body_snapshot ?? {}); } catch { return { error: "That draft has no readable pages." }; }
  const { bytes } = await readFileBytes(ctx.db, { fileId: body.file.file_id });
  const r = await detect(bytes, { timeoutMs: 45_000 });
  if (!r.ok) return { error: r.reason === "timeout" ? "That file took too long to read." : "That file could not be read for boxes." };
  return { id, title: i.title, body, out: suggestionsFrom(r.result), result: r.result };
}
const brief = (f) => ({ id: f.id, type: f.type, page: f.page, label: f.label ?? null, role: f.role, confidence: f.confidence, ...(f.sensitive ? { sensitive: true } : {}), ...(f.group ? { group: f.group } : {}) });

export const PDF_TOOLS = [
  { name: "docustay.pdf.detect_fields", kind: "read", permission: EDIT, step: "Looking at the pages",
    description: "Look at the PDF of the open draft and list the boxes a person would place on it: signatures, initials, dates, text blanks and tick boxes, each with an id, its page, the label printed beside it, which signer it seems to belong to and how sure the program is (0 to 1). Also lists the signers it found, and which pages are forms and which are reference pages. Free; changes nothing. Use the ids with docustay.pdf.propose_fields.",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => {
      const d = await draftAndDetection(ctx, input); if (d.error) return refuse(d.error);
      return done({ fields: d.out.suggestions.slice(0, 120).map(brief), signers: d.out.roles, pages: d.out.note.pages.slice(0, 100), documents: d.out.note.documents, more: Math.max(0, d.out.suggestions.length - 120), alreadyPlaced: d.body.fields.length });
    } },
  { name: "docustay.pdf.propose_fields", kind: "proposal", permission: EDIT, step: "Preparing the boxes", needs: "edit",
    description: "Propose which of the detected boxes to place on the open PDF draft, with changes the person asked for. `place` is 'confident' (the sure ones, default) or 'all'. `changes` adjusts boxes by the ids from docustay.pdf.detect_fields: rename (label), change type, move to another signer (role = a seat key from `signers`), mark required or optional, or drop. `seats` renames a signer (key + label). Nothing changes until the person accepts. Never invent ids.",
    input_schema: OBJ({
      documentId: ID(), summary: STR("one plain sentence on what this does", { maxLength: 300 }), place: { type: "string", enum: ["confident", "all"] },
      changes: { type: "array", maxItems: 120, items: OBJ({ id: STR("a box id from docustay.pdf.detect_fields"), label: STR("the box's name", { maxLength: 80 }), type: { type: "string", enum: TYPES }, role: STR("a seat key such as signer_2"), required: { type: "boolean" }, drop: { type: "boolean" } }, ["id"]) },
      seats: { type: "array", maxItems: 20, items: OBJ({ key: STR("a seat key such as signer_1"), label: STR("what to call the person, such as Tenant", { maxLength: 80 }) }, ["key", "label"]) },
    }, ["summary"]),
    run: async (ctx, input) => {
      const d = await draftAndDetection(ctx, input); if (d.error) return refuse(d.error);
      const seats = new Set(d.out.roles.map((r) => r.key)), byId = new Map(d.out.suggestions.map((s) => [s.id, { ...s }])), notes = [];
      for (const c of Array.isArray(input?.changes) ? input.changes : []) {
        const s = byId.get(String(c?.id)); if (!s) { notes.push(`There is no box ${String(c?.id).slice(0, 20)}.`); continue; }
        if (c.drop === true) { byId.delete(s.id); continue; }
        if (typeof c.label === "string" && c.label.trim()) s.label = c.label.trim().slice(0, 80);
        if (TYPES.includes(c.type)) s.type = c.type;
        if (typeof c.role === "string") { if (seats.has(c.role)) s.role = c.role; else notes.push(`There is no seat ${c.role.slice(0, 20)}.`); }
        if (typeof c.required === "boolean") s.required = c.required;
        s.confidence = Math.max(s.confidence ?? 0, 0.95);                      // the person asked for this one by name
      }
      const roles = d.out.roles.map((r) => { const o = (Array.isArray(input?.seats) ? input.seats : []).find((x) => x?.key === r.key && typeof x.label === "string" && x.label.trim()); return o ? { ...r, label: o.label.trim().slice(0, 80) } : r; });
      const draft = { ...d.body, roles, fields: [], suggestions: [...byId.values()] };
      const p = promoteSuggestions(draft, { minConfidence: input?.place === "all" ? 0 : 0.6 });
      const fields = p.body.fields.map((f) => { const s = byId.get(f.id.replace(/^f_/, "")); return s?.required === false ? { ...f, required: false } : f; });
      if (!fields.length) return done({ proposed: false, note: "None of the boxes would be placed. Say which ones to place, or use place: all." });
      const perSeat = roles.map((r) => `${r.label}: ${fields.filter((f) => f.role === r.key).length}`).join(", ");
      return { proposal: { kind: "pdf_fields", summary: String(input?.summary ?? `Place ${fields.length} boxes`).slice(0, 300), documentId: d.id, payload: { fields, roles }, card: { title: d.title, lines: [{ label: "Boxes", value: `${fields.length} placed, ${p.left} left as suggestions` }, { label: "People", value: perSeat }] } },
        result: { proposed: true, count: fields.length, notes: notes.slice(0, 5) } };
    } },
];
