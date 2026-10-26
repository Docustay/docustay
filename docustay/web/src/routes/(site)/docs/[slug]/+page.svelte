<script>
  import CopyPage from "$lib/site/CopyPage.svelte";
  let { data } = $props();
</script>
<svelte:head><title>{data.title} · Docs · Docustay</title><meta name="description" content={data.description} /></svelte:head>
<div class="grid gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
  <div class="min-w-0">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4"><div class="min-w-0"><p class="font-mono text-[12px] uppercase tracking-wider text-faint">Documentation</p><h1 class="mt-2 text-[34px] font-semibold leading-tight tracking-tight">{data.title}</h1>{#if data.description}<p class="mt-2 max-w-2xl text-[16px] text-mute">{data.description}</p>{/if}</div><CopyPage markdown={data.markdown} url="https://docustay.app/docs/{data.slug}" /></div>
    <div class="prose-docs">{@html data.html}</div>
  </div>
  {#if data.toc?.length}<nav class="hidden text-[13px] xl:block" aria-label="On this page"><div class="sticky top-24"><p class="mb-2 font-mono text-[11px] uppercase tracking-wider text-faint">On this page</p><ul class="grid gap-1.5 border-l border-line pl-3">{#each data.toc as h}<li style="padding-left:{(h.level - 2) * 0.75}rem"><a href="#{h.id}" class="text-mute no-underline hover:text-ink">{h.text}</a></li>{/each}</ul></div></nav>{/if}
</div>
