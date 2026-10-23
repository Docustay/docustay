<script>
  // Run 9 Part 3.7 (board W3, step 2 → 3): the one step between "Get Pro" (the website, or a fresh account) and Stripe's checkout. It plays the leaving moment (B2) and hands the browser to
  // Stripe; Pro switches on only when Stripe confirms, on the way back to Billing. Already on Pro, or nothing to buy here → Billing.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { RingDive } from "$lib/fx3d/index.js";
  import { loadPlan } from "$lib/pro/plan.svelte.js";
  import { takePro } from "$lib/site/wantPro.js";
  let problem = $state(null);
  onMount(async () => {
    const want = takePro(), q = new URLSearchParams(location.search);
    const interval = (q.get("interval") ?? want?.interval) === "year" ? "year" : "month";
    const plan = ["payg", "lifetime"].includes(q.get("plan") ?? want?.plan) ? (q.get("plan") ?? want?.plan) : "pro";
    const st = await loadPlan({ force: true });
    if (!st?.billing?.canUpgrade) { goto("/billing", { replaceState: true }); return; }
    try { if (!sessionStorage.getItem("docustay:upgrade-from")) sessionStorage.setItem("docustay:upgrade-from", "/create?mode=document&upload=1"); } catch { /* the documents list */ }
    const [r] = await Promise.all([api("/api/product/docustay/checkout", { method: "POST", body: { interval, plan } }), new Promise((ok) => setTimeout(ok, 700))]);
    const url = r.json?.url ?? r.json?.data?.url;
    if (r.ok && url) window.location.assign(url); else problem = r.error ?? t("That did not work. Try again.");
  });
</script>
<svelte:head><title>{t("Upgrade")} · Docustay</title></svelte:head>
<div class="grid min-h-[60vh] place-items-center" data-testid="upgrade-page">
  {#if problem}<div class="max-w-md text-center"><p class="text-bad" role="alert" data-testid="upgrade-problem">{problem}</p><a class="btn mt-4" href="/billing">{t("Go to Billing")}</a></div>
  {:else}<RingDive label={t("Taking you to secure checkout")} />{/if}
</div>
