<script>
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { api } from "$lib/api.js";
  import { onMount } from "svelte";
  import { passwordIdToken, login, requestCode, codeIdToken, authConfig, customTokenIdToken, googleIdToken } from "$lib/auth.js";
  import GoogleButton from "$lib/entry/GoogleButton.svelte";
  import { passkeysSupported, passkeysEnabled, passkeyIdToken, conditionalSupported } from "$lib/passkeys.js";
  import { rememberStarter, afterAuthPath, clearStarter, markSignedIn } from "$lib/starter.js";
  import { wantedPro } from "$lib/site/wantPro.js";   // Run 9 (W3): a "Get Pro" from the website goes on to checkout after signing in
  import StarterCard from "$lib/starters/StarterCard.svelte";
  import CodeBoxes from "$lib/entry/CodeBoxes.svelte";
  import { tick } from "svelte";
  let starter = $state(rememberStarter());
  let codeOffered = $state(true);   // a password-only install (self-host, sandbox) has no emailed sign-in codes: the button is not offered
  let ssoLabel = $state(null);   // set when the install has its own OpenID Connect provider
  let selfHost = $state(false);   // a self-hosted install takes no public sign-ups: its owner comes from /setup and everyone else is invited, so no "Create an account" link
  let passkeyOffered = $state(false);
  let demoOffered = $state(false);   // Launch step 8: the hosted service offers a throw-away demo workspace
  let idleNotice = $state(false);   // Run 7: the workspace signed this person out after a period without activity   // only where the server has passkeys on and this browser can use them
  onMount(async () => {
    const q = new URLSearchParams(location.search);
    if (q.get("sso") === "failed") problem = t("That sign-in could not be completed. Use the email and password you already have, or ask an owner to invite you.");
    else if (q.get("sso") === "unavailable") problem = t("Single sign-on is not available right now.");
    if (q.get("signedout") === "idle") idleNotice = true;
    { const e = q.get("email"); if (e) email = e; }
    const m = /^#t=(.+)$/.exec(location.hash);
    if (m) { history.replaceState(null, "", "/login"); try { await done(decodeURIComponent(m[1])); } catch (err) { problem = err.message; } }
    try { const c = await api("/api/auth/oidc/config"); if (c.json?.enabled) ssoLabel = c.json.label; } catch { /* no single sign-on */ }
    try { const ac = await authConfig(); codeOffered = !ac.local; googleClient = ac.google ?? null; selfHost = ac.selfHost === true; demoOffered = ac.demo === true; } catch { /* keep the default */ } passkeyOffered = passkeysSupported() && (await passkeysEnabled());
    let justOut = false; try { justOut = sessionStorage.getItem("ds-signed-out") === "1"; sessionStorage.removeItem("ds-signed-out"); } catch { /* ignore */ }
    if (passkeyOffered && !justOut) startAutofill();   // D-040: right after an explicit Sign out the passkey waits for a click
  });
  let autofill = null;   // the autofill request, cancelled when the button is used or the page goes away
  async function startAutofill() {
    if (!(await conditionalSupported())) return;
    autofill = new AbortController();
    try { await done(await passkeyIdToken(customTokenIdToken, { conditional: true, signal: autofill.signal })); } catch { /* the background passkey offer failing (no authenticator, a cancelled prompt, an unsupported browser) is never an error banner on load; the visible passkey button reports its own */ }
  }
  async function usePasskey() { autofill?.abort(); busy = true; problem = null; try { await done(await passkeyIdToken(customTokenIdToken)); } catch (err) { problem = err.message; } finally { busy = false; startAutofill(); } }
  let stage = $state("password"), email = $state(""), password = $state(""), code = $state(""), busy = $state(false), problem = $state(null), kind = $state(null);
  let picks = $state([]), pending = null;   // R10-54: a person in more than one workspace chooses which to open (the server sends needsPracticePick + the list)
  async function done(idToken, slug = null) {
    const r = await login(idToken, slug);
    if (r?.needsPracticePick || r?.data?.needsPracticePick) { pending = idToken; picks = r.practices ?? r.data?.practices ?? []; stage = "pick"; return; }
    if (r?.requiresTwoStep || r?.data?.requiresTwoStep) { stage = "two-step"; code = ""; return; }
    markSignedIn(); await goto(wantedPro() ? "/upgrade" : afterAuthPath(), { invalidateAll: true });
  }
  async function submitTwoStep(e) { e.preventDefault(); busy = true; problem = null; const r = await api("/api/auth/two-step/verify", { method: "POST", body: { code: code.trim() } }); busy = false; if (!r.ok) { problem = r.error ?? t("That code was not accepted."); return; } markSignedIn(); await goto(wantedPro() ? "/upgrade" : afterAuthPath(), { invalidateAll: true }); }
  async function submit(e) { e.preventDefault(); busy = true; problem = null; kind = null; try { await done(await passwordIdToken(email.trim(), password)); } catch (err) { problem = err.message; kind = err.kind ?? null; } finally { busy = false; } }
  async function useCode() { problem = null; if (!email.trim()) { problem = t("Enter your email address first."); return; } try { await requestCode(email.trim()); stage = "code"; code = ""; await tick(); codeBoxes?.focus(); } catch (err) { problem = err.message; } }
  let codeBoxes, codeBad = $state(false), googleClient = $state(null);
  // Continue with Google: a person who already has a workspace is signed in; one who does not is sent to sign-up (making an account needs the agreement ticked there)
  async function withGoogle(credential) { problem = null; kind = null; busy = true; try { await done((await googleIdToken(credential)).idToken); } catch (err) { if (err?.kind === "policy") { location.assign("/signup"); return; } problem = err.message; kind = err.kind ?? null; } finally { busy = false; } }
  async function submitCode(e) { e?.preventDefault?.(); if (busy) return; busy = true; problem = null; codeBad = false; try { await done(await codeIdToken(email.trim(), code.trim())); } catch (err) { problem = err.message; codeBad = true; code = ""; await tick(); codeBoxes?.focus(); setTimeout(() => (codeBad = false), 500); } finally { busy = false; } }
