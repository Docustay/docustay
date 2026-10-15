<script>
  let { title, label = "Get started free", href = "/signup", keep = [] } = $props();
</script>
<section class="d-closing"><h2>{title}</h2><a class="d-btn main" href={href}>{label}</a></section>
{#if keep.length}<nav class="d-sec d-keep tight" aria-label="Keep reading" style="padding-top:22px;margin-top:0"><b>Keep reading</b>{#each keep as [t, h]}<a href={h}>{t}</a>{/each}</nav>{/if}
