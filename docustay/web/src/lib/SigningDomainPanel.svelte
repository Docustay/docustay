<script>
  // SIGNING LINKS ON YOUR OWN DOMAIN (Pro, `own_signing_domain`). Run 8 found the routes (/api/domains, QUEUE §25.4) had no Docustay screen at all, so a Pro workspace could not set one.
  // Add an address such as sign.yourcompany.com, add the DNS records shown (or they go in by themselves for a domain the service holds), and the screen moves it forward until it is live;
  // from then on every signing link uses it. Up to 3 addresses. On Free the panel wears the one Pro lock; an address already live keeps working if Pro lapses.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import ProLock from "$lib/pro/ProLock.svelte";
  import CopyButton from "$lib/ui/CopyButton.svelte";
  let data = $state(null), host = $state(""), busy = $state(false), problem = $state(null), timer = null;
  const load = async () => { const r = await api("/api/domains"); if (r.ok) data = r.json?.data ?? r.json; else if (r.status !== 403) problem = r.error ?? t("The addresses could not be loaded."); };
  onMount(() => { load(); timer = setInterval(() => { if (data?.domains?.some((d) => d.status === "pending" || d.status === "verifying")) load(); }, 10_000); return () => clearInterval(timer); });
  async function add(e) { e.preventDefault(); busy = true; problem = null; const r = await api("/api/domains", { method: "POST", body: { hostname: host.trim() } }); busy = false; if (r.ok) { host = ""; await load(); } else problem = r.error ?? t("That address could not be added."); }
  async function check(d) { busy = true; const r = await api("/api/domains/check", { method: "POST", body: { id: d.id } }); busy = false; if (!r.ok) problem = r.error ?? ""; await load(); }
  async function remove(d) { busy = true; const r = await api("/api/domains/remove", { method: "POST", body: { id: d.id } }); busy = false; if (!r.ok) problem = r.error ?? ""; await load(); }
  const STATUS = $derived({ pending: t("Waiting for DNS"), verifying: t("Checking"), live: t("Live"), failed: t("Needs attention") });
  const list = $derived((data?.domains ?? []).filter((d) => d.status !== "removed"));
</script>
<section class="grid gap-3" data-testid="signing-domain">
  <div><h2 class="text-lg font-semibold">{t("Signing links on your own domain")}</h2><p class="text-sm text-mute">{t("Signers open their link at an address of yours, such as sign.yourcompany.com, instead of a Docustay address.")}</p></div>
  {#if list.length}
    <ul class="grid gap-2">{#each list as d (d.id)}
      <li class="grid gap-2 rounded-xl border border-line p-3" data-testid="signing-domain-row" data-status={d.status}>
        <div class="flex flex-wrap items-center gap-2"><span class="font-mono text-sm">{d.hostname}</span><span class="chip !min-h-0 {d.status === 'live' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'}">{STATUS[d.status] ?? d.status}</span>
          <span class="ml-auto flex gap-1.5">{#if d.status !== "live"}<button class="btn !py-1" disabled={busy} onclick={() => check(d)}>{t("Check now")}</button>{/if}<button class="btn quiet !py-1" disabled={busy} onclick={() => remove(d)} data-testid="signing-domain-remove">{t("Remove")}</button></span></div>
        {#if d.status !== "live" && d.records?.length}
          <p class="text-sm text-mute">{d.dnsMode === "porkbun" ? t("These records were added for you. It can take a few minutes.") : t("Add these records where your domain's DNS is managed:")}</p>
          <div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead class="text-xs text-mute"><tr><th class="pr-3">{t("Type")}</th><th class="pr-3">{t("Name")}</th><th>{t("Value")}</th></tr></thead><tbody>{#each d.records as rec}<tr><td class="pr-3 font-mono">{rec.type}</td><td class="pr-3 font-mono">{rec.name}</td><td class="font-mono break-all">{rec.value} <CopyButton value={rec.value} /></td></tr>{/each}</tbody></table></div>
        {/if}
        {#if d.lastError}<p class="text-sm text-warn">{d.lastError}</p>{/if}
      </li>{/each}</ul>
  {/if}
  <ProLock item="own_signing_domain" tip={t("Signing links on your own domain are part of Pro.")}>
    {#snippet children(locked)}
      <form class="flex flex-wrap gap-2" onsubmit={add}><input class="field !w-72 !py-1.5" placeholder="sign.yourcompany.com" bind:value={host} aria-label={t("Address")} disabled={locked} required maxlength="253" data-testid="signing-domain-host" /><button class="btn primary" disabled={busy || locked || !host.trim()} data-testid="signing-domain-add">{t("Add address")}</button></form>
    {/snippet}
  </ProLock>
  {#if data && data.configured === false}<p class="text-sm text-mute">{t("Custom addresses are not switched on for this install.")}</p>{/if}
  {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
</section>
