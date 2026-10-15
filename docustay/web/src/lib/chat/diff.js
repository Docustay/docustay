// What a proposal changes, as short lines a person can read: {a: what, b: the words, before?: the words being replaced}.
const run = (nodes) => (nodes ?? []).map((n) => (n.type === "text" ? n.text : n.type === "hardBreak" ? " " : n.type === "variableChip" ? `[${n.attrs?.label ?? n.attrs?.name}]` : n.type === "fieldTag" ? `[${n.attrs?.label ?? "field"}]` : n.content ? run(n.content) : "")).join("");
export const textOf = (node) => { if (!node) return ""; if (node.type === "heading" || node.type === "paragraph") return run(node.content); if (node.type === "bulletList" || node.type === "orderedList") return (node.content ?? []).map((li) => `• ${run(li.content?.[0]?.content)}`).join("  "); if (node.type === "signatureBlock") return `signatures: ${(node.attrs?.slots ?? []).map((s) => s.label).join(", ")}`; return `(${node.type})`; };
const clip = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
export function describePatches(patches, previousSource) {
  const block = (n) => textOf(previousSource?.content?.[n - 1]);
  return (patches ?? []).map((p) => {
    if (p.op === "replace_text") return { kind: "replace", n: p.block, before: clip(p.before), b: clip(p.after) };
    if (p.op === "insert_block") return { kind: "add", n: p.after, b: clip(textOf(p.node)) };
    if (p.op === "replace_block") return { kind: "replace-block", n: p.block, before: clip(block(p.block)), b: clip(textOf(p.node)) };
    return { kind: "remove", n: p.block, before: clip(block(p.block)) };
  });
}