</script>
<svelte:head><title>{t("Sign in")} · Docustay</title><meta name="description" content="Sign in to Docustay to send, sign and track documents." /></svelte:head>
<h1 class="text-2xl font-bold tracking-tight">{t("Sign in to Docustay")}</h1>
{#if idleNotice}<p class="notice mt-4" role="status" data-testid="login-idle">{t("You were signed out because nothing happened for a while. Sign in again to carry on.")}</p>{/if}
{#if starter}<div class="mt-4"><StarterCard slug={starter} onclear={() => { clearStarter(); starter = null; }} /></div>{/if}
{#if problem}<div class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="login-problem"><p>{problem}</p>
  {#if kind === "noworkspace" && !selfHost}<p class="mt-1"><a class="underline" href={`/signup${email ? `?email=${encodeURIComponent(email.trim())}` : ""}`}>{t("Finish creating your account")}</a></p>
  {:else if stage === "password" && (kind === "credentials" || /not accepted/.test(problem))}<p class="mt-1">{#if !selfHost}{t("No account with this email yet?")} <a class="underline" href={`/signup${email ? `?email=${encodeURIComponent(email.trim())}` : ""}`}>{t("Create one")}</a> · {/if}<a class="underline" href="/forgot">{t("Forgot your password?")}</a></p>
  {:else if kind === "limit"}<p class="mt-1"><a class="underline" href="/forgot">{t("Reset your password")}</a></p>{/if}</div>{/if}
{#if stage === "password"}
  {#if googleClient}<div class="mt-5"><GoogleButton clientId={googleClient} oncredential={withGoogle} onerror={() => (googleClient = null)} /><p class="mt-3 text-center text-xs text-mute">{t("or")}</p></div>{/if}
  <form class="mt-5 space-y-4" onsubmit={submit}>
    <div><label class="label" for="email">{t("Email")}</label><input id="email" class="field" type="email" autocomplete="username webauthn" bind:value={email} required /></div>
    <div><label class="label" for="pw">{t("Password")}</label><input id="pw" class="field" type="password" autocomplete="current-password" bind:value={password} required /></div>
    <button class="btn primary w-full" disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</button>
    {#if ssoLabel}<a class="btn w-full" href="/api/auth/oidc/start" data-testid="login-sso">{t("Sign in with")} {ssoLabel}</a>{/if}
    {#if passkeyOffered}<button type="button" class="btn w-full" onclick={usePasskey} disabled={busy} data-testid="login-passkey">{t("Sign in with a passkey")}</button><p class="text-xs text-mute">{t("A passkey uses Touch ID, Face ID or your device PIN. To add one, sign in with your password, then open Workspace → Security.")}</p>{/if}
    {#if codeOffered}<button type="button" class="btn w-full" onclick={useCode}>{t("Email me a sign-in code instead")}</button>{/if}
    <p class="text-sm"><a class="text-brand" href="/forgot">{t("Forgot your password?")}</a>{#if !selfHost}&nbsp;·&nbsp;<a class="text-brand" href="/signup">{t("Create an account")}</a>{/if}{#if demoOffered}&nbsp;·&nbsp;<a class="text-brand" href="/demo" data-testid="try-demo">{t("Try the demo")}</a>{/if}</p>
  </form>
{:else if stage === "pick"}
  <div class="mt-5 space-y-3" data-testid="login-pick">
    <p class="text-sm text-mute">{t("Workspace")} · {t("Choose one")}</p>
    {#each picks as w (w.slug)}<button type="button" class="btn w-full" disabled={busy} data-testid="login-pick-{w.slug}" onclick={async () => { busy = true; problem = null; try { await done(pending, w.slug); } catch (err) { problem = err.message; } finally { busy = false; } }}>{w.displayName}</button>{/each}
  </div>
{:else if stage === "two-step"}
  <form class="mt-5 space-y-4" onsubmit={submitTwoStep}>
    <p class="text-sm text-mute">{t("Enter the six-digit code from your authenticator app, or one of your backup codes.")}</p>
    <div><label class="label" for="ts">{t("Code")}</label><input id="ts" class="field" inputmode="numeric" autocomplete="one-time-code" bind:value={code} required data-testid="two-step-code" /></div>
    <button class="btn primary w-full" disabled={busy}>{busy ? t("Checking…") : t("Continue")}</button>
  </form>
{:else}
  <form class="mt-5 space-y-4" onsubmit={submitCode}>
    <p class="text-sm text-mute"><Rich text={t("If that address has an account, a six-digit code is on its way to <addr>{email}</addr>.", { email })} parts={{ addr: { strong: true } }} /></p>
    <div><label class="label" for="entry-code">{t("Code")}</label><CodeBoxes bind:this={codeBoxes} bind:value={code} invalid={codeBad} {busy} oncomplete={() => submitCode()} label={t("Six-digit code")} /></div>
    <button class="btn primary w-full" disabled={busy}>{busy ? t("Checking…") : t("Sign in")}</button>
    <button type="button" class="btn w-full" onclick={() => (stage = "password")}>{t("Use my password instead")}</button>
  </form>
{/if}
