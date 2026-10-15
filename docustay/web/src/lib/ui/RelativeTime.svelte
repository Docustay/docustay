<script>
  // A relative time that refreshes itself and shows the exact time on hover (title).
  import { relativeTime } from "./relativeTime.js";
  import { whenText, i18n } from "$lib/i18n/index.svelte.js";   // Run 9: in the reader's language (it was always English: "now" on a German page)
  let { value, class: cls = "" } = $props();
  let now = $state(Date.now());
  $effect(() => { const id = setInterval(() => (now = Date.now()), 30000); return () => clearInterval(id); });
  const d = $derived(value ? new Date(value) : null);
</script>
{#if d && !Number.isNaN(d.getTime())}<time datetime={d.toISOString()} title={whenText(d)} class={cls}>{relativeTime(d, { now, locale: i18n.lang })}</time>{/if}
