<script>
  // The page after cancelling: what happens, the date, and the way back. Reads the plan from the server; it never cancels anything itself.
  import { onMount } from "svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import { api } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { loadPlan } from "$lib/pro/plan.svelte.js";
  let st = $state(null), busy = $state(false), problem = $state(null), loaded = $state(false);
  const day = (iso) => (iso ? whenText(iso, { dateStyle: "long", timeZone: "UTC" }) : "—");
  onMount(async () => { st = await loadPlan({ force: true }); loaded = true; });
  async function resume() { busy = true; problem = null; const r = await api("/api/product/docustay/resume", { method: "POST", body: {} }); busy = false; if (r.ok) location.assign("/billing"); else problem = r.error ?? t("That did not work. Try again."); }
</script>
<svelte:head><title>{t("Your Pro plan is cancelled")} · Docustay</title></svelte:head>
<PageHeader title={t("Your Pro plan is cancelled")} />
{#if loaded}
  <section class="mt-2 max-w-xl" data-testid="cancelled-page">
    {#if st?.plan?.cancelsAt}
      <p class="text-lg">{t("Pro stays on until {date}.", { date: day(st.plan.cancelsAt) })}</p>
      <p class="mt-2 text-[15px] text-mute">{t("You will not be charged again. We have emailed you these details.")}</p>
      <p class="mt-6 text-[15px]">{t("Changed your mind?")}</p>
      {#if problem}<p class="mt-3 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem}</p>{/if}
      <div class="mt-3 flex flex-wrap gap-3"><button class="btn primary" onclick={resume} disabled={busy} data-testid="cancelled-resume">{t("Resume Pro")}</button><a class="btn" href="/billing">{t("Back to Billing")}</a></div>
    {:else}
      <p class="text-[15px]">{t("This workspace has no cancellation scheduled.")}</p><p class="mt-4"><a class="btn primary" href="/billing">{t("Back to Billing")}</a></p>
    {/if}
  </section>
{/if}
