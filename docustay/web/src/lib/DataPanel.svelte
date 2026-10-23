<script>
  // D-025: Platform → Data holds what a person expects under that name: taking your data with you. The offline usage report belongs to a self-hosted install and appears only there.
  import { t } from "$lib/i18n/index.svelte.js";
  import { edition, loadEdition } from "$lib/edition.svelte.js";
  import { onMount } from "svelte";
  import UsagePanel from "$lib/UsagePanel.svelte";
  import { api } from "$lib/api.js";
  import DeletionPanel from "$lib/DeletionPanel.svelte";
  import PrivacyRequestsPanel from "$lib/PrivacyRequestsPanel.svelte";
  let wsName = $state("");
  onMount(async () => { loadEdition(); const r = await api("/api/nav"); const d = r.ok ? (r.json?.data ?? r.json) : null; wsName = d?.tenant?.name ?? ""; });
</script>
<div class="pg-sections" style="--col: 28rem; --row: 2rem">
<div class="space-y-4">
  <h2 class="text-lg font-semibold">{t("Your data")}</h2>
  <p class="text-sm text-mute">{t("Download every signed document with its certificate as one zip file. Only an owner or admin can do this.")}</p>
  <a data-sveltekit-reload class="btn primary" href="/api/documents/pdf/export.zip" data-testid="export-all">{t("Download everything")}</a>
</div>
<PrivacyRequestsPanel />
<DeletionPanel {wsName} show="workspace" />
{#if edition.selfHost}<div class="pg-wide"><UsagePanel /></div>{/if}
</div>
