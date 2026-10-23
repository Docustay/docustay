// THE SHARED DOCUMENT ENGINE — workspace facts the AI must not use because the workspace has not set them. A draft may name the organisation's facts ({{org.name}}, {{org.address}}) and they are filled in when
// the document is saved or sent; but when the workspace has NO address (Settings, Appearance, Signed copy, Address line) such a field would be empty, and the AI must never fill one in or invent one.
// So: the model is told the fact is unset (vocabulary.mjs) and, whatever it writes anyway, every merge field that names an unset fact becomes a blank the SENDER fills in before sending (a "Filled in by:
// Sender" box), never a draft that fails and never an invented address. Pure except `unsetFacts`, which reads one setting.
import { getDocumentSetting } from "../../settings.mjs";

/** The facts of this list that have no value in this workspace. (org.name always has one: the workspace's own name.) */
export const GUARDED_FACTS = Object.freeze({ "org.address": { name: "organisation_address", label: "Organisation address" } });

export async function unsetFacts(tx) {
  const out = [];
  const address = String((await getDocumentSetting(tx, "signed_copy.address_line").catch(() => "")) ?? "").trim();
  if (!address) out.push("org.address");
  return out;
}

/** → { source, replaced: [fact names] }. Deep copy; each merge field naming an unset fact becomes a text box the sender fills in. */
export function blankUnset(source, unset = []) {
  const set = new Set(unset.filter((n) => GUARDED_FACTS[n]));
  const replaced = new Set(), used = new Map();
  if (!set.size) return { source, replaced: [] };
  const walk = (n) => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== "object") return n;
    if (n.type === "variableChip" && set.has(String(n.attrs?.name ?? "").toLowerCase())) {
      const fact = String(n.attrs.name).toLowerCase(), g = GUARDED_FACTS[fact];
      replaced.add(fact);
      const i = (used.get(fact) ?? 0) + 1; used.set(fact, i);
      return { type: "fieldTag", attrs: { name: i === 1 ? g.name : `${g.name}_${i}`, type: "text", role: "Sender", label: g.label, filled: "sender", required: "true" } };
    }
    const o = {}; for (const [k, v] of Object.entries(n)) o[k] = walk(v); return o;
  };
  return { source: walk(source), replaced: [...replaced] };
}

/** The line a person reads when a draft had to leave a blank for an unset fact. */
export const unsetNote = (fact) => (fact === "org.address"
  ? "Your workspace has no address set, so the draft leaves the organisation's address as a box you fill in before sending. To have it filled in for you, set it in Settings, Appearance, Signed copy (Address line)."
  : `Your workspace has no ${fact}, so the draft leaves a box for it.`);
