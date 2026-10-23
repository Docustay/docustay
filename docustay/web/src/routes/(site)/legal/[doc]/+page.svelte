<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import AskAIStrip from "$lib/site/ui/AskAIStrip.svelte";
  let { data } = $props();
  // a table wider than the column scrolls inside its own box: make that box reachable with the keyboard
  $effect(() => { data.key; for (const t of document.querySelectorAll(".prose-legal table")) { t.setAttribute("tabindex", "0"); t.setAttribute("aria-label", "Table, scrolls sideways"); } });
</script>
<DeskHead title={data.doc.title} description="{data.doc.title}. General information about how the service works, not legal advice." crumbs={[["Docustay", "/"], [data.doc.title, "/legal/" + data.key]]} />
<article class="d-wrap lg" data-page="/legal/{data.key}" data-voice="V3" data-template="T10">
  <p class="d-eyebrow">LEGAL · VERSION {data.doc.version}</p>
  <h1 class="d-h1 sm">{data.doc.title}</h1>
  <p class="d-fine note" role="note"><strong>General information, not legal advice.</strong> This text explains how the service works. It does not promise any legal outcome.</p>
  <nav class="toc" aria-label="On this page"><details><summary>On this page · {data.doc.sections.length} sections</summary><ol>{#each data.doc.sections as s}<li><a href="#{s.id}">{s.title}</a></li>{/each}</ol></details></nav>
  <p class="d-fine upd">Last updated: {data.doc.version}</p>
  <div class="d-prose prose-legal">{#each data.doc.sections as s}<h2 id={s.id}>{s.title}</h2>{@html s.bodyHtml}{/each}</div>
  <div class="ask"><AskAIStrip subject={"the " + data.doc.title} /></div>
</article>
<Closing title="Questions about this?" label="Contact us" href="/contact" keep={[["Terms", "/legal/terms"], ["Privacy policy", "/legal/privacy-policy"], ["Trust", "/trust"]]} />
<style>
  .toc { margin: 0 0 8px; padding: 16px 20px; border: 1px solid var(--hairline); border-radius: 8px; max-width: 70ch; } .toc summary { cursor: pointer; font: 500 12px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--tx-3); min-height: 24px; } .toc ol { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px; column-width: 280px; } .toc a { color: var(--tx-2); text-decoration: underline; text-underline-offset: 3px; } .upd { margin: 14px 0 0; } .ask { margin-top: 48px; }
  @media print { .lg { padding-top: 0; max-width: none; } :global(body), .lg { background: #fff !important; color: #000 !important; } .lg :global(h1), .lg :global(h2), .lg :global(.prose-legal p), .lg :global(.prose-legal li), .lg :global(.prose-legal a), .toc a, .lg :global(.d-fine) { color: #000 !important; } .toc, .ask { display: none; } .lg :global(.prose-legal table) { max-height: none; overflow: visible; border-color: #999; } .lg :global(.prose-legal thead th) { background: #eee; color: #000; position: static; } .lg :global(.prose-legal td) { border-color: #ccc; } }
  .lg :global(.prose-legal table) { display: block; width: 100%; max-height: 620px; overflow: auto; border: 1px solid var(--hairline); border-radius: 6px; border-collapse: separate; border-spacing: 0; font-size: 13.5px; }
  .lg :global(.prose-legal thead th) { position: sticky; top: 0; z-index: 1; background: #ffffff; text-align: left; font: 500 11px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); }
  .lg :global(.prose-legal th), .lg :global(.prose-legal td) { padding: 9px 14px; border-top: 1px solid var(--hairline); text-align: left; vertical-align: top; } .lg :global(.prose-legal td:nth-child(n+2)) { white-space: nowrap; } .lg :global(.prose-legal td:first-child) { overflow-wrap: anywhere; min-width: 150px; }
  .lg { padding-top: 110px; max-width: 860px; } .note { margin: 18px 0 30px; max-width: 70ch; } .lg :global(.prose-legal h2) { font: 600 24px/1.2 var(--font-sans); letter-spacing: -.02em; margin: 40px 0 12px; color: var(--tx-1); } .lg :global(.prose-legal p), .lg :global(.prose-legal li) { color: var(--tx-2); line-height: 1.7; } .lg :global(.prose-legal a) { color: var(--tx-1); text-decoration: underline; text-underline-offset: 3px; } .lg :global(.prose-legal ul) { padding-left: 20px; list-style: disc; display: grid; gap: 8px; }
</style>
