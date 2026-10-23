<script>
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { onDestroy } from "svelte";
  import { requestReset, checkResetCode, setPasswordWithGrant, MIN_PASSWORD } from "$lib/auth.js";
  import CodeBoxes from "$lib/entry/CodeBoxes.svelte";
  import PasswordField from "$lib/PasswordField.svelte";
  // Forgot your password: email -> six-digit code -> choose a new password -> done. The same answer for every address; the code is never in a URL.
  // The link in the same email still works (it opens /reset) for a person reading it on another device.
  const WAIT = 30;   // seconds before "Send a new code" is offered
  let step = $state("email"), email = $state(""), code = $state(""), pw = $state(""), grant = $state(null);
  let busy = $state(false), problem = $state(null), bad = $state(false), expired = $state(false), wait = $state(0), boxes = $state(null);
  let timer = null;
  const tick = () => { clearInterval(timer); wait = WAIT; timer = setInterval(() => { wait = Math.max(0, wait - 1); if (wait === 0) clearInterval(timer); }, 1000); };
  onDestroy(() => clearInterval(timer));
  async function send(e) {
    e?.preventDefault(); if (busy) return; busy = true; problem = null;
    try { await requestReset(email.trim()); step = "code"; code = ""; bad = false; expired = false; tick(); queueMicrotask(() => boxes?.focus()); }
    catch (err) { problem = err.message; } finally { busy = false; }
  }
  async function check() {
    if (busy || code.length !== 6) return; busy = true; problem = null; bad = false;
    try { grant = await checkResetCode(email.trim(), code); step = "password"; }
    catch (err) { problem = err.message; bad = true; expired = err.kind === "expired"; code = ""; if (!expired) queueMicrotask(() => boxes?.focus()); }
    finally { busy = false; }
  }
  async function save(e) {
    e.preventDefault(); problem = null;
    if (pw.length < MIN_PASSWORD) { problem = t("Choose a password of at least 8 characters."); return; }
    busy = true;
    try { await setPasswordWithGrant(email.trim(), grant, pw); step = "done"; pw = ""; grant = null; }
    catch (err) { problem = err.message; if (err.kind === "expired") { step = "code"; code = ""; expired = true; } } finally { busy = false; }
  }
  async function again() { if (wait > 0) return; await send(); }
</script>
<svelte:head><title>{t("Reset your password")} · Docustay</title></svelte:head>
{#if step === "email"}
  <h1 class="text-2xl font-bold tracking-tight">{t("Reset your password")}</h1>
  <p class="mt-2 text-sm text-mute">{t("Enter your email and we will send you a six-digit code.")}</p>
  {#if problem}<p class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem}</p>{/if}
  <form class="mt-5 space-y-4" onsubmit={send}>
    <div><label class="label" for="e">{t("Email")}</label><input id="e" class="field" type="email" autocomplete="email" bind:value={email} required data-testid="forgot-email" /></div>
    <button class="btn primary w-full" disabled={busy} data-testid="forgot-send">{busy ? t("Sending…") : t("Send me a code")}</button>
    <p class="text-sm"><a class="text-brand" href="/login">{t("Back to sign in")}</a></p>
  </form>
{:else if step === "code"}
  <h1 class="text-2xl font-bold tracking-tight">{t("Enter your code")}</h1>
  <p class="mt-2 text-sm text-mute"><Rich text={t("If that address has an account, a six-digit code is on its way to <addr>{email}</addr>. It works once and expires in 10 minutes.", { email })} parts={{ addr: { strong: true } }} /></p>
  <form class="mt-5 space-y-4" onsubmit={(e) => { e.preventDefault(); check(); }}>
    <div><label class="label" for="forgot-code">{t("Code")}</label><CodeBoxes bind:this={boxes} bind:value={code} id="forgot-code" invalid={bad} {busy} oncomplete={check} label={t("Six-digit code")} /></div>
    {#if problem}<p class="rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="forgot-problem">{expired ? t("That code has expired or is no longer valid. Ask for a new one.") : t("That code was not accepted. Check it and try again.")}</p>{/if}
    <button class="btn primary w-full" disabled={busy || code.length !== 6} data-testid="forgot-check">{busy ? t("Checking…") : t("Continue")}</button>
    <p class="text-sm">
      <button type="button" class="text-brand underline disabled:no-underline disabled:opacity-60" disabled={wait > 0 || busy} onclick={again} data-testid="forgot-resend">{wait > 0 ? t("Send a new code in {n}s", { n: wait }) : t("Send a new code")}</button>
      &nbsp;·&nbsp;<button type="button" class="text-brand underline" onclick={() => { step = "email"; problem = null; }}>{t("Use a different address")}</button>
    </p>
  </form>
{:else if step === "password"}
  <h1 class="text-2xl font-bold tracking-tight">{t("Choose a new password")}</h1>
  {#if problem}<p class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{problem}</p>{/if}
  <form class="mt-5 space-y-4" onsubmit={save}>
    <PasswordField id="np" label={t("New password")} bind:value={pw} />
    <p class="text-xs text-mute">{t("You will be signed out everywhere and asked to sign in again. If you use two-step sign-in, you will still be asked for it.")}</p>
    <button class="btn primary w-full" disabled={busy} data-testid="forgot-save">{busy ? t("Saving…") : t("Save password")}</button>
  </form>
{:else}
  <h1 class="text-2xl font-bold tracking-tight" data-testid="forgot-done">{t("Your password is changed")}</h1>
  <p class="mt-3 text-[15px]">{t("You have been signed out on every device, and we sent you an email to say so. Sign in with your new password.")}</p>
  <p class="mt-5"><a class="btn primary w-full" href="/login" data-testid="forgot-signin">{t("Sign in")}</a></p>
{/if}
