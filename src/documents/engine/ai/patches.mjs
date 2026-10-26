// THE SHARED DOCUMENT ENGINE — chat edits as CHANGES, not rewrites. Pure. A patch addresses a top-level block by its number (1-based) and carries the words it expects
// to find, so a patch made against an old version of the text is reported STALE instead of landing in the wrong place. The screen shows each change for accept or reject;
// `applyPatches` applies the accepted ones to a copy and re-validates the whole document.
import { parseSource } from "../source.mjs";

const OPS = new Set(["replace_text", "insert_block", "replace_block", "remove_block"]);

/** The blocks as numbered plain text, what the edit prompt shows the model. */
export function numberBlocks(source) {
  return source.content.map((b, i) => {
    const text = JSON.stringify(b).length > 6000 ? "(long block)" : blockText(b);
    return { n: i + 1, type: b.type, text };
  });
}
function blockText(b) {
  const run = (nodes) => (nodes ?? []).map((n) => n.type === "text" ? n.text : n.type === "hardBreak" ? "\n" : n.type === "variableChip" ? `{{${n.attrs.name}}}` : n.type === "fieldTag" ? `{{${n.attrs.name};type=${n.attrs.type ?? "text"}}}` : "").join("");
  if (b.type === "heading" || b.type === "paragraph") return run(b.content);
  if (b.type === "bulletList" || b.type === "orderedList") return b.content.map((li) => `- ${run(li.content[0].content)}`).join("\n");
  if (b.type === "signatureBlock") return `signatures: ${b.attrs.slots.map((s) => s.label).join(", ")}`;
  return `(${b.type})`;
}

/** Replace the first exact occurrence of `before` inside ONE text node of a block; false when it is not found within a single run. */
function replaceInBlock(block, before, after) {
  const walk = (nodes) => { for (const n of nodes ?? []) { if (n.type === "text" && n.text.includes(before)) { n.text = n.text.replace(before, () => after); return true; } if (n.content && walk(n.content)) return true; } return false; };
  return walk(block.content);
}

/**
 * @returns {{ok:boolean, source:object|null, applied:object[], rejected:{patch:object, why:string}[], errors:string[]}}
 */
export function applyPatches(source, patches) {
  const doc = JSON.parse(JSON.stringify(source));
  const applied = [], rejected = [];
  // ops are applied in the order given, but block numbers always refer to the ORIGINAL numbering, so we resolve each to a stable object reference first
  const originals = doc.content.slice();
  const at = (n) => (Number.isInteger(n) && n >= 1 && n <= originals.length ? originals[n - 1] : null);
  const inserts = new Map();   // original block (or 0) → nodes to insert after it
  for (const p of Array.isArray(patches) ? patches : []) {
    if (!p || !OPS.has(p.op)) { rejected.push({ patch: p, why: "not a known change" }); continue; }
    if (p.op === "replace_text") {
      const b = at(p.block);
      if (!b) { rejected.push({ patch: p, why: `there is no block ${p.block}` }); continue; }
      if (typeof p.before !== "string" || !p.before || typeof p.after !== "string") { rejected.push({ patch: p, why: "a text change needs the words before and after" }); continue; }
      if (!replaceInBlock(b, p.before, p.after)) { rejected.push({ patch: p, why: "the words to change are not in that block any more (it may have been edited)" }); continue; }
      applied.push(p);
    } else if (p.op === "insert_block") {
      if (p.after !== 0 && !at(p.after)) { rejected.push({ patch: p, why: `there is no block ${p.after}` }); continue; }
      const key = p.after === 0 ? 0 : at(p.after);
      inserts.set(key, [...(inserts.get(key) ?? []), p.node]); applied.push(p);
    } else if (p.op === "replace_block") {
      const b = at(p.block); if (!b) { rejected.push({ patch: p, why: `there is no block ${p.block}` }); continue; }
      const i = doc.content.indexOf(b); doc.content[i] = p.node; applied.push(p);
      if (inserts.has(b)) { inserts.set(p.node, inserts.get(b)); inserts.delete(b); }
    } else if (p.op === "remove_block") {
      const b = at(p.block); if (!b) { rejected.push({ patch: p, why: `there is no block ${p.block}` }); continue; }
      const i = doc.content.indexOf(b); if (i >= 0) doc.content.splice(i, 1); applied.push(p);
    }
  }
  const out = [...(inserts.get(0) ?? [])];
  for (const b of doc.content) { out.push(b); if (inserts.has(b)) out.push(...inserts.get(b)); }
  doc.content = out;
  const parsed = parseSource(doc);
  if (!parsed.ok) return { ok: false, source: null, applied: [], rejected: [...rejected, ...applied.map((patch) => ({ patch, why: "the document would no longer be valid" }))], errors: parsed.errors };
  return { ok: true, source: parsed.source, applied, rejected, errors: [] };
}
