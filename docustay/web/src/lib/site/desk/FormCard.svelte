<script>
  // A form template card: the title, its line, the field count and whether a team member counter-signs. No page picture: a form is filled on screen.
  let { t, level = 2 } = $props();
</script>
<a class="fc" href="/form-templates/{t.slug}" data-testid="form-template-card">
  <span class="k">{t.cat}</span>
  <svelte:element this={"h" + level} class="mt">{t.title}</svelte:element><p>{t.summary}</p>
  <span class="meta">{t.fields} fields{t.counterSign ? " · counter-signed" : ""}</span><span class="go">See every field →</span>
</a>
<style>
  .fc { display: flex; flex-direction: column; gap: 8px; text-decoration: none; color: #f4f2ec; border: 1px solid #2a2a2c; background: #131315; border-radius: 6px; padding: 22px; height: 100%; transition: border-color .15s; } .fc:hover { border-color: var(--d-accent, #8b7cf6); }
  .k { font: 500 11px/1.4 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #a8a39a; } .mt { margin: 0; font: 600 18px/1.25 var(--font-sans); letter-spacing: -.02em; } p { margin: 0; color: #a8a39a; font-size: 14.5px; line-height: 1.5; flex: 1; }
  .meta { font: 500 12px/1 var(--font-mono); color: #a8a39a; } .go { font: 500 12.5px/1 var(--font-mono); color: #f4f2ec; margin-top: 4px; }
</style>
