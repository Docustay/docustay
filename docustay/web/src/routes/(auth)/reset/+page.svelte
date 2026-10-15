<script>
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { finishReset, minPassword } from "$lib/auth.js";
  import PasswordField from "$lib/PasswordField.svelte";
  let pw = $state(""), done = $state(false), busy = $state(false), problem = $state(null), minPw = $state(6);
  onMount(async () => { try { minPw = await minPassword(); } catch { /* the usual length shows */ } });
  const oob = $derived(page.url.searchParams.get("oobCode"));
  async function submit(e) { e.preventDefault(); problem = null; if (pw.length < minPw) { problem = minPw === 8 ? t("Choose a password of at least 8 characters.") : t("Choose a password of at least 6 characters."); return; } busy = true; try { await finishReset(oob, pw); done = true; } catch (err) { problem = err.message; } finally { busy = false; } }
</script>
<svelte:head><title>{t("Choose a new password")} · Docustay</title></svelte:head>
<h1 class="text-2xl font-bold tracking-tight">{t("Choose a new password")}</h1>
{#if done}<p class="mt-4">{t("Your password is changed.")}</p><p class="mt-4"><a class="btn primary" href="/login">{t("Sign in")}</a></p>
{:else if !oob}<p class="mt-4 text-[15px]"><Rich text={t("This link is incomplete. <ask>Ask for a new one</ask>.")} parts={{ ask: { href: "/forgot", class: "text-brand" } }} /></p>
{:else}
  {#if problem}<p class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem} {#if /new one|new link/.test(problem)}<a class="underline" href="/forgot">{t("Ask for a new link")}</a>{/if}</p>{/if}
  <form class="mt-5 space-y-4" onsubmit={submit}><PasswordField id="p" label={t("New password")} min={minPw} bind:value={pw} /><button class="btn primary w-full" disabled={busy}>{busy ? t("Saving…") : t("Save password")}</button></form>
{/if}
