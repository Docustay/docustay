<script>
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  let { data } = $props();
</script>
<DeskHead title={data.doc.title} description="{data.doc.title}. General information about how the service works, not legal advice." crumbs={[["Docustay", "/"], [data.doc.title, "/legal/" + data.key]]} />
<article class="d-wrap lg" data-page="/legal/{data.key}" data-voice="V3" data-template="T10">
  <p class="d-eyebrow">LEGAL · VERSION {data.doc.version}</p>
  <h1 class="d-h1 sm">{data.doc.title}</h1>
  <p class="d-fine note" role="note"><strong>General information, not legal advice.</strong> This text explains how the service works. It does not promise any legal outcome.</p>
  <div class="d-prose prose-legal">{#each data.doc.sections as s}<h2 id={s.id}>{s.title}</h2>{@html s.bodyHtml}{/each}</div>
</article>
<Closing title="Questions about this?" label="Contact us" href="/contact" keep={[["Terms", "/legal/terms"], ["Privacy policy", "/legal/privacy-policy"], ["Trust", "/trust"]]} />
<style>
  .lg { padding-top: 56px; max-width: 860px; } .note { margin: 18px 0 30px; max-width: 70ch; } .lg :global(.prose-legal h2) { font: 600 24px/1.2 var(--font-sans); letter-spacing: -.02em; margin: 40px 0 12px; color: #f4f2ec; } .lg :global(.prose-legal p), .lg :global(.prose-legal li) { color: #c9c5bb; line-height: 1.7; } .lg :global(.prose-legal a) { color: #f4f2ec; text-decoration: underline; text-underline-offset: 3px; } .lg :global(.prose-legal ul) { padding-left: 20px; list-style: disc; display: grid; gap: 8px; }
</style>
