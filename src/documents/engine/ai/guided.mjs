// THE SHARED DOCUMENT ENGINE — guided assembly, NO MODEL. A short question flow assembles a document from a small library of plain-language sections written for this
// service. It needs no key, never leaves the server, and is what the screen offers when AI is off, limited or down. Pure.
// The questions are data (`GUIDED_QUESTIONS`) so both screens draw the same form; `assembleGuided` turns the answers into a source and a list of things to check.
const GUIDED_KINDS = Object.freeze([
  { value: "agreement", label: "An agreement between two or more people" },
  { value: "nda", label: "A confidentiality agreement (NDA)" },
  { value: "consent", label: "A consent or permission form" },
  { value: "waiver", label: "A waiver or acknowledgement of risk" },
  { value: "notice", label: "A notice or letter someone signs to confirm" },
]);

export const GUIDED_QUESTIONS = Object.freeze([
  { key: "kind", type: "choice", label: "What is it?", options: GUIDED_KINDS, required: true },
  { key: "title", type: "text", label: "What should it be called?", placeholder: "Services agreement", required: true, max: 80 },
  { key: "roles", type: "list", label: "Who signs? Add each person's role", placeholder: "Provider", required: true, max: 6 },
  { key: "subject", type: "text", label: "What is it about, in a few words?", placeholder: "monthly bookkeeping", required: false, max: 160 },
  { key: "money", type: "choice", label: "Does money change hands?", options: [{ value: "none", label: "No" }, { value: "once", label: "Yes, once" }, { value: "recurring", label: "Yes, on a schedule" }], required: true },
  { key: "term", type: "text", label: "How long does it last? Leave empty for until someone ends it", placeholder: "12 months", required: false, max: 60 },
  { key: "notice_days", type: "number", label: "How many days' notice to end it?", required: false, min: 0, max: 365, choices: [{ value: 0, label: "No notice" }, ...[7, 14, 30, 60, 90].map((n) => ({ value: n, label: `${n} days` }))] },
  { key: "confidential", type: "bool", label: "Should what is shared stay private?", required: false },
  { key: "law", type: "text", label: "Which state or country's law applies? Leave empty to skip", placeholder: "California", required: false, max: 80 },
]);

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "party";
const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const p = (...c) => ({ type: "paragraph", content: c });
const h = (text) => ({ type: "heading", attrs: { level: 2 }, content: [t(text)] });
const tag = (name, type, role, extra = {}) => ({ type: "fieldTag", attrs: { name, type, role, ...extra } });

/** @returns {{ ok:boolean, errors:string[], title?:string, source?:object, notes?:string[] }} */
export function assembleGuided(answers = {}) {
  const errors = [];
  const kind = GUIDED_KINDS.find((k) => k.value === answers.kind);
  if (!kind) errors.push("Choose what kind of document it is.");
  const title = String(answers.title ?? "").trim();
  if (!title) errors.push("Give it a name.");
  const roles = [...new Set(String(answers.roles ?? "").split(",").map((r) => r.trim()).filter(Boolean))].slice(0, 6);
  if (!roles.length) errors.push("Name at least one person who signs.");
  if (errors.length) return { ok: false, errors };

  const first = roles[0];
  const subject = String(answers.subject ?? "").trim();
  const money = ["none", "once", "recurring"].includes(answers.money) ? answers.money : "none";
  const term = String(answers.term ?? "").trim();
  const days = Number.isInteger(answers.notice_days) && answers.notice_days > 0 ? answers.notice_days : null;
  const notes = [];
  let n = 0;
  const num = (name) => `${++n}. ${name}`;
  const content = [h(title)];

  const intro = { agreement: "This agreement is between", nda: "This confidentiality agreement is between", consent: "This form records the consent of", waiver: "This waiver is given by", notice: "This notice is confirmed by" }[kind.value];
  content.push(p(t(`${intro} ${roles.join(", ")}`), t(subject ? ` about ${subject}.` : ".")));
  content.push(p(t("Date: "), tag("Date", "date", first, { label: "Date" })));

  if (["agreement", "nda"].includes(kind.value)) {
    content.push(h(num("What this covers")));
    content.push(p(t(subject ? `This document covers ${subject}. ` : "Describe what this document covers: "), tag("Description", "text", first, { label: "What this covers", required: "false" })));
  }
  if (kind.value === "consent") {
    content.push(h(num("What you are agreeing to")));
    content.push(p(t(subject ? `You are agreeing to ${subject}. ` : "Describe what the person is agreeing to: "), tag("Description", "text", first, { label: "What I agree to", required: "false" })));
    content.push(p(t("You can change your mind and withdraw this consent at any time by telling us in writing.")));
  }
  if (kind.value === "waiver") {
    content.push(h(num("Acknowledgement of risk")));
    content.push(p(t(subject ? `I understand that ${subject} involves some risk. ` : "I understand that this activity involves some risk. "), t("I have been able to ask questions and I take part by my own choice.")));
  }
  if (kind.value === "notice") {
    content.push(h(num("The notice")));
    content.push(p(t(subject ? `${subject}. ` : "Write the notice here: "), tag("Notice text", "text", first, { label: "Notice", required: "false" })));
  }
  if (money !== "none") {
    content.push(h(num("Payment")));
    content.push(p(t(money === "once" ? "The amount to be paid once is " : "The amount to be paid each period is "), tag("Amount", "text", first, { label: "Amount", required: "true" }), t(". "), t(money === "once" ? "It is due on " : "The first payment is due on "), tag("Due date", "date", first, { label: "Due date", required: "true" }), t(".")));
    notes.push("Check the payment amount and dates. To take the payment while people sign, replace the Amount field with a payment field.");
  }
  if (term || days) {
    content.push(h(num("How long it lasts and how to end it")));
    if (term) content.push(p(t(`This runs for ${term}.`)));
    if (days) content.push(p(t(`Either side may end it by giving ${days} days' written notice.`)));
  }
  if (answers.confidential === true || kind.value === "nda") {
    content.push(h(num("Keeping things private")));
    content.push(p(t("Anything shared in connection with this document that is not already public must be kept private and used only for the purpose it was shared for. This continues after the document ends.")));
  }
  if (String(answers.law ?? "").trim()) {
    content.push(h(num("Which law applies")));
    content.push(p(t(`The law of ${String(answers.law).trim()} applies to this document.`)));
  }
  content.push(h(num("Changes")));
  content.push(p(t("Any change to this document must be in writing and agreed by everyone who signed it.")));

  const used = new Set();
  const slots = roles.map((r) => { let k = `${slug(r)}_sig`; while (used.has(k)) k += "_2"; used.add(k); return { key: /^[a-z]/.test(k) ? k : `p_${k}`, label: r, role: r }; });
  content.push(h("Signatures"));
  content.push({ type: "signatureBlock", attrs: { slots } });
  notes.push("This was assembled from a short set of questions and standard wording. Read every line before you send it.");
  return { ok: true, errors: [], title, source: { type: "doc", content }, notes };
}
