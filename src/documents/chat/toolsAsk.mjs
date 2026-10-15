// THE ASK TOOL (FINAL PUSH Stage 3, report §14.3): the assistant asks the person 1–4 short questions as clickable cards (2–4 options each, an "Other" box is always there, one option may be recommended).
// It only SHOWS the card. The turn ends; the answers come back as the person's next message ("Question → Answer" lines), so nothing is held open across requests and a resumed chat shows the same card.
import { OBJ, STR, done, refuse } from "./toolkit.mjs";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/** → { ok, questions } | { ok:false, error }. Pure. */
export function cleanQuestions(input) {
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  if (qs.length < 1 || qs.length > 4) return { ok: false, error: "Ask between 1 and 4 questions at a time." };
  const out = [];
  for (const [i, q] of qs.entries()) {
    const question = clip(q?.question, 200); if (!question) return { ok: false, error: `Question ${i + 1} has no words.` };
    const opts = Array.isArray(q?.options) ? q.options : [];
    if (opts.length < 2 || opts.length > 4) return { ok: false, error: `Question ${i + 1} needs 2 to 4 options (the person can always type their own).` };
    const options = opts.map((o) => ({ label: clip(o?.label, 60), description: clip(o?.description, 140), ...(o?.recommended === true ? { recommended: true } : {}) }));
    if (options.some((o) => !o.label)) return { ok: false, error: `Question ${i + 1} has an option with no label.` };
    if (new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) return { ok: false, error: `Question ${i + 1} repeats an option.` };
    let seenRec = false; for (const o of options) { if (o.recommended) { if (seenRec && q?.multiSelect !== true) delete o.recommended; seenRec = true; } }
    out.push({ question, header: clip(q?.header, 24) || null, multiSelect: q?.multiSelect === true, options });
  }
  return { ok: true, questions: out };
}
/** The person's choices as the text of their next message. */
export function answersText(questions, answers) {
  return questions.map((q, i) => { const a = answers?.[i]; const v = Array.isArray(a) ? a.filter(Boolean).join(", ") : String(a ?? "").trim(); return `${q.question} → ${v || "(no answer)"}`; }).join("\n");
}

export const ASK_TOOLS = [
  { name: "docustay.ask.questions", kind: "ask", permission: null, step: "Asking you a question",
    description: "Ask the person 1 to 4 short questions as clickable cards, and STOP. Use it only for a choice that changes the document and that the prompt, the workspace profile or an earlier answer does not already give. Each question has 2 to 4 options (a short label and a one-line description); mark at most one as recommended; set multiSelect when several can apply. The person can always type their own answer, so never add an 'Other' option. After calling it, write at most one short sentence and wait: their answers arrive as their next message.",
    input_schema: OBJ({ questions: { type: "array", minItems: 1, maxItems: 4, items: OBJ({ question: STR("the question, one sentence", { maxLength: 200 }), header: STR("a one or two word tag", { maxLength: 24 }), multiSelect: { type: "boolean" }, options: { type: "array", minItems: 2, maxItems: 4, items: OBJ({ label: STR("1 to 5 words", { maxLength: 60 }), description: STR("one line on what choosing it means", { maxLength: 140 }), recommended: { type: "boolean" } }, ["label"]) } }, ["question", "options"]) } }, ["questions"]),
    run: async (_ctx, input) => {
      const c = cleanQuestions(input); if (!c.ok) return refuse(c.error);
      return done({ shown: true, note: "The person sees the questions as cards. Stop and wait for their answers." }, { ask: true, proposal: { kind: "questions", summary: c.questions[0].question, card: { questions: c.questions } } });
    } },
];
