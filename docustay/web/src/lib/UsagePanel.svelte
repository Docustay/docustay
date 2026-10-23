<script>
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { onMount } from "svelte";
  let busy = $state(false), problem = $state(null), report = $state(null), lic = $state(null);
  onMount(async () => { const r = await api("/api/product/docustay/licence-status"); if (r.ok && r.json?.selfHost) lic = r.json; });
  async function download() {
    busy = true; problem = null;
    const r = await api("/api/product/docustay/usage-report"); busy = false;
    if (!r.ok) { problem = r.error ?? t("The report could not be made."); return; }
    report = r.json;
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.json, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `docustay-usage-report-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
</script>
<div class=" space-y-4">
  {#if lic}
    <section class="space-y-2" data-testid="licence-status">
      <h2 class="text-lg font-semibold">{t("Licence")}</h2>
      <p class="text-sm" data-testid="licence-state">{#if lic.state === "valid"}{t("Pro licence checked. The held note is good until {date}.", { date: new Date(lic.until).toLocaleDateString(undefined, { dateStyle: "long" }) })}{:else if !lic.keySet}{t("No licence key is set on this install, so it runs Community.")}{:else}{t("This install has no current Pro note. It checks its key about once a month and keeps working without Pro until it does.")}{/if}</p>
      {#if lic.notice}<p class="notice warn" role="alert" data-testid="licence-shared">{t("This licence key has been used by more than one production instance in the last 60 days. One licence covers one production instance. If this is a test or staging copy, set DOCUSTAY_INSTANCE_ROLE=test on it. Nothing has been switched off.")}</p>{/if}
    </section>
  {/if}
  <h2 class="text-lg font-semibold">{t("Usage report")}</h2>
  <p class="text-sm text-mute"><Rich text={t("If this install cannot reach docustay.app (an offline or locked-down server), download this file and upload it on the <host>self-host page</host> when you can. It holds five whole numbers — documents sent this month, documents signed, workspaces, people, days running — a random install id and the version. No document, name, email or address is in it, and you can open it in any text editor to check.")} parts={{ host: { href: "/self-host", class: "underline" } }} /></p>
  <button class="btn primary" disabled={busy} onclick={download} data-testid="usage-download">{t("Download usage report")}</button>
  {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
  {#if report}<pre tabindex="0" class="overflow-auto rounded-lg bg-tint p-3 text-xs" data-testid="usage-preview">{JSON.stringify(report, null, 2)}</pre>{/if}
</div>
