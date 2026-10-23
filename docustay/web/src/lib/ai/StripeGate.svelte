<script>
  // THE STRIPE GATE: is this workspace's Stripe ready to take a payment? Connected (details submitted, charges on, nothing due), Needs attention, or Not connected. When it is not connected the person is told plainly and can keep the payment terms as text only.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { inDemo } from "$lib/pro/plan.svelte.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let { ontextonly = null, testid = "stripe-gate", compact = false, status = $bindable(null) } = $props();
  onMount(async () => { const r = (await inDemo()) ? { ok: false } : await api("/api/product/docustay/payments");   // R13-D020: no Stripe call in the demo
    const j = r.ok ? (r.json?.data ?? r.json) : null; status = j ? (j.state === "live" ? "connected" : j.state === "not_connected" ? "not_connected" : "needs_attention") : "unknown"; });
</script>
{#if status && status !== "unknown"}
  <div class="rounded-xl border p-3 text-sm {status === 'connected' ? 'border-line' : 'border-warn'}" data-testid={testid} data-status={status}>
    <div class="flex flex-wrap items-center gap-2"><span class="font-medium">{t("Stripe")}:</span> <strong data-testid="{testid}-label">{status === "connected" ? t("Connected") : status === "needs_attention" ? t("Needs attention") : t("Not connected")}</strong></div>
    {#if status !== "connected"}
      <p class="mt-1 text-mute">{status === "needs_attention" ? t("Stripe still needs information from you before it can take this payment.") : t("Connect Stripe to collect this payment inside the document.")}</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <a class="btn primary !min-h-9 !py-1 text-sm" href="/settings?tab=payments" data-testid="{testid}-connect">{status === "needs_attention" ? t("Finish setting up Stripe") : t("Connect Stripe")}</a>
        {#if ontextonly}<button type="button" class="btn !min-h-9 !py-1 text-sm" onclick={ontextonly} data-testid="{testid}-textonly">{t("Keep the terms as text only")}</button>{/if}
      </div>
    {/if}
  </div>
{/if}
