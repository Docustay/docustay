<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { onNavigate } from "$app/navigation";
  import { theme } from "$lib/theme/theme.svelte.js";
  import { viewTransition } from "$lib/ui/transitions.js";
  let { children } = $props();
  onMount(() => theme.init());
  $effect(() => { theme.route(page.route.id); });
  onNavigate(viewTransition);
</script>
{@render children()}
