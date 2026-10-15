<script>
  // First-run setup of a SELF-HOSTED install: the owner is created once, with the install's own setup token (the KEYSTONE_SETUP_TOKEN value in its .env). Shown to the person who installed it, so it is plain English.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { passwordIdToken, login } from "$lib/auth.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let state = $state("loading"), setupToken = $state(""), orgName = $state(""), email = $state(""), password = $state(""), busy = $state(false), problem = $state(null);
  const timezone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
  onMount(async () => {
    const r = await api("/api/setup/state");
    if (r.status === 404) state = "not-selfhost"; else if (!r.ok) state = "down"; else state = (r.json?.needsSetup ? "needed" : "done");
  });
  async function submit(e) {
    e.preventDefault(); problem = null;
    if (password.length < 8) { problem = t("Choose a password of at least 8 characters."); return; }
    busy = true;
    try {
      const r = await api("/api/setup/owner", { method: "POST", body: { setupToken: setupToken.trim(), orgName: orgName.trim(), email: email.trim(), password, timezone } });
      if (!r.ok) { problem = r.error ?? t("Setup did not complete. Check the setup token and try again."); return; }
      const r2 = await login(await passwordIdToken(email.trim(), password));
      if (r2?.requiresTwoStep || r2?.data?.requiresTwoStep) { await goto("/login"); return; }
      await goto("/documents", { invalidateAll: true });
    } catch (err) { problem = err.message; } finally { busy = false; }
  }
</script>
<svelte:head><title>{t("Set up Docustay")}</title></svelte:head>
<h1 class="text-2xl font-bold tracking-tight">{t("Set up Docustay")}</h1>
{#if state === "loading"}<p class="mt-4 text-mute">{t("Checking this install…")}</p>
{:else if state === "down"}<p class="mt-4" role="alert">{t("The service behind this page did not answer. Give it a minute after “docker compose up”, then reload.")}</p>
{:else if state === "not-selfhost"}<p class="mt-4">{t("This is not a self-hosted install, so there is nothing to set up here.")} <a class="text-brand" href="/login">{t("Sign in")}</a></p>
{:else if state === "done"}<p class="mt-4">{t("This install is already set up.")} <a class="btn primary" href="/login">{t("Sign in")}</a></p>
{:else}
  <p class="mt-3 text-[15px] text-mute">{t("Create the owner account for this install. The setup token is the KEYSTONE_SETUP_TOKEN value in the .env file next to docker-compose.yml. This page works once.")}</p>
  {#if problem}<p class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem}</p>{/if}
  <form class="mt-5 space-y-4" onsubmit={submit}>
    <div><label class="label" for="tok">{t("Setup token")}</label><input id="tok" class="field" type="password" autocomplete="off" bind:value={setupToken} required /></div>
    <div><label class="label" for="org">{t("Organisation name")}</label><input id="org" class="field" autocomplete="organization" bind:value={orgName} required /></div>
    <div><label class="label" for="em">{t("Your email")}</label><input id="em" class="field" type="email" autocomplete="email" bind:value={email} required /></div>
    <div><label class="label" for="pw">{t("Password")}</label><input id="pw" class="field" type="password" autocomplete="new-password" minlength="8" bind:value={password} required /></div>
    <button class="btn primary w-full" disabled={busy}>{busy ? t("Creating…") : t("Create the owner account")}</button>
  </form>
{/if}
