<script>
  // SETTINGS — the one place for everything that is set up rather than done (Launch step 7): four areas, each its own row of sections, each section its own address (?tab=…) so it can be linked and survives a reload.
  //   Account (you) · Workspace (the people and the organisation: team, security, sending domain, branding, data, audit) · Documents (how documents behave and look) · Developers (keys, webhooks, logs, embedding).
  // Everything here was a screen of its own before (Workspace, Developers) or a tab of this one; the panels are the same ones, so nothing new can be done here that could not be done there. Old addresses still arrive in the right place.
  import SettingsForm from "$lib/SettingsForm.svelte"; import BrandingPreview from "$lib/BrandingPreview.svelte";
  import DeletionPanel from "$lib/DeletionPanel.svelte";
  import WelcomeEmailsSwitch from "$lib/WelcomeEmailsSwitch.svelte";
  import ProfileCard from "$lib/ProfileCard.svelte";
  import WorkspaceNameCard from "$lib/WorkspaceNameCard.svelte";
  import WorkspaceLogoCard from "$lib/WorkspaceLogoCard.svelte";
  import ThemeCards from "$lib/ui/ThemeCards.svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import Page from "$lib/ui/Page.svelte";
  import TeamPanel from "$lib/TeamPanel.svelte";   // the Workspace entry (/console/platform) lands here, so it is not split off
  import LazyPanel from "$lib/ui/LazyPanel.svelte";
  import { t } from "$lib/i18n/index.svelte.js"; import { edition } from "$lib/edition.svelte.js";
  // Run 8 (roles matrix): the three workspace areas are an owner's or an admin's (the server refuses a member's saves there); a member sees their own account only.
  const AREAS = $derived([
    { key: "account", title: t("Account"), items: [["account", t("My account")], ["security", t("Security")], ["notifications", t("Notifications")]] },   // 21 Oct 2026: Security (your own password, two-step and passkeys) is every role's; the workspace rules inside it show only to owners and admins
    ...(edition.rank === "member" ? [] : [
      { key: "workspace", title: t("Workspace"), items: [["team", t("Team")], ...(edition.selfHost ? [["domains", t("Email")]] : []), ["branding", t("Branding")], ["data", t("Data")], ["audit", t("Audit log")]] },   // Docustay v1: the sending domain, own mailbox and SMTP server are for self-hosted installs; the hosted Branding tab keeps the sender name and reply-to
      { key: "documents", title: t("Documents"), items: [["documents", t("Signing")], ["templates", t("Templates")], ["appearance", t("Appearance")], ["payments", t("Payments")], ["ai", t("AI drafting")]] },
      { key: "developers", title: t("Developers"), items: [["dev", t("Overview")], ["keys", t("API keys")], ["approvals", t("Approvals")], ["webhooks", t("Webhooks")], ["apilog", t("API log")], ["emailevents", t("Email events")], ["usage", t("Usage report")], ["embedding", t("Embedding")], ["tools", t("SDKs and CLI")]] },
    ]),
  ]);
  const KEYS = $derived(AREAS.flatMap((a) => a.items.map((i) => i[0])));
  // old addresses and bookmarks: the previous Settings tabs, the Workspace screen's ("overview") and the Developers screen's ("overview", "developer")
  const LEGACY = { developer: "keys", overview: "team", email: "domains", connections: "payments", emailtemplates: "branding" };
  const start = () => { const want = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("tab") ?? "account") : "account"; const k = LEGACY[want] ?? want; return KEYS.includes(k) || k === "domains" ? k : "account"; };
  let tab = $state(start());
  // R13-D299: a member sent to a workspace area (an old link, ?tab=team) is told why they see their own account instead
  const asked = typeof location !== "undefined" ? new URLSearchParams(location.search).get("tab") : null;
  let dismissed = $state(false);
  const notYours = $derived(!dismissed && edition.rank === "member" && !!asked && !KEYS.includes(LEGACY[asked] ?? asked));
  $effect(() => { if (edition.selfHost === false && tab === "domains") { tab = "branding"; history.replaceState(null, "", "?tab=branding"); } });   // the hosted service has no Domains and email tab
  const area = $derived(AREAS.find((a) => a.items.some((i) => i[0] === tab)) ?? AREAS[0]);
  const pick = (k) => { tab = k; dismissed = true; history.replaceState(null, "", `?tab=${k}`); };
  // Phone: the areas are one sideways strip, so bring the current one into view (it can start off the right edge).
  let rail = $state();
  $effect(() => { void tab; const b = rail?.querySelector('[aria-current="page"]'); if (!b || rail.scrollWidth <= rail.clientWidth + 2 || rail.scrollHeight > rail.clientHeight + 40) return; const r = rail.getBoundingClientRect(), x = b.getBoundingClientRect(); rail.scrollTo({ left: Math.max(0, rail.scrollLeft + x.left - r.left - 24), behavior: "smooth" }); });
  const label = $derived(area.items.find((i) => i[0] === tab)?.[1] ?? t("Settings"));
