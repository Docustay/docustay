<script>
  // The dot-and-line list: the document page, the changelog, audit. items: [{ title, detail?, at?, tone?: ok|warn|bad|mute|info, live? }]. The line draws and the nodes pop one after another.
  import RelativeTime from "./RelativeTime.svelte";
  let { items = [], dotted = false, horizontal = false, class: cls = "" } = $props();
</script>
{#if horizontal}
<ol class="relative flex min-w-max items-start gap-0 dot-grid rounded-2xl border border-line bg-card px-8 py-10 {cls}" data-testid="timeline">
  {#each items as it, i (it.id ?? i)}
    <li class="relative flex w-40 flex-col items-center text-center" style="--i:{i}">
      {#if i > 0}<span class="draw2 absolute right-1/2 top-[14px] h-px w-full bg-line-strong" style="animation-delay:{i * 250}ms" aria-hidden="true"></span>{/if}
      <span class="pop relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 {it.tone === 'ok' ? 'border-ok bg-ok-bg text-ok' : it.tone === 'warn' ? 'border-warn bg-warn-bg text-warn' : it.tone === 'bad' ? 'border-bad bg-bad-bg text-bad' : it.tone === 'info' ? 'border-info bg-info-bg text-info' : 'border-line-strong bg-card text-faint'} " style="animation-delay:{i * 250}ms" aria-hidden="true">{#if it.live}<span class="pinger absolute inset-0 rounded-full bg-current"></span>{/if}<span class="h-1.5 w-1.5 rounded-full bg-current"></span></span>
      <span class="mt-3 text-[13.5px] font-medium">{it.title}</span>
      {#if it.at}<RelativeTime value={it.at} class="mt-0.5 text-[12px] text-faint" />{/if}
      {#if it.detail}<span class="mt-0.5 max-w-[9rem] text-[12px] text-mute">{it.detail}</span>{/if}
    </li>
  {/each}
</ol>
{:else}
<ol class="relative grid gap-5 pl-7 {dotted ? 'dot-grid rounded-xl p-5 pl-10' : ''} {cls}" data-testid="timeline">
  <span class="grow-y absolute bottom-3 {dotted ? 'left-[1.65rem]' : 'left-[.55rem]'} top-3 w-px bg-line-strong" aria-hidden="true"></span>
  {#each items as it, i (it.id ?? i)}
    <li class="relative" style="--i:{i}">
      <span class="pop absolute {dotted ? '-left-[1.1rem]' : '-left-[1.45rem]'} top-1.5 grid h-3 w-3 place-items-center rounded-full border-2 border-[var(--paper)] {it.tone === 'ok' ? 'bg-ok' : it.tone === 'warn' ? 'bg-warn' : it.tone === 'bad' ? 'bg-bad' : it.tone === 'info' ? 'bg-info' : 'bg-faint'} {it.live ? 'ping' : ''}" aria-hidden="true"></span>
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"><span class="font-medium">{it.title}</span>{#if it.at}<RelativeTime value={it.at} class="text-xs text-faint" />{/if}</div>
      {#if it.detail}<p class="mt-0.5 text-sm text-mute">{it.detail}</p>{/if}
    </li>
  {/each}
</ol>
{/if}
