<script>
  // Shown on every screen while an account or the whole workspace is waiting out its cooling-off period, so nobody is surprised and anyone who did not ask for it can stop it.
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { onMount } from "svelte";
  let st = $state(null);
  async function load() { const r = await api("/api/account/deletion"); st = r.ok ? r.json : null; }
  const onChange = (e) => { if (e?.detail && "state" in e.detail) st = e.detail.state; else load(); };   // Run 8 (R8-14): the panel hands over what it just read instead of the banner asking again
  onMount(() => { load(); addEventListener("ds-deletion", onChange); return () => removeEventListener("ds-deletion", onChange); });
</script>
{#if st?.workspace}<p class="notice bad mb-4" role="status" data-testid="deletion-banner-workspace">{t("This workspace will be deleted on {date}.", { date: whenText(st.workspace.scheduledFor, { dateStyle: "long" }) })} {#if st.isOwner}<a class="underline" href="/settings?tab=data">{t("Keep this workspace")}</a>{/if}</p>{/if}
{#if st?.account}<p class="notice bad mb-4" role="status" data-testid="deletion-banner-account">{t("Your account will be deleted on {date}.", { date: whenText(st.account.scheduledFor, { dateStyle: "long" }) })} <a class="underline" href="/settings?tab=account">{t("Keep my account")}</a></p>{/if}
