<script>
  import { t } from "$lib/i18n/index.svelte.js";
  import { requestReset } from "$lib/auth.js";
  let email = $state(""), sent = $state(false), busy = $state(false), problem = $state(null);
  async function submit(e) { e.preventDefault(); busy = true; problem = null; try { await requestReset(email.trim()); sent = true; } catch (err) { problem = err.message; } finally { busy = false; } }
</script>
<svelte:head><title>{t("Reset your password")} · Docustay</title></svelte:head>
<h1 class="text-2xl font-bold tracking-tight">{t("Reset your password")}</h1>
{#if sent}
  <p class="mt-4 text-[15px]">{t("If that address has an account, an email with a link is on its way. The link works once and expires soon.")}</p><p class="mt-4 text-sm"><a class="text-brand" href="/login">{t("Back to sign in")}</a></p>
{:else}
  {#if problem}<p class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem}</p>{/if}
  <form class="mt-5 space-y-4" onsubmit={submit}>
    <div><label class="label" for="e">{t("Email")}</label><input id="e" class="field" type="email" autocomplete="email" bind:value={email} required /></div>
    <button class="btn primary w-full" disabled={busy}>{busy ? t("Sending…") : t("Send me a link")}</button>
    <p class="text-sm"><a class="text-brand" href="/login">{t("Back to sign in")}</a></p>
  </form>
{/if}
