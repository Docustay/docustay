<script>
  // A filter pill: "All statuses ▾". Wraps the Pick select (Ark) in a pill; `value` "" means no filter.
  import Pick from "./Pick.svelte";
  let { options = [], value = $bindable(""), label = "", placeholder = "", testid = "" } = $props();
</script>
<Pick {options} {value} {label} {placeholder} {testid} onchange={(v) => (value = v)} class="filter-pill" />
