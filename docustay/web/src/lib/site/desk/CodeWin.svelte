<script>
  // A code window: language tabs, mono code, an optional response panel. Every snippet shown on the site was RUN (see lib/site/pages/snippets.js and scripts/snippets-proof.mjs); `ran` says when.
  let { tabs, response = null, responseLabel = "RESPONSE", label = "" } = $props();
  let cur = $state(0);
  let copied = $state(false);
  const copy = async () => { try { await navigator.clipboard.writeText(tabs[cur].code); copied = true; setTimeout(() => (copied = false), 1400); } catch { /* clipboard blocked */ } };
</script>
<div class="d-code" data-code>
  <div class="bar"><div class="tabs" role="tablist" aria-label={label || "Language"}>
    {#each tabs as t, i}<button role="tab" aria-selected={cur === i} onclick={() => (cur = i)}>{t.label}</button>{/each}
  </div><button type="button" class="cp" onclick={copy} aria-label="Copy the code">{copied ? "Copied" : "Copy"}</button></div>
  <pre tabindex="0"><code>{tabs[cur].code}</code></pre>
  {#if response}<div class="resp"><span>{responseLabel}</span><pre tabindex="0"><code>{response}</code></pre></div>{/if}
</div>
