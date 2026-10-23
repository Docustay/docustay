<script>
  // Embedding: which websites may frame a signing form (a setting the server enforces), and a snippet builder so the first embed takes a minute.
  import SettingsForm from "$lib/SettingsForm.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  // D-100: the snippets point at the address this workspace is served from (the hosted service, a sandbox, or a self-hosted install), not at a fixed website
  const base = typeof location !== "undefined" ? location.origin : "https://docustay.app";
  let origin = $state("https://app.example.com"), seat = $state("signer_1"), copied = $state(null);
  const safe = $derived(/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin.trim()) || /^http:\/\/localhost(:\d+)?$/i.test(origin.trim()));
  const server = $derived(`curl -X POST ${base}/api/v1/documents/DOCUMENT_ID/embed-session \\
  -H "Authorization: Bearer $DOCUSTAY_API_KEY" -H "Content-Type: application/json" \\
  -d '{ "seat": "${seat.trim() || "signer_1"}", "origin": "${origin.trim()}" }'`);
  const page = $derived(`<script type="module" src="${base}/embed/index.js"><\/script>\n<docustay-sign url="URL_FROM_THE_ANSWER" height="720"></docustay-sign>`);
  async function copy(k, text) { try { await navigator.clipboard.writeText(text); copied = k; setTimeout(() => (copied = null), 1800); } catch { copied = null; } }
</script>
<div class=" space-y-6">
  <section><h2 class="text-xl font-semibold">{t("Embedding")}</h2><p class="mt-1 text-sm text-mute">{t("Show the signing form inside your own website or app. Only the websites you list below can frame it, and the form only talks to them. Embedding is included in every plan.")}</p></section>
  <SettingsForm only={["embed"]} bare />
  <section><h3 class="text-lg font-semibold">{t("Snippet builder")}</h3>
    <div class="card mt-2 space-y-3 p-4">
      <div class="grid gap-3 sm:grid-cols-2"><div><label class="label" for="eo">{t("Your website")}</label><input id="eo" class="field" bind:value={origin} /></div><div><label class="label" for="es">{t("Seat to embed")}</label><input id="es" class="field" bind:value={seat} /></div></div>
      {#if !safe}<p class="notice warn">{t("Use the exact address of your site, starting https:// (no path).")}</p>{/if}
      <div><div class="mb-1 flex items-center"><span class="label !mb-0">{t("1. On your server, ask for a session")}</span><button class="btn quiet ml-auto !min-h-8 !px-2" onclick={() => copy("s", server)}>{copied === "s" ? t("Copied") : t("Copy")}</button></div><pre tabindex="0" class="overflow-x-auto rounded-lg bg-tint p-3 text-xs" data-testid="embed-server">{server}</pre></div>
      <div><div class="mb-1 flex items-center"><span class="label !mb-0">{t("2. On your page, show it")}</span><button class="btn quiet ml-auto !min-h-8 !px-2" onclick={() => copy("p", page)}>{copied === "p" ? t("Copied") : t("Copy")}</button></div><pre tabindex="0" class="overflow-x-auto rounded-lg bg-tint p-3 text-xs" data-testid="embed-page">{page}</pre></div>
      <p class="text-xs text-mute"><Rich text={t("The full guide, with events and the React, Vue and Angular wrappers, is in the <dev>developer docs</dev>.")} parts={{ dev: { href: "/developers", class: "text-brand underline" } }} /></p>
    </div></section>
</div>
