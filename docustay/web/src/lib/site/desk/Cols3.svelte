<script>
  // Three columns with a hairline between them: number, headline, one or two sentences. `features` (optional) holds a feature id per column.
  let { cols } = $props();
</script>
<div class="d-cols3">{#each cols as c, i}<div data-feature={c.feature}><span class="n">{String(i + 1).padStart(2, "0")}</span><h3 class="d-h3">{c.h}</h3><p>{c.p}</p></div>{/each}</div>
