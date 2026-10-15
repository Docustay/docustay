// A AUTOMATION'S FLOW ON THE SCREEN (Run 9 Part 3.6, board "Automation"). Pure: the canvas's nodes and wires, each step said in words, the simple "Only if" rules a person builds
// by choosing (a box, is / is not / is ticked, a value) and reading such a rule back. The server checks the flow again (src/documents/playbookFlow.mjs); nothing here is trusted.
import { t } from "$lib/i18n/index.svelte.js";

export const KINDS = ["only_if", "send", "wait", "remind", "notify"];
const COL_X = 0, WIRE = 44;   // the board's 44px wire between cards
// a card's height, from what it says (16px padding twice, the 11px kind line, the title in 16px lines of about 36 characters at 340px, the 12px second line, a problem line)
const cardHeight = (d) => 32 + 16 + 4 + 22 * Math.max(1, Math.ceil(String(d.title ?? "").length / 36)) + (d.sub ? 4 + 18 * Math.ceil(String(d.sub).length / 52) : 0) + (d.problem ? 6 + 18 * Math.ceil(String(d.problem).length / 52) : 0);
let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
export const blankFlow = () => ({ version: 1, when: { kind: "signed", templateId: "" }, steps: [] });
export function blankStep(kind) {
  if (kind === "only_if") return { id: newId(), kind, rule: null };
  if (kind === "send") return { id: newId(), kind, templateId: "", fill: {} };
  if (kind === "wait") return { id: newId(), kind, days: 3, unlessSigned: true };
  return { id: newId(), kind };
}

/** The label above each card, as the board writes it. */
export const kindLabel = (kind) => ({ when: t("Starts when"), only_if: t("Only if"), send: t("Then send"), wait: t("Wait"), remind: t("Then remind"), notify: t("Then tell me") })[kind] ?? kind;
/** What the "+" menu offers. */
export const addLabel = (kind) => ({ only_if: t("Only if…"), send: t("Then send a template"), wait: t("Wait"), remind: t("Remind the people still to sign"), notify: t("Tell me") })[kind] ?? kind;

/** A rule built by choosing: {box, op: "is" | "is_not" | "ticked" | "not_ticked", value}. → JSON Logic, or null when it is not finished. */
export function ruleFrom({ box, op, value }) {
  if (!box) return null;
  if (op === "ticked") return { "==": [{ var: box }, true] };
  if (op === "not_ticked") return { "==": [{ var: box }, false] };
  if (value == null || String(value).trim() === "") return null;
  return { [op === "is_not" ? "!=" : "=="]: [{ var: box }, String(value)] };
}
/** The other way: a rule this screen made → its parts; any other rule (made by Scribe or the API) → null, and the screen says "a condition" and keeps it as it is. */
export function ruleParts(rule) {
  if (!rule || typeof rule !== "object") return null;
  const [op] = Object.keys(rule); const args = rule[op];
  if (Object.keys(rule).length !== 1 || !Array.isArray(args) || args.length !== 2 || !args[0] || typeof args[0] !== "object" || typeof args[0].var !== "string") return null;
  const v = args[1];
  if (op === "==" && v === true) return { box: args[0].var, op: "ticked", value: "" };
  if (op === "==" && v === false) return { box: args[0].var, op: "not_ticked", value: "" };
  if ((op === "==" || op === "!=") && (typeof v === "string" || typeof v === "number")) return { box: args[0].var, op: op === "==" ? "is" : "is_not", value: String(v) };
  return null;
}

const nameOf = (templates, id) => templates.find((x) => x.id === id)?.name ?? null;
const boxLabel = (tpl, id) => tpl?.boxes?.find((b) => b.id === id)?.label ?? id;

/** Each card's main line and its smaller second line, in words. */
export function stepWords(step, { flow, templates }) {
  const src = templates.find((x) => x.id === flow.when.templateId);
  if (step.kind === "when") {
    const name = nameOf(templates, flow.when.templateId);
    if (!name) return { title: t("Choose the template or form that starts it"), sub: "", empty: true };
    return { title: src?.kind === "form" ? t("A response to “{name}” is signed", { name }) : t("A document from “{name}” is signed", { name }), sub: "" };
  }
  if (step.kind === "only_if") {
    const p = ruleParts(step.rule);
    if (!step.rule) return { title: t("Choose a condition"), sub: "", empty: true };
    if (!p) return { title: t("A condition"), sub: t("Made outside this screen; it is kept as it is.") };
    const label = boxLabel(src, p.box);
    const title = p.op === "ticked" ? t("“{box}” is ticked", { box: label }) : p.op === "not_ticked" ? t("“{box}” is not ticked", { box: label }) : p.op === "is_not" ? t("“{box}” is not “{value}”", { box: label, value: p.value }) : t("“{box}” is “{value}”", { box: label, value: p.value });
    return { title, sub: "" };
  }
  if (step.kind === "send") {
    const name = nameOf(templates, step.templateId);
    if (!name) return { title: t("Choose the template to send"), sub: "", empty: true };
    const n = Object.keys(step.fill ?? {}).length;
    return { title: t("“{name}” to the person who signed", { name }), sub: n ? t("{n, plural, one {Their answers fill # box} other {Their answers fill # boxes}}", { n }) : t("Nothing is filled in from their answers") };
  }
  if (step.kind === "wait") return { title: step.unlessSigned ? t("{n, plural, one {# day, if not signed} other {# days, if not signed}}", { n: step.days }) : t("{n, plural, one {# day} other {# days}}", { n: step.days }), sub: step.unlessSigned ? t("If it is signed by then, the automation stops here.") : "" };
  if (step.kind === "remind") return { title: t("Send a reminder"), sub: t("To the people still to sign what it sent.") };
  return { title: t("Tell me"), sub: t("In the bell and by email.") };
}

