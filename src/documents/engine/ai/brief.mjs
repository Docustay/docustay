// THE SHARED DOCUMENT ENGINE — the wizard's BRIEF. The wizard (Docustay screen and the platform screen) asks questions BEFORE any model call and sends one structured brief; this file checks it
// against the shared question list (flowDefinition.mjs) and turns it into the one text the model reads. Pure.
import { cleanPayment, paymentPrompt } from "./payment.mjs";
import { WIZARD_UNIVERSAL, WIZARD_TYPES, WIZARD_FINAL_QUESTION, AGENT_KINDS } from "../../flowDefinition.mjs";

const MAX_ANSWER = 1200;
/** → { ok:true, text, type, kind } | { ok:false, error } . The error is one plain sentence naming the question. */
export function briefToPrompt(brief) {
  if (!brief || typeof brief !== "object") return { ok: false, error: "Answer the questions first." };
  const type = WIZARD_TYPES.find((t) => t.id === brief.type);
  if (!type) return { ok: false, error: "Choose what kind of document this is." };
  const kind = AGENT_KINDS.find((k) => k.id === (brief.kind ?? "plain"));
  if (!kind) return { ok: false, error: "Choose who should write it." };
  const answers = brief.answers && typeof brief.answers === "object" ? brief.answers : {};
  const lines = [`Document type: ${type.label}`];
  for (const q of [...WIZARD_UNIVERSAL, ...type.pack]) {
    const v = typeof answers[q.key] === "string" ? answers[q.key].trim() : "";
    if (v.length > MAX_ANSWER) return { ok: false, error: `Your answer to “${q.label}” is too long (${MAX_ANSWER} characters at most).` };
    if (q.required && !v) return { ok: false, error: `Answer this first: ${q.label}` };
    if (q.type === "choice" && v && !q.options.some((o) => o.value === v)) return { ok: false, error: `Pick one of the choices for “${q.label}”.` };
    if (v) lines.push(`${q.label} ${v}`);
  }
  const final = typeof brief.final === "string" ? brief.final.trim() : "";
  if (final.length < 10) return { ok: false, error: `Answer this first: ${WIZARD_FINAL_QUESTION.label}` };
  if (final.length > 2000) return { ok: false, error: "That last answer is too long (2000 characters at most)." };
  lines.push(`${WIZARD_FINAL_QUESTION.label} ${final}`);
  const pay = cleanPayment(brief.payment); if (!pay.ok) return { ok: false, error: pay.error };
  if (pay.payment) lines.push(paymentPrompt(pay.payment));
  return { ok: true, text: lines.join("\n"), type: type.id, kind: kind.id, payment: pay.payment };
}
