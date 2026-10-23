<script>
  // Developers → Overview: where to start. The base address, three numbered steps and the reference links. Nothing here changes anything.
  // R13-D386: an at-a-glance strip first: active keys, API calls this month and the last call, and whether test mode is on (the same numbers as API keys and Usage report).
  import { t } from "$lib/i18n/index.svelte.js";
  import Icon from "$lib/ui/Icon.svelte";
  import Page from "$lib/ui/Page.svelte";
  import CopyField from "$lib/ui/CopyField.svelte";
  import StatTile from "$lib/ui/StatTile.svelte";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { edition } from "$lib/edition.svelte.js";
  let { go } = $props();
  let glance = $state(null);
  onMount(async () => {
    const days = new Date().getDate();   // this month so far
    const [k, u] = await Promise.all([api("/api/developer/api-keys"), api(`/api/product/docustay/api-usage?days=${days}`)]);
    const usage = u.ok ? (u.json?.data ?? u.json) : null;
    const last = (usage?.byKey ?? []).map((x) => x.lastAt).filter(Boolean).sort().at(-1) ?? null;
    glance = { keys: k.ok ? (k.json?.keys ?? []).filter((x) => !x.revoked_at).length : null, calls: usage?.calls ?? null, last };
  });
  const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const base = typeof location !== "undefined" ? location.origin : "https://app.docustay.app";
  const steps = $derived([["keys", "key-round", t("Make a key"), t("Start with a test key: it sends nothing real and bills nothing."), t("Open API keys")], ["webhooks", "webhook", t("Add a webhook"), t("Get a signed call when a document is sent, signed or declined."), t("Open webhooks")], ["apilog", "terminal", t("Watch the calls"), t("Every call your key makes, with its answer, for 30 days."), t("Open the API log")]]);
  const links = $derived([["/docs/quickstart", "book-open", t("Quick start"), t("Send your first document in a few lines.")], ["/api/v1/openapi.json", "file-text", t("OpenAPI file"), t("Every call, for your tools and generators.")], ["/docs/mcp-and-skills", "sparkles", t("AI agents and MCP"), t("Let an agent draft documents for you to approve.")]]);
</script>
<div data-testid="dev-overview">
<Page type="split" asideWidth="22rem" asideLabel={t("Reference")}>
  <div class="min-w-0">
    <h2 class="text-lg font-semibold">{t("Build with Docustay")}</h2>
    <p class="mt-1 text-sm text-mute">{t("Send, track and download documents from your own software, or let an AI agent draft them for you to approve.")}</p>
    <div class="mt-5 grid grid-cols-2 gap-5 rounded-xl border border-line bg-card p-4 sm:grid-cols-4" data-testid="dev-glance">
      <StatTile label={t("Active keys")} value={glance?.keys ?? "—"} />
      <StatTile label={t("API calls this month")} value={glance?.calls ?? "—"} />
      <div class="min-w-0"><div class="text-[12px] text-mute">{t("Last call")}</div><div class="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight" data-testid="dev-last-call">{glance?.last ? when(glance.last) : glance ? t("None yet") : "—"}</div></div>
      <div class="min-w-0"><div class="text-[12px] text-mute">{t("Test mode")}</div><div class="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight" data-testid="dev-test-mode">{edition.testMode ? t("On") : t("Off")}</div></div>
    </div>
    <div class="mt-5 min-w-0"><p class="label">{t("API address")}</p><CopyField value={base} /></div>
    <h3 class="mb-2 mt-8 text-[13px] font-semibold uppercase tracking-[.06em] text-mute">{t("Start here")}</h3>
    <ol class="dev-steps">{#each steps as [k, ic, h, p, open], i}<li><button type="button" class="dev-step" onclick={() => go(k)}>
      <span class="dev-num" aria-hidden="true">{i + 1}</span>
      <span class="min-w-0 flex-1"><b class="flex items-center gap-2 text-[15px]"><Icon name={ic} size={16} />{h}</b><span class="mt-0.5 block text-sm text-mute">{p}</span></span>
      <span class="dev-go">{open}<Icon name="arrow-right" size={14} /></span>
    </button></li>{/each}</ol>
  </div>
  {#snippet aside()}
    <h3 class="mb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-mute">{t("Reference")}</h3>
    <ul class="dev-links">{#each links as [href, ic, h, p]}<li><a class="dev-link" {href} target="_blank" rel="noopener"><span class="mt-0.5 text-mute"><Icon name={ic} size={18} /></span><span class="min-w-0 flex-1"><b class="block text-[14px]">{h}</b><span class="block text-sm text-mute">{p}</span></span><span class="mt-0.5 text-faint"><Icon name="external-link" size={14} /></span></a></li>{/each}</ul>
  {/snippet}
</Page>
</div>
<style>
  .dev-steps, .dev-links { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--card); }
  .dev-steps > li + li, .dev-links > li + li { border-top: 1px solid var(--line); }
  .dev-step, .dev-link { display: flex; align-items: flex-start; gap: .9rem; width: 100%; padding: .95rem 1rem; text-align: left; text-decoration: none; color: inherit; transition: background-color 120ms ease; }
  .dev-step:hover, .dev-link:hover { background: var(--tint); }
  .dev-step:focus-visible, .dev-link:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .dev-num { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-ink); font-size: 13px; font-weight: 700; }
  .dev-go { flex: none; display: inline-flex; align-items: center; gap: .3rem; align-self: center; font-size: 13px; font-weight: 500; color: var(--accent-ink); white-space: nowrap; }
  @media (max-width: 520px) { .dev-go { display: none; } }
</style>
