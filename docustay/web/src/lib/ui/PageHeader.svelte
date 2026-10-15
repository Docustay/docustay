<script>
  // The header of every portal page (frame): H1 28px/500 on the left, actions on the right ("</>" API button, secondary, primary). Optional line and filters.
  let { title, line = "", filters = null, actions = null, class: cls = "" } = $props();
</script>
<header class="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 {cls}">
  <div class="min-w-0"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{title}</h1>{#if line}<p class="mt-1 text-[14.5px] text-mute">{line}</p>{/if}</div>
  <div class="flex flex-wrap items-center gap-2">{#if filters}{@render filters()}{/if}{#if actions}{@render actions()}{/if}</div>
</header>
