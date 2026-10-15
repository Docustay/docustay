<script>
  // Loads a panel's code the first time it is shown (a settings tab), instead of shipping every tab's code in the screen's first download. `load` is `() => import("$lib/SomePanel.svelte")`; every other prop goes to the panel.
  let { load, ...rest } = $props();
  let C = $state(null);
  $effect(() => { let live = true; load().then((m) => { if (live) C = m.default; }); return () => { live = false; }; });
</script>
{#if C}<C {...rest} />{/if}
