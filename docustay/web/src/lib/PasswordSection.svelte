<script>
  // Settings -> Security -> "Password": change the one you have, or set one if you only ever signed in with emailed codes. Open to every role (it is your own sign-in).
  // Two-step, when it is on, is asked before the change is made (askProof from the Security panel). After the change: a security email, remembered devices forgotten, other devices optionally signed out.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Dialog from "$lib/ui/Dialog.svelte";
  import { toast } from "$lib/ui/toast.js";
  import PasswordField from "$lib/PasswordField.svelte";
  import CodeBoxes from "$lib/entry/CodeBoxes.svelte";
  import { MIN_PASSWORD } from "$lib/auth.js";
  let { askProof, onchanged = () => {} } = $props();
  let st = $state(null), open = $state(false), cur = $state(""), pw = $state(""), others = $state(true), useCode = $state(false), code = $state(""), codeSent = $state(false);
  let busy = $state(false), problem = $state(null), bad = $state(false), boxes = $state(null);
  // hasPassword: true / false when the identity provider can say, null when it cannot (then the form offers both: current password, or an emailed code)
  const has = $derived(st?.hasPassword);
  const setting = $derived(has === false);
  const byCode = $derived(setting || useCode);
  async function load() { const r = await api("/api/auth/password/status"); st = r.ok ? r.json : { hasPassword: null, twoStep: false }; }
  onMount(load);
  function show() { cur = ""; pw = ""; code = ""; useCode = false; codeSent = false; problem = null; bad = false; others = true; open = true; }
  async function sendCode() {
    busy = true; problem = null;
    const r = await api("/api/auth/password/request-code", { method: "POST", body: {} });
    busy = false; if (!r.ok) { problem = r.error; return; }
    codeSent = true; queueMicrotask(() => boxes?.focus());
  }
  async function submit(e) {
    e?.preventDefault(); if (busy) return; problem = null; bad = false;
    if (pw.length < MIN_PASSWORD) { problem = t("Choose a password of at least 8 characters."); return; }
    if (byCode && code.length !== 6) { problem = t("Enter the six-digit code we emailed you."); return; }
    if (!byCode && !cur) { problem = t("Enter your current password."); return; }
    const body = { newPassword: pw, signOutOthers: others, ...(byCode ? { code } : { currentPassword: cur }) };
    busy = true;
    const err = await askProof(setting ? t("Set your password") : t("Change your password"), async (proof) => {
      const r = await api("/api/auth/password/change", { method: "POST", body: { ...body, proof } });
      return r.ok ? null : r.error ?? t("Something went wrong. Try again.");
    }, { description: t("Enter a current code to confirm it's you."), label: setting ? t("Set password") : t("Change password") });
    busy = false;
    if (err) { if (err !== "cancelled") { problem = err; bad = true; if (byCode) code = ""; } return; }
    open = false; toast(setting ? t("Your password is set") : t("Your password was changed")); await load(); onchanged();
  }
</script>
<section data-testid="password-section"><h2 class="text-lg font-semibold">{t("Password")}</h2>
  <p class="mt-1 text-sm text-mute">{setting ? t("You sign in with emailed codes. You can also set a password, so you can sign in without waiting for an email.") : t("Change the password you sign in with. We email you to say it was changed.")}</p>
  <button class="btn mt-3" onclick={show} disabled={!st} data-testid="password-open">{setting ? t("Set a password") : t("Change password")}</button>
</section>
<Dialog bind:open title={setting ? t("Set a password") : t("Change password")} testid="password-dialog">
  <form class="space-y-4" onsubmit={submit}>
    {#if byCode}
      <div>
        <p class="text-sm text-mute">{t("We will email a six-digit code to confirm it's you.")}</p>
        {#if !codeSent}<button type="button" class="btn mt-2" onclick={sendCode} disabled={busy} data-testid="password-send-code">{t("Email me a code")}</button>
        {:else}<div class="mt-2"><label class="label" for="pw-code">{t("Code")}</label><CodeBoxes bind:this={boxes} bind:value={code} id="pw-code" invalid={bad} {busy} label={t("Six-digit code")} oncomplete={() => {}} /></div>
          <button type="button" class="mt-2 text-sm text-brand underline" onclick={sendCode} disabled={busy}>{t("Send a new code")}</button>{/if}
      </div>
    {:else}
      <div><label class="label" for="pw-cur">{t("Current password")}</label><input id="pw-cur" class="field" type="password" autocomplete="current-password" bind:value={cur} data-testid="password-current" /></div>
    {/if}
    {#if !byCode || codeSent}
      <PasswordField id="pw-new" label={t("New password")} min={MIN_PASSWORD} bind:value={pw} />
      <label class="flex items-start gap-2 text-sm"><input type="checkbox" class="mt-1" bind:checked={others} data-testid="password-signout-others" /><span>{t("Sign me out on my other devices")}<span class="block text-xs text-mute">{t("Remembered devices are always forgotten, so two-step is asked again on them.")}</span></span></label>
    {/if}
    {#if problem}<p class="notice bad" role="alert" data-testid="password-problem">{problem}</p>{/if}
    <div class="flex flex-wrap items-center justify-between gap-2">
      {#if has === null && !useCode}<button type="button" class="text-sm underline" onclick={() => { useCode = true; problem = null; }} data-testid="password-use-code">{t("I do not know my current password")}</button>{:else if has === null && useCode}<button type="button" class="text-sm underline" onclick={() => { useCode = false; problem = null; }}>{t("Use my current password instead")}</button>{:else}<span></span>{/if}
      <button class="btn primary" disabled={busy || (byCode && !codeSent)} data-testid="password-save">{busy ? t("Saving…") : setting ? t("Set password") : t("Change password")}</button>
    </div>
  </form>
</Dialog>
