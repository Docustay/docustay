// ═══════════════════════════════════════════════════════════════════════════════════════════════
// renderContractBlocks.jsx — ONE reader for contractBodySchema's blocks (src/documents/body.mjs), shared by every surface that shows an agreement's actual wording to a signer: the emailed sign
// link (routes/sign.jsx), the portal's document view (portal/DocumentSigning.jsx), the previews. Since QUEUE §23.2.1 it no longer decides what a paragraph is: it draws the nodes that
// `@keystone/documents/documentView.mjs` builds (`blocksToNodes`), the same module the PDF is drawn from — so the screen and the PDF cannot drift.
// `variables` resolves `variable` blocks; omit it to show every variable's unresolved fallback label, which is what a template PREVIEW wants.
// `signature` blocks are drawn separately from the agreement text by every caller of this reader.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { cn } from "@/lib/utils";
import { blocksToNodes } from "@keystone/documents/documentView.mjs";

export function Runs({ runs }) {
  return runs.map((r, i) => {
    if (r.text === "\n") return <br key={i} />;
    let node = r.text;
    if (r.bold) node = <strong>{node}</strong>;
    if (r.italic) node = <em>{node}</em>;
    return <span key={i} className={r.missing ? "text-mute" : undefined}>{node}</span>;
  });
}

export function renderNodes(nodes) {
  return nodes.map((n, i) => {
    if (n.type === "paragraph") return <p key={i} className="mt-0 mb-2 text-ui text-ink-2 last:mb-0"><Runs runs={n.runs} /></p>;
    if (n.type === "list") {
      const ListTag = n.ordered ? "ol" : "ul";
      return (
        <ListTag key={i} className={cn("mt-0 mb-2 pl-5 text-ui text-ink-2 last:mb-0", n.ordered ? "list-decimal" : "list-disc")}>
          {n.items.map((item, ii) => <li key={ii}><Runs runs={item} /></li>)}
        </ListTag>
      );
    }
    return null;
  });
}

/** `section.blocks` (or any block array) → React elements — one `<p>` per paragraph, one `<ul>`/`<ol>` per list, in document order. */
export function renderSectionBlocks(blocks, variables = {}) {
  return renderNodes(blocksToNodes(blocks, variables));
}
