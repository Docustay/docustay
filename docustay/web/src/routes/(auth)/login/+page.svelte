<script>
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { api } from "$lib/api.js";
  import { onMount } from "svelte";
  import { passwordIdToken, login, requestCode, codeIdToken, authConfig, customTokenIdToken, googleIdToken } from "$lib/auth.js";
  import GoogleButton from "$lib/entry/GoogleButton.svelte";
  import { passkeysSupported, passkeysEnabled, passkeyIdToken, conditionalSupported, secondStepWithPasskey } from "$lib/passkeys.js";
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
    // R13-D007: someone who is already signed in and clicks "Sign in" (the site's menu, a bookmark) goes straight to their workspace instead of a sign-in form
    else if (!q.get("email") && !q.get("sso") && !q.get("signedout")) { try { const me = await api("/api/account/profile"); if (me.ok) { await goto(wantedPro() ? "/upgrade" : afterAuthPath(), { replaceState: true }); return; } } catch { /* not signed in */ } }
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
  let usePw = $state(false);   // email first: "Continue" asks for an emailed code, or, where there are no codes, opens the password; "Use a password instead" opens it too
  const askPw = $derived(usePw || selfHost);   // a self-hosted install has no emailed codes and asks for the password at once; the hosted service (and the sandbox) is email first
  const next = async () => { if (codeOffered) await useCode(); else { usePw = true; await tick(); document.getElementById("pw")?.focus(); } };
  let stage = $state("password"), email = $state(""), password = $state(""), code = $state(""), busy = $state(false), problem = $state(null), kind = $state(null);
  let picks = $state([]), pending = null;   // R10-54: a person in more than one workspace chooses which to open (the server sends needsPracticePick + the list)
  async function done(idToken, slug = null) {
    const r = await login(idToken, slug);
    if (r?.needsPracticePick || r?.data?.needsPracticePick) { pending = idToken; picks = r.practices ?? r.data?.practices ?? []; stage = "pick"; return; }
    if (r?.requiresTwoStep || r?.data?.requiresTwoStep) { await openSecondStep(); return; }
    markSignedIn(); await goto(wantedPro() ? "/upgrade" : afterAuthPath(), { invalidateAll: true });
  }
  // the second step: passkey or security key first (when they have one), then the authenticator app's code, then a recovery code; always a way to try another and a way out
  let opts = $state({ passkey: false, authenticatorApp: false, recovery: false }), way = $state("code"), remember = $state(false), tsBad = $state(false), tsBoxes;
  async function openSecondStep() {
    stage = "two-step"; code = ""; problem = null; tsBad = false;
    const r = await api("/api/auth/two-step/options");
    opts = r.ok ? r.json : { passkey: false, authenticatorApp: true, recovery: true };
    const keyOk = opts.passkey && passkeysSupported();
    way = keyOk ? "passkey" : opts.authenticatorApp ? "code" : "recovery";
    await tick(); if (way === "code") tsBoxes?.focus();
  }
  async function finishSignIn() { markSignedIn(); await goto(wantedPro() ? "/upgrade" : afterAuthPath(), { invalidateAll: true }); }
  async function tsPasskey() { busy = true; problem = null; try { await secondStepWithPasskey({ remember }); await finishSignIn(); } catch (err) { problem = err.message; } finally { busy = false; } }
  async function submitTwoStep(e) {
    e?.preventDefault?.(); if (busy) return;
    busy = true; problem = null; tsBad = false;
    const r = await api("/api/auth/two-step/verify", { method: "POST", body: { code: code.trim(), remember } });
    busy = false;
    if (!r.ok) { problem = r.status === 429 ? r.error : way === "recovery" ? t("That recovery code did not work. Check it and try again.") : t("That code did not match. Check your app and try the next code."); tsBad = true; code = ""; await tick(); tsBoxes?.focus(); return; }
    await finishSignIn();
  }
  const otherWay = (w) => { way = w; problem = null; code = ""; tsBad = false; tick().then(() => tsBoxes?.focus()); };
  async function notYou() { await api("/api/auth/logout", { method: "POST", body: {} }); stage = "password"; code = ""; problem = null; }
  async function submit(e) { e.preventDefault(); busy = true; problem = null; kind = null; try { await done(await passwordIdToken(email.trim(), password)); } catch (err) { problem = err.message; kind = err.kind ?? null; } finally { busy = false; } }
  async function useCode() { problem = null; if (!email.trim()) { problem = t("Enter your email address first."); return; } try { await requestCode(email.trim()); stage = "code"; code = ""; await tick(); codeBoxes?.focus(); } catch (err) { problem = err.message; if (/not available on this server/.test(err.message)) { codeOffered = false; usePw = true; await tick(); document.getElementById("pw")?.focus(); } } }
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
  <form class="mt-5 space-y-4" onsubmit={(e) => (askPw ? submit(e) : (e.preventDefault(), next()))}>
    <div><label class="label" for="email">{t("Email")}</label><input id="email" class="field" type="email" autocomplete="username webauthn" bind:value={email} required /></div>
    {#if askPw}<div><label class="label" for="pw">{t("Password")}</label><input id="pw" class="field" type="password" autocomplete="current-password" bind:value={password} required /></div>
    <button class="btn primary w-full" disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</button>
    {:else}<button class="btn primary w-full" disabled={busy} data-testid="login-continue">{t("Continue")}</button>{/if}
    {#if codeOffered}{#if askPw}<button type="button" class="btn w-full" onclick={useCode}>{t("Email me a sign-in code instead")}</button>{:else}<button type="button" class="block w-full text-center text-[13px] text-brand underline" onclick={() => (usePw = true)} data-testid="login-use-password">{t("Use a password instead")}</button>{/if}{/if}
    {#if ssoLabel}<a data-sveltekit-reload class="btn w-full" href="/api/auth/oidc/start" data-testid="login-sso">{t("Sign in with")} {ssoLabel}</a>{/if}
    {#if passkeyOffered}<button type="button" class="btn w-full" onclick={usePasskey} disabled={busy} data-testid="login-passkey">{t("Sign in with a passkey")}</button>{#if askPw}<p class="text-xs text-mute">{t("A passkey uses Touch ID, Face ID or your device PIN. To add one, sign in with your password, then open Workspace → Security.")}</p>{/if}{/if}
    <p class="text-sm"><a class="text-brand" href="/forgot">{t("Forgot your password?")}</a>{#if !selfHost}&nbsp;·&nbsp;<a class="text-brand" href="/signup">{t("Create an account")}</a>{/if}{#if demoOffered}&nbsp;·&nbsp;<a class="text-brand" href="/demo" data-testid="try-demo">{t("Try the demo")}</a>{/if}</p>
  </form>
{:else if stage === "pick"}
  <div class="mt-5 space-y-3" data-testid="login-pick">
    <p class="text-sm text-mute">{t("Workspace")} · {t("Choose one")}</p>
    {#each picks as w (w.slug)}<button type="button" class="btn w-full" disabled={busy} data-testid="login-pick-{w.slug}" onclick={async () => { busy = true; problem = null; try { await done(pending, w.slug); } catch (err) { problem = err.message; } finally { busy = false; } }}>{w.displayName}</button>{/each}
  </div>
{:else if stage === "two-step"}
  <div class="mt-5 space-y-4" data-testid="login-two-step">
    <h2 class="text-lg font-semibold">{t("Confirm it's you")}</h2>
    {#if way === "passkey"}
      <p class="text-sm text-mute">{t("Use the passkey or security key you set up for Docustay.")}</p>
      <button type="button" class="btn primary w-full" onclick={tsPasskey} disabled={busy} data-testid="two-step-passkey">{busy ? t("Waiting for your device…") : t("Use my passkey or security key")}</button>
    {:else if way === "code"}
      <form class="space-y-3" onsubmit={submitTwoStep}>
        <p class="text-sm text-mute">{t("Enter the six-digit code from your authenticator app.")}</p>
        <div><label class="label" for="ts-code">{t("Code")}</label><CodeBoxes bind:this={tsBoxes} bind:value={code} id="ts-code" invalid={tsBad} {busy} oncomplete={() => submitTwoStep()} label={t("Six-digit code")} /></div>
      </form>
    {:else}
      <form class="space-y-3" onsubmit={submitTwoStep}>
        <p class="text-sm text-mute">{t("Enter one of your recovery codes. Each works once.")}</p>
        <div><label class="label" for="ts-recovery">{t("Recovery code")}</label><input id="ts-recovery" class="field font-mono" bind:value={code} autocomplete="off" autocapitalize="characters" spellcheck="false" required data-testid="two-step-recovery" /></div>
        <button class="btn primary w-full" disabled={busy || !code.trim()}>{busy ? t("Checking…") : t("Continue")}</button>
      </form>
    {/if}
    {#if problem}<p class="notice bad" role="alert" data-testid="two-step-problem">{problem}</p>{/if}
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={remember} data-testid="two-step-remember" />{t("Remember this device for 30 days")}</label>
    <div class="space-y-1 text-sm" data-testid="two-step-other">
      <p class="text-mute">{t("Try another way")}</p>
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        {#if way !== "passkey" && opts.passkey && passkeysSupported()}<button type="button" class="underline" onclick={() => otherWay("passkey")}>{t("Passkey or security key")}</button>{/if}
        {#if way !== "code" && opts.authenticatorApp}<button type="button" class="underline" onclick={() => otherWay("code")}>{t("Authenticator app")}</button>{/if}
        {#if way !== "recovery" && opts.recovery}<button type="button" class="underline" onclick={() => otherWay("recovery")} data-testid="two-step-use-recovery">{t("Recovery code")}</button>{/if}
      </div>
    </div>
    <button type="button" class="text-sm text-mute underline" onclick={notYou} data-testid="two-step-not-you">{t("Not you? Sign out")}</button>
  </div>
{:else}
  <form class="mt-5 space-y-4" onsubmit={submitCode}>
    <p class="text-sm text-mute"><Rich text={t("If that address has an account, a six-digit code is on its way to <addr>{email}</addr>.", { email })} parts={{ addr: { strong: true } }} /></p>
    <div><label class="label" for="entry-code">{t("Code")}</label><CodeBoxes bind:this={codeBoxes} bind:value={code} invalid={codeBad} {busy} oncomplete={() => submitCode()} label={t("Six-digit code")} /></div>
    <button class="btn primary w-full" disabled={busy}>{busy ? t("Checking…") : t("Sign in")}</button>
    <button type="button" class="btn w-full" onclick={() => (stage = "password")}>{t("Use my password instead")}</button>
  </form>
{/if}
