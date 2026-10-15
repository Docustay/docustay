<script>
  // LAUNCH step 3: the page the unsubscribe link in a welcome email opens. It posts the token and says the same thing whatever the token was, so nothing can be learned by guessing.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, startLang } from "$lib/i18n/index.svelte.js";
  import Logo from "$lib/Logo.svelte";
  let state = $state("working");
  onMount(async () => {
    startLang();
    const token = new URLSearchParams(location.search).get("t");
    try { const r = await api("/api/lifecycle/unsubscribe", { method: "POST", body: { token } }); state = r.ok ? "done" : "error"; } catch { state = "error"; }
  });
</script>
<svelte:head><title>{t("Unsubscribe")} · Docustay</title><meta name="robots" content="noindex" /></svelte:head>
<main style="min-height:100vh;display:grid;place-items:center;padding:24px">
  <div style="max-width:26rem;text-align:center" data-testid="unsubscribe">
    <div style="display:inline-block;margin-bottom:18px"><Logo /></div>
    {#if state === "working"}<p class="text-sm text-mute" role="status">{t("One moment…")}</p>
    {:else if state === "done"}<h1 class="text-xl font-bold">{t("You are unsubscribed")}</h1><p class="mt-2 text-sm text-mute">{t("We will not send you the welcome emails again. Emails about your documents and your account are not affected.")}</p>
    {:else}<h1 class="text-xl font-bold">{t("That did not work")}</h1><p class="mt-2 text-sm text-mute">{t("Try the link again in a moment, or turn the emails off in Settings, My account.")}</p>{/if}
  </div>
</main>
