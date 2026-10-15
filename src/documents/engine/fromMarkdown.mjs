// THE SHARED DOCUMENT ENGINE — markdown → source. Pure, no imports. Used to import a written agreement (the an example organisation Agreement lives only as markdown,
// specs/documents/EXAMPLE_PRACTICE-COACHING-AGREEMENT.md) through the SAME path every other source takes, instead of the test-only helper.
// Subset: `## Heading` opens a section; blank line ends a paragraph; consecutive lines join with a space; `- item` is a bullet; `**bold**` is bold; a line starting
// `**Signatures:**` becomes a signature block whose slots come from `signatureSlots`; everything above the first `---` rule is the editor's note and is skipped
// (`skipUntilRule`). Text is kept character for character: straight quotes stay, `&` is not entity-encoded here (the HTML compiler escapes it).
const inline = (text) => {
  const out = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) out.push({ type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] });
    else out.push({ type: "text", text: part });
  }
  return out;
};

export function markdownToSource(md, { signatureSlots = [], skipUntilRule = true, preambleTitle = "Agreement" } = {}) {
  const content = [];
  let para = [], list = null, started = !skipUntilRule, sections = 0, opened = false;
  const flushPara = () => { if (para.length) { content.push({ type: "paragraph", content: inline(para.join(" ")) }); para = []; } };
  const flushList = () => { if (list) { content.push({ type: "bulletList", content: list.map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(t) }] })) }); list = null; } };
  const heading = (title, extra = {}) => { content.push({ type: "heading", attrs: { level: 2, key: `s${++sections}`, ...extra }, content: [{ type: "text", text: title }] }); opened = true; };
  for (const raw of String(md).split("\n")) {
    const line = raw.trimEnd();
    if (!started) { if (line.startsWith("---")) started = true; continue; }
    if (/^---+$/.test(line)) continue;
    if (line.startsWith("**Signatures:**")) {
      flushPara(); flushList();
      heading("Signatures", { requiresSignature: true });
      content.push({ type: "signatureBlock", attrs: { slots: signatureSlots } });
      continue;
    }
    const h = line.match(/^## (.+)$/);
    if (h) { flushPara(); flushList(); heading(h[1]); continue; }
    if (!opened) { if (!line) continue; heading(preambleTitle); }
    if (!line) { flushPara(); continue; }
    const li = line.match(/^- (.+)$/);
    if (li) { flushPara(); (list ??= []).push(li[1]); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return { type: "doc", content };
}
