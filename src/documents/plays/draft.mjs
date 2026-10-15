// A DRAFT FROM A TEMPLATE, WITHOUT A MODEL (FINAL PUSH Stage 4, report §14.5 developer API; Run 9 Part 4R: from a library template, guided by the template's own guidance, not by a play):
// the guidance's must-ask questions come back as `needs_input` (each 2–4 options); once they are answered the draft is made from the built-in template's words. Nothing is sent, ever: a draft is a draft. A `draftRef` carries what has been answered so far — stateless, nothing is stored until the draft exists — and every call re-checks everything.
import { invalid, notFound } from "../../http/errors.mjs";
import { ports } from "../ports.mjs";
import { guidanceFor } from "../starters/guidance.mjs";
import { libraryEntry } from "../library.mjs";
import { flagNotes } from "./play.mjs";
import { readyMadeSource } from "../engine/creation.mjs";
import { apiCreateDocument, apiCheckSource } from "../pdfApiV2.mjs";
import { readPeople, playChoice } from "../chat/people.mjs";

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const dec = (s) => { try { const o = JSON.parse(Buffer.from(String(s), "base64url").toString("utf8")); return o && typeof o === "object" ? o : null; } catch { return null; } };
export const assertPlaysApi = async (tx, tenantId) => (await ports()).entitlements?.assertEntitled?.(tx, { tenantId, item: "plays_api" });

const shapeQ = (q) => ({ key: q.key, question: q.question, multiSelect: q.multiSelect, options: q.options.map((o) => ({ label: o.label, description: o.description || undefined, recommended: o.recommended || undefined })) });
const cleanAnswers = (play, raw) => {
  const out = {}; const by = new Map(play.questions.map((q) => [q.key, q]));
  for (const [k, v] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const q = by.get(k); if (!q) throw invalid(`“${k}” is not one of this template's questions.`, { field: `answers.${k}` });
    const vals = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? "").trim().slice(0, 200)).filter(Boolean);
    if (!vals.length) continue; if (!q.multiSelect && vals.length > 1) throw invalid(`“${q.question}” takes one answer.`, { field: `answers.${k}` });
    out[k] = q.multiSelect ? vals : vals[0];   // an answer outside the options is allowed: the person can always type their own
  }
  return out;
};

/** → { status:"needs_input", draftRef, questions } | { status:"draft", documentId, title, guidanceRef, notes } */
export async function startDraftFromTemplate(tx, { tenantId, ownerId, template: slug, title = null, people = [], answers = {}, useDefaults = false, test = false, draftRef = null }) {
  await assertPlaysApi(tx, tenantId);
  const prior = draftRef ? dec(draftRef) : null; if (draftRef && !prior) throw invalid("That draftRef is not valid.", { field: "draftRef" });
  const name = String(slug ?? prior?.template ?? ""); const e = libraryEntry(name);
  if (!e) throw notFound("There is no built-in template with that name.");
  if (e.kind !== "document") throw invalid("A Form template is published as a form, not drafted for named people. Use a Document template.", { field: "template" });
  const g = guidanceFor(name, "document"); const p = g?.guidance ?? { title: e.title, questions: [], defaults: {}, checklist: [], flags: [] };
  const merged = cleanAnswers(p, { ...(prior?.answers ?? {}), ...answers });
  const asked = p.questions.filter((q) => merged[q.key] === undefined && (q.mustAsk || !useDefaults));
  const peopleIn = people?.length ? people : (prior?.people ?? []); const titleIn = title ?? prior?.title ?? null;
  if (asked.length) return { status: "needs_input", draftRef: enc({ template: name, title: titleIn, people: peopleIn, answers: merged }), questions: asked.slice(0, 4).map(shapeQ), remaining: asked.length };
  const { people: ppl, errors } = readPeople(peopleIn, { test }); if (errors.length || !ppl.length) throw invalid(errors[0] ?? "Add at least one person who signs.", { field: "people" });
  const r = readyMadeSource({ slug: name }); const check = apiCheckSource({ source: r.source, people: ppl, requireSignature: true });
  if (!check.ok) throw invalid(`The document would not pass its checks: ${check.errors.slice(0, 3).join("; ")}`, { field: "people" });
  const choice = { ...playChoice(p.defaults), internalNote: `Made from the “${e.title}” template. ${p.questions.filter((q) => merged[q.key] !== undefined).map((q) => `${q.question} ${[].concat(merged[q.key]).join(", ")}.`).join(" ")}`.slice(0, 2000) };
  const docTitle = String(titleIn ?? e.title).trim().slice(0, 120) || e.title;
  const made = await apiCreateDocument(tx, { tenantId, ownerId, title: docTitle, source: r.source, people: ppl, sendChoice: choice, send: false, test });
  if (g) await tx.query(`UPDATE keystone.document_instance SET play_ref = $2 WHERE id = $1`, [made.id, g.ref]);
  return { status: "draft", documentId: made.id, title: docTitle, template: name, guidanceRef: g?.ref ?? null, answers: merged, notes: flagNotes(p).map((n) => ({ topic: n.topic, note: n.note })), checklist: p.checklist };
}
