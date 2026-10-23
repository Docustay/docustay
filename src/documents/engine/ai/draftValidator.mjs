// THE DRAFT VALIDATOR (AI-COST-AND-USAGE-SPEC §7; the fix for D-082): plain code that checks every AI draft before a person sees it. The model's own word that "both parties sign" is not trusted:
// each party the text names as signing must be on the list of people who sign (so each gets a signature and a date), each blank must belong to a real person, nothing may be left as an unmarked placeholder, totals must add up,
// dates must run in order, every "Section N" must exist. Pure: no imports. Returns { blocking: [sentence], notes: [sentence] }. `blocking` problems trigger ONE automatic retry with the exact list (no extra credit), then are shown with the draft.

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Terms the text defines as a party: (the “Provider”), ("Client"), (“Homeowner”). */
export function definedParties(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\(\s*(?:the\s+|each\s+a\s+|“?the\s+)?[“"']([A-Z][A-Za-z][A-Za-z &/-]{1,40})[”"']\s*\)/g)) out.add(m[1].trim());
  return [...out];
}
const dateOf = (s) => {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "i").exec(s); if (m) return Date.UTC(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]);
  m = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i").exec(s); if (m) return Date.UTC(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2]);
  return null;
};
const amounts = (s) => [...String(s).matchAll(/(?:\$|USD\s?|€|£)\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, "")));

/**
 * @param {{document:string, people?:{role:string, action:string}[]}} draft
 * @returns {{blocking:string[], notes:string[]}}
 */
export function validateDraft(draft) {
  const text = String(draft?.document ?? ""), people = Array.isArray(draft?.people) ? draft.people : [];
  const blocking = [], notes = [];
  const signers = people.filter((p) => p.action === "signer");
  const listed = new Set(people.map((p) => norm(p.role)));
  const signerSet = new Set(signers.map((p) => norm(p.role)));

  // 1 · every party the text names as signing is a listed signer (the D-082 case: "both sign" but only one signature block)
  for (const term of definedParties(text)) {
    if (/^(parties|party|agreement|effective date|services|work|fee|fees|term|contract|premises|property|deposit|payment)$/i.test(term)) continue;
    const t = norm(term);
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((x) => new RegExp(`\\b${esc(term)}\\b`, "i").test(x) && /\bsign(s|ed|ing|ature)?\b/i.test(x));
    const claimsSign = sentences.length > 0 || new RegExp(`${esc(term)}\\s*:\\s*\\{\\{[^}]*type=signature`, "i").test(text);
    if (claimsSign && !signerSet.has(t)) blocking.push(listed.has(t) ? `The text says the ${term} signs, but ${term} is not set to sign, so they would get no signature field. Make ${term} a person who signs.` : `The text says the ${term} signs, but ${term} is not on the list of people, so they would get no signature field and no date. Add ${term} as a person who signs.`);
  }
  // 2 · each signer has a place to sign: a signature tag for their role, or the signature block that is added for everyone who signs (that block carries the date too). A signature tag with no date for the same role is noted.
  const tagRoles = (re) => new Set([...text.matchAll(/\{\{([^{}\n]{1,600})\}\}/g)].filter((m) => re.test(m[1])).map((m) => norm((/(?:^|;)\s*role\s*=\s*([^;]*)/i.exec(m[1]) ?? [])[1] ?? "")));
  const sigRoles = tagRoles(/type\s*=\s*signature/i), dateRoles = tagRoles(/type\s*=\s*date(_signed)?\b/i);
  for (const p of signers) { const r = norm(p.role); if (sigRoles.has(r) && !dateRoles.has(r)) notes.push(`${p.role} has a signature but no date line; the date is added automatically when they sign.`); }
  // 3 · every blank belongs to a person on the list
  for (const r of new Set([...text.matchAll(/\{\{[^{}\n]*?role\s*=\s*([^;{}\n]+)/gi)].map((m) => m[1].trim()))) if (!listed.has(norm(r))) blocking.push(`A blank is for “${r}”, who is not on the list of people.`);
  // 4 · no unmarked placeholder left in the words
  const bare = text.replace(/\{\{[^{}\n]*\}\}/g, "");
  for (const m of [...bare.matchAll(/\[[^\]\n]{1,60}\]|_{4,}|\bTBD\b|\bXX+\b|<<[^>\n]{1,40}>>|\bINSERT [A-Z ]{3,40}\b/g)].slice(0, 3)) blocking.push(`A placeholder, “${m[0].slice(0, 40)}”, is left in the text. Replace it with the real words, or make it a blank the person fills in.`);
  // 5 · a stated total equals the amounts listed with it
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n"), ti = lines.findIndex((l) => /\btotal\b/i.test(l) && amounts(l).length);
    if (ti > 0) { const parts = lines.slice(0, ti).flatMap(amounts); const total = amounts(lines[ti])[0]; if (parts.length >= 2 && Math.abs(parts.reduce((a, b) => a + b, 0) - total) > 0.005) blocking.push(`The total ${total} does not add up: the amounts above it come to ${Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100}.`); }
  }
  // 6 · a start date comes before the end date it is paired with
  for (const m of text.matchAll(/\b(?:start|starts|begin|begins|from|commenc\w+)\b[^.\n]{0,40}?((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})|(?:[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}))[^.\n]{0,60}?\b(?:end|ends|until|to|through|expire\w*)\b[^.\n]{0,40}?((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})|(?:[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}))/gi)) {
    const a = dateOf(m[1]), b = dateOf(m[2]);
    if (a != null && b != null && b < a) blocking.push(`The end date (${m[2]}) is before the start date (${m[1]}).`);
  }
  // 7 · "Section N" / "clause N" points at something that exists
  const headings = text.split("\n").filter((l) => /^#{2,3} /.test(l)).length;
  const numbered = Math.max(0, ...[...text.matchAll(/^\s*(\d{1,2})[.)] /gm)].map((m) => Number(m[1])));
  const have = Math.max(headings, numbered);
  for (const m of text.matchAll(/\b(?:section|clause|paragraph)\s+(\d{1,2})\b/gi)) if (Number(m[1]) > have) { blocking.push(`The text refers to ${m[0].toLowerCase()}, but the document has only ${have} ${have === 1 ? "part" : "parts"}.`); break; }
  return { blocking: [...new Set(blocking)], notes: [...new Set(notes)] };
}

/** The text sent back to the model for its one automatic retry: the exact problems, nothing else new. */
export const retryInstruction = (blocking) => `Your draft had these problems:\n${blocking.map((b) => `- ${b}`).join("\n")}\nFix every one of them and answer again with the complete JSON object.`;
