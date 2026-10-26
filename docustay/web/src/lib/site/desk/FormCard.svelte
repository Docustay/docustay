<script>
  // A template card for one of the thirty short templates: the title, its line, the field count and whether a team member counter-signs. No page picture: it is filled in on screen.
  let { t, level = 2 } = $props();
</script>
<a class="fc" href="/templates/{t.slug}" data-testid="form-template-card">
  <span class="k">{t.cat}</span>
  <svelte:element this={"h" + level} class="mt">{t.title}</svelte:element><p>{t.summary}</p>
  <span class="meta">{t.fields} fields{t.counterSign ? " · counter-signed" : ""}</span><span class="go">See every field →</span>
</a>
<style>
  .fc { display: flex; flex-direction: column; gap: 8px; text-decoration: none; color: var(--tx-1); border: 1px solid var(--hairline); background: #ffffff; border-radius: 6px; padding: 22px; height: 100%; transition: border-color .15s; } .fc:hover { border-color: var(--d-accent, rgb(90 58 193 / 0.5)); }
  .k { font: 500 11px/1.4 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); } .mt { margin: 0; font: 600 18px/1.25 var(--font-sans); letter-spacing: -.02em; } p { margin: 0; color: var(--tx-3); font-size: 14.5px; line-height: 1.5; flex: 1; }
  .meta { font: 500 12px/1 var(--font-mono); color: var(--tx-3); } .go { font: 500 12.5px/1 var(--font-mono); color: var(--tx-1); margin-top: 4px; }
</style>
