<script>
  // SETTINGS — the one place for everything that is set up rather than done (Launch step 7): four areas, each its own row of sections, each section its own address (?tab=…) so it can be linked and survives a reload.
  //   Account (you) · Workspace (the people and the organisation: team, security, sending domain, branding, connections, data, audit) · Documents (how documents behave and look) · Developers (keys, webhooks, logs, embedding).
  // Everything here was a screen of its own before (Workspace, Developers) or a tab of this one; the panels are the same ones, so nothing new can be done here that could not be done there. Old addresses still arrive in the right place.
  import SettingsForm from "$lib/SettingsForm.svelte";
  import DeletionPanel from "$lib/DeletionPanel.svelte";
  import WelcomeEmailsSwitch from "$lib/WelcomeEmailsSwitch.svelte";
  import ProfileCard from "$lib/ProfileCard.svelte";
  import ThemeCards from "$lib/ui/ThemeCards.svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import TeamPanel from "$lib/TeamPanel.svelte";   // the Workspace entry (/console/platform) lands here, so it is not split off
  import LazyPanel from "$lib/ui/LazyPanel.svelte";
  import { t } from "$lib/i18n/index.svelte.js"; import LangPicker from "$lib/i18n/LangPicker.svelte"; import { edition } from "$lib/edition.svelte.js";
  // Run 8 (roles matrix): the three workspace areas are an owner's or an admin's (the server refuses a member's saves there); a member sees their own account only.
  const AREAS = $derived([
    { key: "account", title: t("Account"), items: [["account", t("My account")], ["notifications", t("Notifications")]] },
    ...(edition.rank === "member" ? [] : [
      { key: "workspace", title: t("Workspace"), items: [["team", t("Team")], ["security", t("Security")], ["domains", t("Domains and email")], ["branding", t("Branding")], ["connections", t("Connections")], ["data", t("Data")], ["audit", t("Audit log")]] },
      { key: "documents", title: t("Documents"), items: [["documents", t("Signing")], ["templates", t("Templates")], ["forms", t("Forms")], ["appearance", t("Appearance")], ["emailtemplates", t("Email templates")], ["payments", t("Payments")], ["ai", t("AI drafting")]] },
      { key: "developers", title: t("Developers"), items: [["dev", t("Overview")], ["keys", t("API keys")], ["approvals", t("Approvals")], ["webhooks", t("Webhooks")], ["apilog", t("API log")], ["emailevents", t("Email events")], ["usage", t("Usage report")], ["embedding", t("Embedding")], ["tools", t("SDKs and CLI")]] },
    ]),
  ]);
  const KEYS = $derived(AREAS.flatMap((a) => a.items.map((i) => i[0])));
  // old addresses and bookmarks: the previous Settings tabs, the Workspace screen's ("overview") and the Developers screen's ("overview", "developer")
  const LEGACY = { developer: "keys", overview: "team", email: "domains" };
  const start = () => { const want = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("tab") ?? "account") : "account"; const k = LEGACY[want] ?? want; return KEYS.includes(k) ? k : "account"; };
  let tab = $state(start());
  const area = $derived(AREAS.find((a) => a.items.some((i) => i[0] === tab)) ?? AREAS[0]);
  const pick = (k) => { tab = k; history.replaceState(null, "", `?tab=${k}`); };
  const label = $derived(area.items.find((i) => i[0] === tab)?.[1] ?? t("Settings"));
