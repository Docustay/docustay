<script>
  // A status chip: one colour family per state, so a state reads the same everywhere. Run 9 (the Rulebook): a status is a dot and coloured words, not a box (`.chip.status`). `live` pings the dot, `spin` spins it (attempting).
  let { tone = "mute", dot = true, live = false, spin = false, children, class: cls = "" } = $props();
</script>
<span class="chip status {tone} {cls}">{#if dot}<span class="{spin ? 'spin' : live ? 'ping' : ''} inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{/if}{@render children?.()}</span>
