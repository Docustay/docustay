<script>
  // An empty list is the real page with ONE band where the rows would be (the maintainer, 23 Sep): art, glow, a title, one line, one action.
  let { title, line = "", art = null, action = null, class: cls = "" } = $props();
</script>
<div class="relative grid place-items-center overflow-hidden rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center {cls}" data-testid="empty-state">
  <div class="pointer-events-none absolute inset-0 opacity-70" style="background: radial-gradient(60% 60% at 50% 30%, var(--accent-soft), transparent 70%)"></div>
  <div class="relative grid justify-items-center gap-3">
    {#if art}<div class="float">{@render art()}</div>{/if}
    <h2 class="text-lg font-semibold">{title}</h2>
    {#if line}<p class="max-w-md text-mute">{line}</p>{/if}
    {#if action}<div class="mt-1">{@render action()}</div>{/if}
  </div>
</div>