</script>
<svelte:head><title>{label} · {t("Settings")} · Docustay</title></svelte:head>
<PageHeader title={t("Settings")}>{#snippet actions()}<LangPicker />{/snippet}</PageHeader>
{#if AREAS.length > 1}
<nav aria-label={t("Settings areas")} class="-mt-2 mb-3 flex gap-1 overflow-x-auto" role="tablist" data-testid="settings-areas">{#each AREAS as a (a.key)}<button role="tab" aria-selected={area.key === a.key} class="area shrink-0 {area.key === a.key ? 'on' : ''}" onclick={() => pick(a.items[0][0])} data-testid="settings-area-{a.key}">{a.title}</button>{/each}</nav>
{/if}
<nav aria-label={t("{name} sections", { name: area.title })} class="mb-6 flex gap-1 overflow-x-auto border-b border-line pb-2" role="tablist">{#each area.items as [k, l] (k)}<button role="tab" aria-selected={tab === k} aria-current={tab === k ? "page" : undefined} class="stab shrink-0 {tab === k ? 'on' : ''}" onclick={() => pick(k)} data-testid="settings-{k}">{l}</button>{/each}</nav>
<div>
  <div class="min-w-0">
    {#if tab === "account"}<ProfileCard /><div class="mt-6"><DeletionPanel show="account" /></div><WelcomeEmailsSwitch />
    {:else if tab === "notifications"}<LazyPanel load={() => import("$lib/inbox/NotificationsPanel.svelte")} />
    {:else if tab === "team"}<TeamPanel />
    {:else if tab === "security"}<LazyPanel load={() => import("$lib/SecurityPanel.svelte")} />
    {:else if tab === "domains"}<div style="min-height: 15rem"><LazyPanel load={() => import("$lib/EmailHealthPanel.svelte")} /></div><div class="mt-8" style="min-height: 57.9rem"><LazyPanel load={() => import("$lib/EmailPanel.svelte")} /></div><div class="mt-8" style="min-height: 43.8rem"><SettingsForm only={["email"]} /></div>{#if !edition.selfHost}<div class="mt-8" style="min-height: 6.3rem"><LazyPanel load={() => import("$lib/SigningDomainPanel.svelte")} /></div>{/if}   <!-- each panel loads on its own: the wrappers hold their final height so nothing below jumps -->
    {:else if tab === "branding"}<SettingsForm only={["signed_copy", "certificate", "branding"]} />
    {:else if tab === "connections"}<LazyPanel load={() => import("$lib/ConnectionsPanel.svelte")} />
    {:else if tab === "data"}<LazyPanel load={() => import("$lib/DataPanel.svelte")} />
    {:else if tab === "audit"}<LazyPanel load={() => import("$lib/AuditPanel.svelte")} />
    {:else if tab === "documents"}<SettingsForm intro only={["sending", "teams", "test_mode", "signing", "download", "records"]} />
    {:else if tab === "templates"}<p class="mb-4 max-w-3xl text-sm text-mute" data-testid="settings-templates-intro">{t("Your own templates and the built-in library: who approves new templates, and whether the built-in Document and Form templates are shown.")}</p><SettingsForm only={["templates"]} />
    {:else if tab === "forms"}<p class="mb-4 max-w-3xl text-sm text-mute" data-testid="settings-forms-intro">{t("What every new form starts with on its Publish step. Each form can change its own; changing these does not change forms already published.")}</p><SettingsForm only={["forms"]} />
    {:else if tab === "appearance"}<ThemeCards /><div class="mt-6"><SettingsForm only={["signed_copy", "certificate", "branding"]} /></div>
    {:else if tab === "emailtemplates"}<LazyPanel load={() => import("$lib/EmailTemplatesPanel.svelte")} />
    {:else if tab === "payments"}<LazyPanel load={() => import("$lib/PaymentsPanel.svelte")} />
    {:else if tab === "ai"}<section class="mb-6 max-w-3xl rounded-xl border border-line p-4" data-testid="ai-usage-card"><h2 class="mb-2 font-semibold">{t("AI usage")}</h2><LazyPanel load={() => import("$lib/ai/AiUsageBar.svelte")} /></section><SettingsForm only={["ai"]} reserve="30rem" /><LazyPanel load={() => import("$lib/ai/OwnKeyPanel.svelte")} /><LazyPanel load={() => import("$lib/ai/AiLogPanel.svelte")} />
    {:else if tab === "dev"}<LazyPanel load={() => import("$lib/DevOverview.svelte")} go={pick} />
    {:else if tab === "keys"}<LazyPanel load={() => import("$lib/DeveloperPanel.svelte")} section="keys" />
    {:else if tab === "webhooks"}<LazyPanel load={() => import("$lib/DeveloperPanel.svelte")} section="webhooks" />
    {:else if tab === "apilog"}<LazyPanel load={() => import("$lib/ApiLogPanel.svelte")} />
    {:else if tab === "emailevents"}<LazyPanel load={() => import("$lib/EmailEventsPanel.svelte")} />
    {:else if tab === "approvals"}<LazyPanel load={() => import("$lib/ApprovalsPanel.svelte")} />
    {:else if tab === "usage"}<LazyPanel load={() => import("$lib/ApiUsagePanel.svelte")} />{#if edition.selfHost}<div class="mt-10"><LazyPanel load={() => import("$lib/UsagePanel.svelte")} /></div>{/if}
    {:else if tab === "embedding"}<LazyPanel load={() => import("$lib/EmbedPanel.svelte")} />
    {:else}<LazyPanel load={() => import("$lib/DevTools.svelte")} />{/if}
  </div>
</div>
<style>
  .area { padding: 6px 14px; border-radius: 999px; font-size: 13.5px; color: var(--mute); border: 1px solid var(--line); white-space: nowrap; } .area:hover { color: var(--ink); background: var(--tint); } .area.on { background: var(--ink); color: var(--paper); border-color: var(--ink); font-weight: 500; }
  .stab { padding: 7px 12px; border-radius: 9px; font-size: 13.5px; color: var(--mute); white-space: nowrap; } .stab:hover { color: var(--ink); background: var(--tint); } .stab.on { background: var(--tint); color: var(--ink); font-weight: 500; }
</style>
