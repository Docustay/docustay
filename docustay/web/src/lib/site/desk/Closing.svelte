<script>
  // The closing line of every page: a serif sign-off with ONE italic violet word (written *word*), one next step, and at most three "Keep reading" links.
  let { title, label = "Get started free", href = "/signup", keep = [] } = $props();
  const parts = $derived(String(title).split(/\*([^*]+)\*/));
</script>
<section class="d-closing"><h2>{#each parts as p, i}{#if i % 2}<em>{p}</em>{:else}{p}{/if}{/each}</h2><a class="d-btn main" href={href} data-umami-event="cta_click" data-umami-event-location="closing">{label}</a></section>
{#if keep.length}<nav class="d-sec d-keep tight" aria-label="Keep reading" style="padding-top:22px;margin-top:0"><b>Keep reading</b>{#each keep as [t, h]}<a href={h}>{t}</a>{/each}</nav>{/if}
