<script>
  // The page after cancelling: what happens, the date, and the way back. Reads the plan from the server; it never cancels anything itself.
  import { onMount } from "svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import { api } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { loadPlan } from "$lib/pro/plan.svelte.js";
  import PlanPiece from "$lib/billing/PlanPiece.svelte";
  import { SHORT } from "$lib/billing/billingModel.js";
  let st = $state(null), busy = $state(false), problem = $state(null), loaded = $state(false);
  const day = (iso) => (iso ? whenText(iso, { dateStyle: "long", timeZone: "UTC" }) : "—");
  onMount(async () => { st = await loadPlan({ force: true }); loaded = true; });
  // R13-D213: named by the plan really being cancelled (Pay as you go too), and an ended plan says so instead of "no cancellation scheduled"
  const name = $derived(st?.plan?.name ?? t("Pro"));
  const onFree = $derived(!st?.plan?.key || st.plan.key === "docustay_free");
  const title = $derived(st?.plan?.cancelsAt ? t("Your {plan} plan is cancelled", { plan: name }) : onFree ? t("Your plan has ended") : t("Nothing is cancelled"));
  async function resume() { busy = true; problem = null; const r = await api("/api/product/docustay/resume", { method: "POST", body: {} }); busy = false; if (r.ok) location.assign("/billing"); else problem = r.error ?? t("That did not work. Try again."); }
</script>
<svelte:head><title>{loaded ? title : t("Billing")} · Docustay</title></svelte:head>
<PageHeader title={loaded ? title : t("Billing")} />
{#if loaded}
  <section class="mt-10 grid justify-items-center text-center" data-testid="cancelled-page"><PlanPiece plan={SHORT[st?.plan?.key] ?? "pro"} size={96} still testid="cancelled-piece" />
    {#if st?.plan?.cancelsAt}
      <p class="text-lg">{t("{plan} stays on until {date}.", { plan: name, date: day(st.plan.cancelsAt) })}</p>
      <p class="mt-2 text-[15px] text-mute">{t("You will not be charged again. We have emailed you these details.")}</p>
      <p class="mt-6 text-[15px]">{t("Changed your mind?")}</p>
      {#if problem}<p class="mt-3 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem}</p>{/if}
      <div class="mt-3 flex flex-wrap justify-center gap-3"><button class="btn primary" onclick={resume} disabled={busy} data-testid="cancelled-resume">{t("Resume {plan}", { plan: name })}</button><a class="btn" href="/billing">{t("Back to Billing")}</a></div>
    {:else if onFree}
      <p class="text-[15px]">{t("This workspace is on Free now. Your documents and templates are still here.")}</p><p class="mt-4"><a class="btn primary" href="/billing">{t("See plans")}</a></p>
    {:else}
      <p class="text-[15px]">{t("This workspace has no cancellation scheduled.")}</p><p class="mt-4"><a class="btn primary" href="/billing">{t("Back to Billing")}</a></p>
    {/if}
  </section>
{/if}
