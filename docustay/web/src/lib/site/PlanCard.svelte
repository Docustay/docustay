<script>
  // A pricing plan: name, price, a line, a list of checks, one button; `featured` marks the recommended plan, `chip` a small badge.
  import Icon from "$lib/ui/Icon.svelte";
  let { name, price, per = "", line = "", features = [], cta = null, featured = false, chip = "", class: cls = "" } = $props();
</script>
<article class="flex flex-col gap-4 rounded-2xl border p-6 {featured ? 'border-[var(--accent-line)] bg-card shadow-[0_0_0_1px_var(--accent-line),0_20px_60px_-30px_var(--accent)]' : 'border-line bg-card'} {cls}">
  <header><div class="flex items-center gap-2"><h3 class="text-lg font-semibold">{name}</h3>{#if chip}<span class="chip info">{chip}</span>{/if}</div><p class="mt-3 flex items-baseline gap-1"><span class="text-4xl font-semibold tracking-tight tabular-nums">{price}</span>{#if per}<span class="text-sm text-mute">{per}</span>{/if}</p>{#if line}<p class="mt-2 text-sm text-mute">{line}</p>{/if}</header>
  {#if cta}<div>{@render cta()}</div>{/if}
  <ul class="grid gap-2 text-sm">{#each features as f}<li class="flex gap-2"><Icon name="check" size={16} class="mt-0.5 text-ok" />{f}</li>{/each}</ul>
</article>
