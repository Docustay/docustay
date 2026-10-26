<script>
  // The closing line of an inner page that keeps its own working parts: one next step, on the Desk look.
  import Closing from "$lib/site/desk/Closing.svelte";
  let { title = "Start free", text = "", href = "/signup", label = "Start free", second = null, keep = null } = $props();
</script>
<Closing {title} {label} {href} keep={keep ?? (second ? [second] : [])} />
