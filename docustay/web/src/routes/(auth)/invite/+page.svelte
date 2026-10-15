<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte.js";
  import { minPassword, previewInviteToken, acceptInviteWithPassword } from "$lib/auth.js";
  import { markSignedIn } from "$lib/starter.js";
  // A teammate's invitation (the link in the invite email). The address is fixed by the invitation; the person chooses a password (or uses the one they already have) and is signed in to the workspace.
  let token = $state(""), info = $state(null), password = $state(""), busy = $state(false), problem = $state(null), gone = $state(false);
  onMount(async () => {
    token = new URLSearchParams(location.search).get("token") ?? "";
    if (!token) { gone = true; return; }
    try { info = await previewInviteToken(token); } catch (e) { gone = true; problem = e.message; }
  });
  async function submit(e) {
    e.preventDefault(); problem = null;
    const need = await minPassword();
    if (password.length < need) { problem = need === 8 ? t("Choose a password of at least 8 characters.") : t("Choose a password of at least 6 characters."); return; }
    busy = true;
    try { await acceptInviteWithPassword({ token, email: info.email, password }); markSignedIn(); await goto("/documents", { invalidateAll: true }); }
    catch (err) { problem = err.message; } finally { busy = false; }
  }
</script>
<svelte:head><title>{t("Join your team")} · Docustay</title></svelte:head>
{#if gone}
  <h1 class="text-2xl font-bold tracking-tight">{t("This link isn't working")}</h1>
  <p class="mt-2 text-sm text-mute" data-testid="invite-gone">{problem ?? t("This invitation is no longer valid. It may have already been used, expired, or been cancelled.")}</p>
  <p class="mt-4 text-sm"><a class="text-brand" href="/login">{t("Sign in")}</a></p>
{:else if info}
  <h1 class="text-2xl font-bold tracking-tight">{t("Join {name} on Docustay", { name: info.practiceName })}</h1>
  <p class="mt-2 text-sm text-mute" data-testid="invite-about">{t("{who} invited you as {role}.", { who: info.inviterName, role: info.role === "admin" ? t("an admin") : t("a member") })}</p>
  {#if problem}<p class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem}</p>{/if}
  <form class="mt-5 space-y-4" onsubmit={submit} data-testid="invite-form">
    <div><label class="label" for="ie">{t("Email")}</label><input id="ie" class="field" type="email" value={info.email} readonly /></div>
    <div><label class="label" for="ip">{t("Choose a password")}</label><input id="ip" class="field" type="password" autocomplete="new-password" bind:value={password} required data-testid="invite-password" /><p class="mt-1 text-xs text-mute">{t("Already have a Docustay account with this email? Enter its password instead.")}</p></div>
    <button class="btn primary w-full" disabled={busy} data-testid="invite-accept">{busy ? t("Joining…") : t("Join")}</button>
  </form>
{:else}
  <p class="text-sm text-mute" role="status">{t("Loading…")}</p>
{/if}
