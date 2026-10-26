<script>
  // An HTTP method pill for the API reference: GET, POST, PUT, PATCH, DELETE each in its own colour family.
  let { method = "GET", class: cls = "" } = $props();
  const TONE = { GET: "ok", POST: "info", PUT: "warn", PATCH: "warn", DELETE: "bad" };
</script>
<span class="chip {TONE[method.toUpperCase()] ?? 'mute'} font-mono !text-[.7rem] {cls}">{method.toUpperCase()}</span>
