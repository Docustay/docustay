<script>
  // The sticky multi-language request panel of the API reference, with a Response panel under it. languages: [{ id, label, code, html? }]; response: { status, body }
  import CodeWindow from "$lib/ui/CodeWindow.svelte";
  let { languages = [], response = null, title = "Request" } = $props();
</script>
<div class="grid gap-3" data-testid="code-panel"><CodeWindow {title} tabs={languages} />{#if response}<CodeWindow title="Response · {response.status}" tabs={[{ id: "r", label: "JSON", code: response.body, html: response.html }]} />{/if}</div>
