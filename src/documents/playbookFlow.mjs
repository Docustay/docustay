// A PLAYBOOK'S FLOW (Run 9 Part 3.6, board "Playbook"; R9-a). Pure: no imports outside the island's own rule checker. The one shape the canvas edits, the server stores and the run follows:
//
//   { version: 1,
//     when:  { kind: "signed", templateId },                         — a document made from this template or form is signed by everyone
//     steps: [ { id, kind: "only_if", rule },                         — JSON Logic over that document's answers (box ids); anything else stops the run
//              { id, kind: "send", templateId, fill: { box: box } },  — send this template to the person who signed; each of its boxes named here is filled from that answer
//              { id, kind: "wait", days, unlessSigned },              — 1–60 days; with unlessSigned the run stops if what it sent is signed by then
//              { id, kind: "remind" },                                — remind the people still to sign what it sent
//              { id, kind: "notify" } ] }                             — tell the playbook's owner (the bell and an email)
//
// At most 12 steps. A step that needs a sent document (wait, remind) comes after a send. Checked here on save; the run re-reads the same flow, so a flow that passed this is the only kind that runs.
import { checkRule, RuleError } from "./rules.mjs";

const STEP_KINDS = Object.freeze(["only_if", "send", "wait", "remind", "notify"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** → { ok:true, flow } (normalised: only known keys kept) | { ok:false, errors:[{step, text}] }. `known` optionally checks box ids: { sourceBoxes:Set, targetBoxes:(templateId)=>Set|null }. */
export function checkFlow(raw, known = null) {
  const errors = []; const bad = (step, text, code, vars = {}) => errors.push({ step, text, code, vars });   // `code` + `vars`: the screen words it in the reader's language
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ step: null, text: "An automation's flow is an object with a when and steps.", code: "shape", vars: {} }] };
  const when = raw.when ?? {};
  if (when.kind !== "signed") bad("when", "Choose what starts it: a document from a template or form is signed.", "when_kind");
  if (!UUID.test(String(when.templateId ?? ""))) bad("when", "Choose the template or form whose signed documents start it.", "when_template");
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  if (!Array.isArray(raw.steps)) bad(null, "The steps are a list.", "shape");
  if (steps.length > 12) bad(null, "An automation has at most 12 steps.", "too_many");
  if (!steps.some((s) => s?.kind === "send")) bad(null, "Add a “Then send” step: an automation that sends nothing does nothing.", "no_send");
  const out = []; const ids = new Set(); let sent = false;
  steps.slice(0, 12).forEach((s, i) => {
    const n = i + 1;
    if (!s || typeof s !== "object") { bad(n, "This step is empty.", "unknown_step"); return; }
    const id = ID.test(String(s.id ?? "")) && !ids.has(s.id) ? s.id : `s${n}`; ids.add(id);
    if (!STEP_KINDS.includes(s.kind)) { bad(n, "This step is not one an automation can take.", "unknown_step"); return; }
    if (s.kind === "only_if") {
      let vars = []; try { vars = checkRule(s.rule); } catch (e) { bad(n, e instanceof RuleError ? `The condition: ${e.message}` : "The condition is not a rule.", "rule_bad"); return; }
      if (known?.sourceBoxes) for (const v of vars) if (!known.sourceBoxes.has(v)) bad(n, `The condition reads “${v}”, which is not a box on the starting template.`, "rule_box", { box: v });
      out.push({ id, kind: "only_if", rule: s.rule }); return;
    }
    if (s.kind === "send") {
      if (!UUID.test(String(s.templateId ?? ""))) { bad(n, "Choose the template to send.", "send_template"); return; }
      const fill = {}; const entries = Object.entries(s.fill && typeof s.fill === "object" ? s.fill : {});
      if (entries.length > 40) bad(n, "At most 40 boxes can be filled from answers.", "fill_many");
      for (const [to, from] of entries.slice(0, 40)) {
        if (!ID.test(to) || !ID.test(String(from))) { bad(n, "A filled box names a box that does not exist.", "fill_bad"); continue; }
        if (known?.sourceBoxes && !known.sourceBoxes.has(from)) bad(n, `“${from}” is not a box on the starting template.`, "fill_source", { box: from });
        const tb = known?.targetBoxes?.(s.templateId); if (tb && !tb.has(to)) bad(n, `“${to}” is not a box on the template it sends.`, "fill_target", { box: to });
        fill[to] = String(from);
      }
      sent = true; out.push({ id, kind: "send", templateId: s.templateId, fill }); return;
    }
    if (s.kind === "wait") {
      if (!sent) bad(n, "A wait comes after a “Then send” step: it waits for what was sent.", "wait_first");
      if (!(Number.isInteger(s.days) && s.days >= 1 && s.days <= 60)) bad(n, "Wait between 1 and 60 whole days.", "wait_days");
      out.push({ id, kind: "wait", days: Number.isInteger(s.days) ? Math.min(60, Math.max(1, s.days)) : 3, unlessSigned: s.unlessSigned !== false }); return;
    }
    if (s.kind === "remind") { if (!sent) bad(n, "A reminder comes after a “Then send” step.", "remind_first"); out.push({ id, kind: "remind" }); return; }
    out.push({ id, kind: "notify" });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, flow: { version: 1, when: { kind: "signed", templateId: when.templateId }, steps: out } };
}

/** The template ids a flow names (the starting one and every send), for the save to check they exist. Pure. */
export function templatesOf(flow) {
  return [...new Set([flow?.when?.templateId, ...(flow?.steps ?? []).filter((s) => s.kind === "send").map((s) => s.templateId)].filter((x) => UUID.test(String(x ?? ""))))];
}