</script>
<svelte:head><title>{label} · {t("Settings")} · Docustay</title></svelte:head>
<PageHeader title={t("Settings")} />
{#if notYours}<p class="mb-4 max-w-2xl text-[13px] text-mute" role="status" data-testid="settings-not-yours">{t("Team, branding, signing and developer settings are kept by an owner or an admin of this workspace. Here are your own account settings.")}</p>{/if}
<div class="grid gap-x-10 gap-y-3 sm:grid-cols-[168px_minmax(0,1fr)]">
<nav bind:this={rail} aria-label={t("Settings")} class="settings-rail sm:sticky sm:top-[68px] sm:self-start" data-testid="settings-areas">
  {#each AREAS as a (a.key)}
    <div class="rail-group">
      <button type="button" class="rail-title hidden sm:block {a.key === area.key ? 'on' : ''}" onclick={() => pick(a.items[0][0])} data-testid="settings-area-{a.key}">{a.title}</button>
      <ul>{#each a.items as [k, l] (k)}<li><button type="button" class="rail-item {tab === k ? 'on' : ''}" aria-current={tab === k ? "page" : undefined} onclick={() => pick(k)} data-testid="settings-{k}">{l}</button></li>{/each}</ul>
    </div>
  {/each}
</nav>
  <div class="min-w-0">
    {#if tab === "account"}<Page type="sections" col="28rem" row="2rem"><ProfileCard /><WelcomeEmailsSwitch /><DeletionPanel show="account" /></Page>
    {:else if tab === "notifications"}<LazyPanel load={() => import("$lib/inbox/NotificationsPanel.svelte")} />
    {:else if tab === "team"}<TeamPanel />
    {:else if tab === "security"}<LazyPanel load={() => import("$lib/SecurityPanel.svelte")} />
    {:else if tab === "domains"}<div style="min-height: 15rem"><LazyPanel load={() => import("$lib/EmailHealthPanel.svelte")} /></div><div class="mt-8" style="min-height: 57.9rem"><LazyPanel load={() => import("$lib/EmailPanel.svelte")} /></div><div class="mt-8" style="min-height: 43.8rem"><SettingsForm only={["email"]} /></div>   <!-- each panel loads on its own: the wrappers hold their final height so nothing below jumps -->
    {:else if tab === "branding"}<Page type="split" asideWidth="24rem"><div class="min-w-0"><WorkspaceNameCard /><WorkspaceLogoCard /><SettingsForm only={["branding"]} />{#if !edition.selfHost}<div class="mt-8"><SettingsForm only={["email"]} /></div>{/if}</div>{#snippet aside()}<BrandingPreview />{/snippet}</Page>
    {:else if tab === "data"}<LazyPanel load={() => import("$lib/DataPanel.svelte")} />
    {:else if tab === "audit"}<LazyPanel load={() => import("$lib/AuditPanel.svelte")} />
    {:else if tab === "documents"}<SettingsForm intro only={["sending", "teams", "test_mode", "signing", "download", "records"]} />
    {:else if tab === "templates"}<p class="mb-4 max-w-3xl text-sm text-mute" data-testid="settings-templates-intro">{t("Your own templates and the built-in library, and whether the built-in templates are shown.")}</p><SettingsForm only={["templates"]} />
    {:else if tab === "appearance"}<ThemeCards /><div class="mt-6"><SettingsForm only={["signed_copy", "certificate"]} /></div>
    {:else if tab === "payments"}<LazyPanel load={() => import("$lib/PaymentsPanel.svelte")} />
    {:else if tab === "ai"}<Page type="split" asideWidth="24rem"><div class="min-w-0"><SettingsForm only={["ai"]} reserve="30rem" /><LazyPanel load={() => import("$lib/ai/OwnKeyPanel.svelte")} /><LazyPanel load={() => import("$lib/ai/AiLogPanel.svelte")} /></div>{#snippet aside()}<section class="rounded-xl border border-line p-4" data-testid="ai-usage-card"><h2 class="mb-2 font-semibold">{t("AI usage")}</h2><LazyPanel load={() => import("$lib/ai/AiUsageBar.svelte")} /></section>{/snippet}</Page>
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
  .settings-rail { display: flex; gap: .25rem; overflow-x: auto; scrollbar-width: none; margin-inline: calc(-1 * var(--edge, 1rem)); padding-inline: var(--edge, 1rem); border-bottom: 1px solid var(--line); padding-bottom: .5rem; }
  .settings-rail .rail-group, .settings-rail ul { display: contents; }
  .rail-item { flex: none; min-height: 2.75rem; padding: 0 .65rem; border-radius: 6px; font-size: 13px; color: var(--mute); white-space: nowrap; text-align: left; }
  .rail-item:hover { color: var(--ink); background: var(--tint); }
  .rail-item.on { color: var(--accent-ink); background: var(--accent-soft); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  @media (min-width: 640px) {
    .settings-rail { display: block; overflow: visible; margin: 0; padding: 0 0 2rem; border: 0; max-height: calc(var(--main-h, 100dvh) - 8rem); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
    .settings-rail .rail-group { display: block; margin-top: 1.1rem; padding-top: .9rem; border-top: 1px solid var(--line); } .settings-rail .rail-group:first-child { margin-top: 0; padding-top: 0; border-top: 0; } .settings-rail ul { display: block; }
    /* the four main areas read as headings: small capitals in ink, the area you are in in the accent; the page you are on is a filled, bold row with an accent bar */
    .rail-title { display: block; width: 100%; text-align: left; padding: 0 .65rem; margin-bottom: .3rem; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2, var(--mute)); }
    .rail-title:hover { color: var(--ink); } .rail-title.on { color: var(--accent-ink); }
    .rail-item { display: block; width: 100%; min-height: 1.75rem; font-size: 13.5px; }
    .rail-item.on { box-shadow: inset 3px 0 0 var(--accent); }
  }
</style>
