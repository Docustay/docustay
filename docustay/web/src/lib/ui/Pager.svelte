<script>
  // "1 to 10 of 83  Previous  Next" under a long list, so a log is read page by page instead of as one endless scroll. The list slices itself: `page` is 1-based and bindable.
  import { t } from "$lib/i18n/index.svelte.js";
  let { total = 0, per = 10, page = $bindable(1), testid = "pager" } = $props();
  const pages = $derived(Math.max(1, Math.ceil(total / per)));
  const at = $derived(Math.min(Math.max(page, 1), pages));
</script>
{#if total > per}
  <nav class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-mute" aria-label={t("Pages")} data-testid={testid}>
    <span>{t("{a} to {b} of {c}", { a: (at - 1) * per + 1, b: Math.min(total, at * per), c: total })}</span>
    <span class="flex items-center gap-2"><span>{t("Page {a} of {b}", { a: at, b: pages })}</span>
      <button type="button" class="btn" disabled={at <= 1} onclick={() => (page = at - 1)}>{t("Previous")}</button>
      <button type="button" class="btn" disabled={at >= pages} onclick={() => (page = at + 1)}>{t("Next")}</button></span>
  </nav>
{/if}
