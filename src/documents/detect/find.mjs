// PDF FIELD DETECTION · "FIND FIELDS" ON A DRAFT (the button in the editor). Nothing is guessed at upload; the person asks, this runs the detector on the draft's file and puts the result back as the draft's SUGGESTIONS (nothing is placed until they accept).
// Fields the person has already placed are never touched, and suggestions that land on a placed field are dropped. No AI here: the opt-in AI pass is detect/ai.mjs.
import { conflict, notFound } from "../../http/errors.mjs";
import { parsePdfBodyData } from "../pdfBody.mjs";
import { readFileBytes } from "../files.mjs";
import { detect } from "./index.mjs";
import { suggestionsFrom } from "./toBody.mjs";

const inside = (f, s) => { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; return f.page === s.page && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h; };

export async function findFieldsOnDraft(tx, { instanceId }) {
  const { rows: [i] } = await tx.query(`SELECT state, template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (!i) throw notFound("no such document");
  if (i.state !== "draft") throw conflict("Only a draft can be searched for fields.", { code: "not_draft" });
  const body = parsePdfBodyData(i.template_body_snapshot ?? {});
  const { bytes } = await readFileBytes(tx, { fileId: body.file.file_id });
  const r = await detect(bytes, { timeoutMs: 45_000 });
  if (!r.ok) throw conflict(r.reason === "timeout" ? "That file took too long to read." : "That file could not be read for fields.", { code: "detect_failed" });
  const out = suggestionsFrom(structuredClone(r.result));
  const suggestions = out.suggestions.filter((s) => !body.fields.some((f) => inside(f, s)));
  const have = new Set(body.roles.map((x) => x.key)), roles = [...body.roles, ...out.roles.filter((x) => !have.has(x.key))];
  const next = { ...body, roles, ...(suggestions.length ? { suggestions } : {}), detect: { pages: out.note.pages, documents: out.note.documents, ...(out.note.truncated ? { truncated: true } : {}) } };
  if (!suggestions.length) delete next.suggestions;
  parsePdfBodyData(next);
  await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, updated_at = now() WHERE id = $1`, [instanceId, JSON.stringify(next)]);
  return { suggestions, roles, note: { ...out.note, fields: suggestions.length } };
}
