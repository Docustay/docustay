<script>
  import { live } from "$lib/live.js";
  // Platform → Domains and email: how sending is going. The guard pauses a workspace well below the mail provider's own limits; this shows how close it is.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import StatTile from "$lib/ui/StatTile.svelte";
  import Meter from "$lib/ui/Meter.svelte";
  let h = $state(null);
  const loadH = async () => { const r = await api("/api/documents/email-health"); h = r.ok ? (r.json?.data ?? r.json) : false; };
  onMount(() => { loadH(); return live(["email"], loadH); });
  const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
</script>
<div class=" space-y-4" data-testid="email-health">
  <div><h2 class="text-lg font-semibold">{t("Sending health")}</h2>
    <p class="text-sm text-mute">{t("The last {n} days of email about your documents, not counting test mode.", { n: h?.rates?.windowDays ?? 30 })}</p></div>
  {#if h === null}<p class="text-sm text-mute" style="min-height: 15rem">{t("Loading…")}</p>
  {:else if h === false}<p class="notice bad">{t("The numbers could not be loaded.")}</p>
  {:else}
    {#if h.guard.paused}<p class="notice bad" role="alert" data-testid="email-paused">{t("Sending is paused: {reason}. Clean up the addresses that bounced, then resume in Settings → Email.", { reason: h.guard.reason })}</p>{/if}
    <div class="grid grid-cols-2 gap-6 border-y border-line py-4 md:grid-cols-4">
      <StatTile label={t("Sent")} value={h.rates.sent} />
      <StatTile label={t("Bounced")} value={h.rates.bounced} tone={h.rates.bounced ? "bad" : ""} />
      <StatTile label={t("Reported as spam")} value={h.rates.complained} tone={h.rates.complained ? "bad" : ""} />
      <StatTile label={t("State")} value={h.guard.paused ? t("Paused") : t("Sending")} tone={h.guard.paused ? "bad" : "ok"} />
    </div>
    <div class="grid gap-5 md:grid-cols-2">
      <Meter label={t("Bounce rate")} detail={`${pct(h.rates.bounceRate, 1)} of ${pct(h.rates.limits.bounceRate, 0)} limit`} value={h.rates.bounceRate} max={h.rates.limits.bounceRate} auto testid="meter-bounce" />
      <Meter label={t("Spam-report rate")} detail={`${pct(h.rates.complaintRate)} of ${pct(h.rates.limits.complaintRate)} limit`} value={h.rates.complaintRate} max={h.rates.limits.complaintRate} auto testid="meter-complaint" />
    </div>
    <p class="text-sm text-mute">{t("Sending pauses by itself at {b} bounced or {c} reported as spam once at least {m} emails have gone out, so your domain's name stays good.", { b: pct(h.rates.limits.bounceRate, 0), c: pct(h.rates.limits.complaintRate), m: h.rates.limits.minSample })}</p>
  {/if}
</div>
