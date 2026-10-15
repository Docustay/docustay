<script>
  // LAUNCH step 3 · Settings → Account: the person's own switch for the four welcome emails of their first week. Reads and writes through the one route; shown only to someone who has the series (older accounts have none).
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let pref = $state(null), busy = $state(false), problem = $state(null);
  onMount(async () => { const r = await api("/api/product/docustay/welcome-emails", { method: "POST", body: {} }); if (r.ok) pref = r.json; });
  async function flip() {
    busy = true; problem = null;
    const r = await api("/api/product/docustay/welcome-emails", { method: "POST", body: { emails: !pref.emails } });
    busy = false;
    if (r.ok) pref = r.json; else problem = t("That could not be saved. Try again.");
  }
</script>
{#if pref?.enrolled}
<section class="mt-8 rounded-xl border border-line p-4" data-testid="welcome-emails">
  <h3 class="text-sm font-semibold">{t("Welcome emails")}</h3>
  <p class="mt-1 text-sm text-mute">{t("Up to four short emails in your first week, with the next step to take. Each has an unsubscribe link.")}</p>
  <label class="mt-3 flex items-center gap-2.5 text-sm"><input type="checkbox" checked={pref.emails} onchange={flip} disabled={busy} data-testid="welcome-emails-toggle" /><span>{pref.emails ? t("Send me the welcome emails") : t("The welcome emails are off")}</span></label>
  {#if problem}<p class="mt-2 text-sm text-bad" role="alert">{problem}</p>{/if}
</section>
{/if}
