<script>
  // THE "THINK HARDER" SWITCH (AI-COST-AND-USAGE-SPEC §1–§2): one request on the stronger model (Opus 5.5). Pro only — WHATEVER the AI key (Run 8, ruling R2): the server refuses it on Free
  // (limits.mjs), so the switch reads the same answer (`thinkHarder.available` from the usage call, which now follows the plan for an own-key workspace too) and wears the one Pro lock.
  import { onMount } from "svelte";
  import Toggle from "$lib/ui/Toggle.svelte";
  import ProLock from "$lib/pro/ProLock.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { aiUsage, loadAiUsage } from "./usage.svelte.js";
  let { checked = $bindable(false), testid = "think-harder", compact = false } = $props();
  onMount(() => { loadAiUsage(); });
  const u = $derived(aiUsage.data);
  const hosted = $derived(u?.mode === "hosted");
  const allowed = $derived(u?.thinkHarder?.available === true);
  const credits = $derived(u?.thinkHarder?.credits);
  $effect(() => { if (!allowed && checked) checked = false; });
</script>
{#if u}
  <div data-testid={`${testid}-row`} class="flex items-center gap-2">
    <ProLock item="think_harder" locked={!allowed} tip={t("Think harder uses a stronger model for one hard document.")} testid={`${testid}-lock`}>
      {#snippet children(locked)}
        <Toggle id={testid} bind:checked disabled={locked} testid={`${testid}-toggle`} label={t("Think harder")}
          hint={compact ? "" : locked ? t("A stronger model for one hard document.") : hosted && credits != null ? t("uses {n, plural, one {# credit} other {# credits}}", { n: credits }) : t("A stronger model for a hard document")} />
      {/snippet}
    </ProLock>
  </div>
{/if}
