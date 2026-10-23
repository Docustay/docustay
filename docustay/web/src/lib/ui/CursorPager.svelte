<script>
  // "Page 2  Rows 50  Previous  Next" under a log the server pages by a cursor (it never knows the total): the same Previous and Next as Pager, plus how many rows a page holds.
  // The page owns the cursors; this draws the controls and says what was pressed.
  import { t } from "$lib/i18n/index.svelte.js";
  let { page = 1, hasNext = false, per = 50, sizes = [25, 50, 100], busy = false, onprev = () => {}, onnext = () => {}, onsize = () => {}, testid = "cursor-pager" } = $props();
</script>
{#if page > 1 || hasNext}
  <nav class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-mute" aria-label={t("Pages")} data-testid={testid}>
    <span data-testid="{testid}-page">{t("Page {a}", { a: page })}</span>
    <span class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1.5">{t("Rows")}<select class="field !min-h-8 !w-auto !py-0.5" value={String(per)} onchange={(e) => onsize(Number(e.currentTarget.value))} data-testid="{testid}-size">{#each sizes as n (n)}<option value={String(n)}>{n}</option>{/each}</select></label>
      <button type="button" class="btn" disabled={page <= 1 || busy} onclick={onprev} data-testid="{testid}-prev">{t("Previous")}</button>
      <button type="button" class="btn" disabled={!hasNext || busy} onclick={onnext} data-testid="{testid}-next">{t("Next")}</button>
    </span>
  </nav>
{/if}
