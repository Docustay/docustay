<script>
  // SETTINGS → NOTIFICATIONS (Run 9; the inbox's "Settings" link). Which kinds of notice come in, in the app and by email, for the signed-in person. Each switch writes the host's own
  // per-person preference (POST /api/notifications/preferences, one row per topic and channel); the inbox hides a kind switched off "in the app", and the email channel skips one
  // switched off "by email" (recorded as skipped, src/notifications/send.mjs).
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import Toggle from "$lib/ui/Toggle.svelte";
  import { toast } from "$lib/ui/toast.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let data = $state(null), problem = $state(null);
  const LABEL = () => ({
    signed: [t("Someone signs"), t("Each signature on a document you sent.")], completed: [t("A document is complete"), t("Everyone has signed and the sealed copy has gone out.")],
    opened: [t("Someone opens a document"), t("The first time each person opens it.")], declined: [t("Something needs you"), t("Declined, asked for changes, expired, or an email that could not be delivered.")],
    limits: [t("Plan limits"), t("When 80% and 100% of a monthly limit is used.")], playbook: [t("Playbooks"), t("When a playbook sends something.")],
    renewal: [t("Contract dates"), t("30 and 7 days before a renewal notice date (Pro).")], payments: [t("Payments"), t("A payment arrives, or one did not go through.")],
  });
  async function load() { const r = await api("/api/product/docustay/inbox/settings"); if (r.ok) data = r.json?.data ?? r.json; else problem = r.error ?? t("Notification settings could not be loaded."); }
  async function set(kind, channel, enabled) {
    for (const topic of kind.topics) { const r = await api("/api/notifications/preferences", { method: "POST", body: { appUserId: data.appUserId, topic, channel, enabled } }); if (!r.ok) { toast(r.error ?? t("That did not save."), "bad"); await load(); return; } }
    toast(t("Saved."), "ok");
  }
  onMount(load);
</script>
<section class="max-w-3xl" data-testid="notifications-panel">
  <p class="mb-5 text-sm text-mute">{t("Choose what comes to your notifications and your email. This is just for you; other people in the workspace choose their own.")}</p>
  {#if problem}<p class="notice warn" role="alert">{problem}</p>{:else if !data}<p class="text-sm text-mute">{t("Loading…")}</p>{:else}
  <div class="nt" role="table" aria-label={t("Notifications")}>
    <div class="row head" role="row"><span role="columnheader">{t("Notice")}</span><span role="columnheader">{t("In the app")}</span><span role="columnheader">{t("Email")}</span></div>
    {#each data.kinds as k (k.key)}{@const [title, hint] = LABEL()[k.key] ?? [k.key, ""]}<div class="row" role="row" data-testid={`notif-${k.key}`}>
      <span role="cell"><b>{title}</b><small>{hint}</small></span>
      <span role="cell"><Toggle checked={k.inApp} onchange={(v) => set(k, "in_app", v)} testid={`notif-${k.key}-app`} label="" /><span class="sr-only">{t("{what} in the app", { what: title })}</span></span>
      <span role="cell"><Toggle checked={k.email} onchange={(v) => set(k, "email", v)} testid={`notif-${k.key}-email`} label="" /><span class="sr-only">{t("{what} by email", { what: title })}</span></span>
    </div>{/each}
  </div>{/if}
</section>
<style>
  .nt { border-radius: var(--rad-m); background: var(--card); box-shadow: var(--surface-shadow); }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) 110px 90px; align-items: center; gap: 16px; padding: 14px 20px; border-top: 1px solid var(--hair); }
  .row.head { border-top: 0; font: 500 11px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--mute); padding-block: 12px; }
  b { display: block; font-size: var(--t-body); font-weight: 500; } small { display: block; margin-top: 2px; font-size: var(--t-meta); color: var(--mute); }
  @media (max-width: 560px) { .row { grid-template-columns: minmax(0, 1fr) 64px 64px; padding: 12px 14px; } }
</style>