/** The canvas: one column, top to bottom — When, then each step — joined by wires. `selected` is the card being edited, `problems` the server's {step, text} list. */
export function canvas(flow, { templates, selected, problems = [], add = null }) {
  const cards = [{ id: "when", kind: "when" }, ...flow.steps];
  const bad = new Map(problems.map((p) => [p.step === "when" ? "when" : typeof p.step === "number" ? flow.steps[p.step - 1]?.id : null, p.text]));
  let y = 0;
  const nodes = cards.map((s, i) => {
    const data = { kind: s.kind, label: kindLabel(s.kind), ...stepWords(s, { flow, templates }), selected: s.id === selected, problem: bad.get(s.id) ?? null, index: i };
    const node = { id: s.id, type: "step", position: { x: COL_X, y }, draggable: false, connectable: false, deletable: false, selectable: true, data };
    y += cardHeight(data) + WIRE; return node;
  });
  const edges = cards.slice(1).map((s, i) => ({ id: `w-${cards[i].id}-${s.id}`, source: cards[i].id, target: s.id, type: "straight", animated: true, selectable: false, focusable: false }));
  // the "+" sits under the last card, on the canvas (it pans and zooms with the cards); `add` carries its menu's state and actions
  if (add) {
    const last = cards[cards.length - 1];
    nodes.push({ id: "add", type: "add", position: { x: COL_X, y: y - WIRE + 18 }, draggable: false, connectable: false, deletable: false, selectable: false, focusable: false,
      data: { open: add.open, ontoggle: add.ontoggle, onadd: add.onadd, kinds: KINDS.map((k) => ({ kind: k, label: addLabel(k) })) } });
    edges.push({ id: `w-${last.id}-add`, source: last.id, target: "add", type: "straight", animated: false, selectable: false, focusable: false, style: "stroke-dasharray: 2 6; opacity: .6" });
  }
  return { nodes, edges };
}

/** A run's log line in the reader's language (the server sends `code` + `vars`; its English `text` is the fallback for a code this screen does not know). */
export function logLine(l) {
  const v = l.vars ?? {};
  switch (l.code) {
    case "started": return t("Started: “{title}” was signed.", { title: v.title ?? "" });
    case "not_pro": return t("Not run: an automation is part of Pro.");
    case "switched_off": return t("Stopped: the automation was switched off.");
    case "unmet": return t("Stopped: the condition was not met.");
    case "met": return t("The condition was met.");
    case "would_send": return t("{n, plural, one {Would send “{template}” to {to}, filling # box from their answers.} other {Would send “{template}” to {to}, filling # boxes from their answers.}}", { n: v.n ?? 0, template: v.template ?? "", to: v.to ?? "" });
    case "would_send_signer": return t("{n, plural, one {Would send “{template}” to the person who signed, filling # box from their answers.} other {Would send “{template}” to the person who signed, filling # boxes from their answers.}}", { n: v.n ?? 0, template: v.template ?? "" });
    case "sent": return t("{n, plural, one {Sent “{template}” to {to}, # box filled from their answers.} other {Sent “{template}” to {to}, # boxes filled from their answers.}}", { n: v.n ?? 0, template: v.template ?? "", to: v.to ?? "" });
    case "would_wait": return t("{n, plural, one {Would wait # day.} other {Would wait # days.}}", { n: v.n ?? 1 });
    case "would_wait_unless": return t("{n, plural, one {Would wait # day, and stop there if it is signed by then.} other {Would wait # days, and stop there if it is signed by then.}}", { n: v.n ?? 1 });
    case "waiting": return t("{n, plural, one {Waiting # day.} other {Waiting # days.}}", { n: v.n ?? 1 });
    case "signed_in_time": return t("Done: it was signed before the wait ended.");
    case "wait_over": return t("The wait is over; it is not signed yet.");
    case "would_remind": return t("Would remind the people still to sign it.");
    case "reminded": return t("{n, plural, one {# reminder sent.} other {# reminders sent.}}", { n: v.n ?? 0 });
    case "no_reminder": return t("No reminder: nobody is waiting to sign it.");
    case "would_notify": return t("Would tell you, in the bell and by email.");
    case "notified": return t("You were told.");
    case "finished": return t("Finished.");
    case "error": return t("It could not go on: {why}", { why: v.why ?? "" });
    default: return l.text ?? "";
  }
}
export const runStatus = (s) => ({ running: t("Running"), waiting: t("Waiting"), due: t("Waiting"), done: t("Done"), stopped: t("Stopped"), failed: t("Could not go on") })[s] ?? s;
