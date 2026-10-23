// Run 9 Part 4.2 (R8-57) — boxes the SENDER fills in before a document goes out ("Filled in by: Sender"). Pure, no imports: the send, Check and the editor read the same rules.
// A sender box (`sender: true`) holds the organisation's own facts or the terms it sets: the school and the trip on a permission slip, the fees in an agreement. It sits on a seat's page
// like any box, but no signer is ever asked for it: at send its value must be there, and it is frozen as that seat's locked answer (signers see it and cannot change it).
// Its starting value may name the organisation's facts ({{org.name}}, {{org.email}}, {{sender.name}}, {{sender.email}}) or a value of this send ({{custom.key}}); they are worked out at send.
// ★ Every box's starting value goes through the same step: a signer's box that starts with {{signer.name}} gets that person's name, and a token that names nothing is DROPPED —
//   a signer is never shown "{{…}}" (before Run 9 the editor offered "{{signer.name}}" as a prefill and nothing ever worked it out).

/** Where a sender box may take its value from, as a starter writes it (`from=org.name`). */
export const SENDER_SOURCES = Object.freeze(["org.name", "org.email", "sender.name", "sender.email"]);
/** The kinds of box a sender may fill: typed words and choices. A signature, a tick of agreement, a payment, a file are always a signer's. */
export const SENDER_TYPES = Object.freeze(["text", "dropdown", "multiselect"]);

const TOKEN = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)\s*\}\}/gi;
const hasToken = (v) => typeof v === "string" && /\{\{[^{}]*\}\}/.test(v);

/** Works out the {{tokens}} in one value. Returns the text and the tokens that had no value (those are removed from the text). */
function fillTokens(text, values) {
  const missing = [];
  const out = String(text ?? "").replace(TOKEN, (_, key) => { const v = values?.[key.toLowerCase()] ?? values?.[key]; if (v === undefined || v === null || String(v).trim() === "") { missing.push(key); return ""; } return String(v); });
  return { text: out.replace(/\s{2,}/g, " ").trim(), missing };
}

/** The required sender boxes of a body that have no value yet (nothing typed, nothing to work out). For Check and for publishing a form. */
export const emptySenderBoxes = (fields) => (Array.isArray(fields) ? fields : []).filter((f) => f?.sender === true && f.required !== false && !String(f.default ?? "").trim());

/** The sentence a sender reads for a sender box with no value. */
export const senderBoxMessage = (f) => `“${f.label || f.id}” is yours to fill in before sending (Filled in by: Sender)`;
export const SENDER_BOX_KEY = "“{label}” is yours to fill in before sending (Filled in by: Sender)";

/**
 * At send: every box's starting value worked out. `values` holds the organisation's and the send's facts (org.name, sender.email, custom.x …); `seatValues[role]` holds signer.* for
 * the person on that seat. A sender box must end with a value — otherwise it is a problem — and is then frozen as the seat's locked answer. Returns a NEW body and the problems.
 */
// R13-D216: a sender's box with no starting value of its own takes the send's custom value named after it — its label as a key ("Event name" → custom.event_name), else its id — so a
// list sent to many people can carry one column per sender box (a CSV column becomes custom.<column>, spaces as underscores).
const boxKey = (s) => String(s ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const fromCustom = (f, values) => { for (const k of [boxKey(f.label), boxKey(f.id)]) { const v = k ? values[`custom.${k}`] : undefined; if (typeof v === "string" && v.trim()) return v.trim(); } return ""; };

export function resolveBoxValues(body, { values = {}, seatValues = {} } = {}) {
  const problems = [];
  const fields = (body?.fields ?? []).map((f) => {
    if (f.default === undefined && !f.sender) return f;
    const own = f.default === undefined || f.default === "" ? (f.sender ? fromCustom(f, values) : "") : null;
    const filled = own !== null ? { text: own, missing: [] } : fillTokens(f.default, { ...values, ...(seatValues[f.role] ?? {}) });
    if (f.sender) {
      if (!filled.text && f.required === false) return { ...f, default: "", locked: true };   // an optional box the sender left empty stays empty: no signer may write in it
      if (!filled.text) { problems.push({ id: f.id, label: f.label || f.id, text: senderBoxMessage(f), key: SENDER_BOX_KEY, vars: { label: f.label || f.id } }); return f; }
      if ((f.type === "dropdown") && f.options && !f.options.includes(filled.text)) { problems.push({ id: f.id, label: f.label || f.id, text: `“${f.label || f.id}” must be one of its choices`, key: "“{label}” must be one of its choices", vars: { label: f.label || f.id } }); return f; }
      return { ...f, default: filled.text, locked: true };
    }
    if (!hasToken(f.default)) return f;
    if (!filled.text) { const { default: _d, locked: _l, ...rest } = f; return rest; }   // a starting value that names nothing on this send: the box starts empty (and so cannot stay locked)
    return { ...f, default: filled.text };
  });
  return { body: { ...body, fields }, problems };
}
