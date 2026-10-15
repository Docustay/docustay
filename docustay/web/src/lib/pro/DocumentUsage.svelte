<script>
  // THE MONTHLY DOCUMENT LIMIT, ON THE DOCUMENTS PAGE (Run 8 J8, R8-67). At 15 of 15 the page said nothing: "New document" opened, a whole document could be set up, and only Send refused.
  // Shown from the point the owner's 80% notice goes out, so the list stays calm below it; the same look as the template meter (TemplateUsage.svelte). The numbers are the server's
  // (`usage.documentsThisMonth / documentsLimit / resetsAt` from /api/product/docustay/status); Pro and a self-hosted install have no limit, so nothing is shown.
  import { onMount } from "svelte";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { plan, loadPlan } from "./plan.svelte.js";
  import { exploreProFrom } from "./proSheet.svelte.js";
  let { testid = "document-usage" } = $props();
  onMount(() => { loadPlan({ force: true }); });
  const u = $derived(plan.data?.usage);
  const limit = $derived(u?.documentsLimit ?? null), used = $derived(u?.documentsThisMonth ?? 0);
  const left = $derived(limit == null ? null : Math.max(0, limit - used));
  const state = $derived(limit == null ? "none" : used >= limit ? "used" : used >= Math.ceil(limit * 0.8) ? "low" : "calm");
  const resets = $derived(u?.resetsAt ? whenText(u.resetsAt, { day: "numeric", month: "long", timeZone: "UTC" }) : "");
  const pct = $derived(limit ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  let me = $state(null);
</script>
{#if plan.loaded && limit != null && state !== "calm"}
  <div class="du" data-state={state} data-testid={testid} bind:this={me}>
    <div class="row"><span class="lbl">{t("Documents this month")}</span><span class="num tabular-nums" data-testid="{testid}-count">{t("{used} of {limit}", { used, limit })}</span></div>
    <div class="bar" aria-hidden="true"><i style="transform:scaleX({pct / 100})"></i></div>
    {#if state === "used"}<p class="msg" role="status" data-testid="{testid}-full">{t("You have sent all {limit} documents your Free plan includes this month. Sending opens again on {date}.", { limit, date: resets })} <button type="button" class="xp" data-testid="{testid}-explore" onclick={() => exploreProFrom("unlimited_documents", me)}>{t("Explore Pro")}</button></p>
    {:else}<p class="msg" role="status" data-testid="{testid}-low">{t("{n, plural, one {# document} other {# documents}} left this month. Resets on {date}.", { n: left, date: resets })} <button type="button" class="xp" data-testid="{testid}-explore" onclick={() => exploreProFrom("unlimited_documents", me)}>{t("Explore Pro")}</button></p>{/if}
  </div>
{/if}
<style>
  .du { display: grid; gap: 6px; max-width: 520px; font-size: 13px; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .lbl { color: var(--ink); } .num { color: var(--mute); }
  .bar { height: 6px; border-radius: 6px; background: var(--tint); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 6px; transform-origin: left; background: var(--warn, #b45309); transition: transform var(--dur-slow, 520ms) var(--ease-out, ease-out); }
  [data-state="used"] .bar i { background: var(--bad, #b42318); }
  .msg { margin: 0; line-height: 1.45; }
  .xp { border: 0; background: none; padding: 0; color: var(--brand); font: inherit; font-weight: 500; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .bar i { transition: none; } }
</style>
