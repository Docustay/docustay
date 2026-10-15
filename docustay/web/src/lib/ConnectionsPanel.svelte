<script>
  // Platform → Connections: what this workspace is connected to, one card each, then the Stripe settings. Every card names something that really exists in Docustay.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import IntegrationCard from "$lib/ui/IntegrationCard.svelte";
  import PaymentsPanel from "$lib/PaymentsPanel.svelte";
  let pay = $state(null), mail = $state(null), hooks = $state(null);
  const load = async () => { const [p, m, h] = await Promise.all([api("/api/product/docustay/payments"), api("/api/documents/email"), api("/api/developer/webhook-endpoints")]); pay = p.ok ? p.json : null; mail = m.ok ? (m.json?.data ?? m.json) : null; hooks = h.ok ? (h.json?.endpoints ?? []) : null; };
  onMount(() => { load(); return live(["billing", "settings", "email", "webhooks"], load); });
  const payState = $derived(pay?.state ?? pay?.status ?? "not_connected");
  const mailMode = $derived(mail?.mode ?? "platform");
</script>
<div class="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="connections">
  <IntegrationCard brand="stripe" name="Stripe" line={t("Take payments inside a document")} status={payState === "live" ? t("Connected") : payState === "not_connected" ? t("Not connected") : t("Needs attention")} tone={payState === "live" ? "ok" : payState === "not_connected" ? "mute" : "warn"} />
  <IntegrationCard icon="mail" name={t("Email sending")} line={mailMode === "platform" ? t("Sent through Docustay") : mailMode === "domain" ? t("From your own domain") : mailMode === "smtp" ? t("Through your own mail server") : t("From your own mailbox")} status={mailMode === "platform" ? t("Default") : t("Connected")} tone={mailMode === "platform" ? "mute" : "ok"} />
  <IntegrationCard icon="webhook" name={t("Webhooks")} line={hooks === null ? "" : t("{n, plural, =0 {No endpoints yet} one {# endpoint} other {# endpoints}}", { n: hooks.length })} status={hooks?.length ? t("Active") : ""} tone="ok">{#snippet action()}<a class="btn !min-h-8 !px-2.5" href="/settings?tab=webhooks">{t("Open")}</a>{/snippet}</IntegrationCard>
  <IntegrationCard icon="sparkles" name={t("Claude and other assistants")} line={t("Connect an assistant that drafts for you to approve")} status="" tone="mute">{#snippet action()}<a class="btn !min-h-8 !px-2.5" href="/docs/connector" target="_blank" rel="noopener">{t("How")}</a>{/snippet}</IntegrationCard>
</div>
<div class="mt-8"><PaymentsPanel /></div>
