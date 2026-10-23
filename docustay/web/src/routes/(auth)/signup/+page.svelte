<script>
  import { appEvent } from "$lib/appEvents.js";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy, tick } from "svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { emailCodeStart, emailCodeFinish, googleFinish, botCheckSiteKey, setBotToken, authConfig } from "$lib/auth.js";
  import GoogleButton from "$lib/entry/GoogleButton.svelte";
  import BotCheck from "$lib/BotCheck.svelte";
  import CodeBoxes from "$lib/entry/CodeBoxes.svelte";
  import { entry } from "$lib/entry/mood.svelte.js";
  import { peek } from "$lib/site/handoff.js";
  import { rememberStarter, afterAuthPath, clearStarter, markSignedIn } from "$lib/starter.js";
  import StarterCard from "$lib/starters/StarterCard.svelte";
  import { rememberPro, wantedPro } from "$lib/site/wantPro.js";
  // Run 9 (board W3): arriving from "Get Pro" — the plan is remembered, and once the account exists the app goes straight to checkout
  const proQ = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  if (["pro", "payg", "lifetime"].includes(proQ?.get("plan"))) rememberPro(proQ.get("interval") ?? "month", proQ.get("plan"));
  const wantsPro = $state(Boolean(wantedPro()));
  let starter = $state(rememberStarter());
  const fromDrop = typeof location !== "undefined" && new URLSearchParams(location.search).get("from") === "drop";
  // LAUNCH step 2: email → code → account. step: email | sending | code | verifying | creating | done. Every step has its own loading, success and error face.
  let step = $state("email"), email = $state(""), code = $state(""), policy = $state(false), problem = $state(null), kind = $state(null), sent = $state(false), botKey = $state(null), google = $state(null), demo = $state(false), bad = $state(false);
  let bot, boxes, resendIn = $state(0), timer;
  const busy = $derived(step === "sending" || step === "verifying" || step === "creating");
  $effect(() => { entry.mood = step === "done" ? "done" : busy ? "working" : problem ? "error" : "idle"; });
  onMount(async () => {
    botKey = await botCheckSiteKey();
    try { const c = await authConfig(); google = c.google ?? null; demo = Boolean(c.demo); } catch { /* no Google button */ }
    const q = new URLSearchParams(location.search).get("email"); if (q) email = q;
  });
  onDestroy(() => { clearInterval(timer); entry.mood = "idle"; });
  const countdown = () => { resendIn = 30; clearInterval(timer); timer = setInterval(() => { resendIn -= 1; if (resendIn <= 0) clearInterval(timer); }, 1000); };
  async function send(e) {
    e?.preventDefault(); problem = null; kind = null;
    if (!policy) { problem = t("Please agree to the Terms, Privacy Policy and Data Processing Addendum."); kind = "policy"; return; }
    step = "sending";
    try { await emailCodeStart(email); step = "code"; countdown(); await tick(); boxes?.focus(); }
    catch (err) { problem = err.message; kind = err.kind ?? null; step = "email"; bot?.reset(); }
  }
  async function resend() {
    problem = null; kind = null; sent = false;
    try { await emailCodeStart(email); sent = true; code = ""; countdown(); bot?.reset(); boxes?.focus(); }
    catch (err) { problem = err.message; kind = err.kind ?? null; }
  }
  async function check(v) {
    problem = null; kind = null; bad = false; step = "verifying";
    try {
      const r = await emailCodeFinish(email, v, { policy, onStep: (s) => { if (s === "creating") step = "creating"; } });
      step = "done"; markSignedIn(); await new Promise((r2) => setTimeout(r2, 900)); await enter(r);
    } catch (err) {
      problem = err.message; kind = err.kind ?? null;
      if (err.kind === "code") { bad = true; code = ""; step = "code"; await tick(); boxes?.focus(); setTimeout(() => (bad = false), 500); }
      else step = err.kind === "policy" ? "email" : "code";
    }
  }
  // Continue with Google: the agreement must be ticked first (it is the same account creation); then the same working / creating / done faces as the code path
  async function withGoogle(credential) {
    problem = null; kind = null;
    if (!policy) { problem = t("Please agree to the Terms, Privacy Policy and Data Processing Addendum."); kind = "policy"; return; }
    step = "verifying";
    try { const r = await googleFinish(credential, { policy, onStep: (s) => { if (s === "creating") step = "creating"; } }); step = "done"; markSignedIn(); await new Promise((r2) => setTimeout(r2, 900)); await enter(r); }
    catch (err) { problem = err.message; kind = err.kind ?? null; step = "email"; }
  }
  async function enter(r) {
    void appEvent("signup_complete", { via: "signup" });
    // a chosen template wins over a dropped file: the file stays kept, and the editor tells the person it is still waiting
    if (wantedPro()) { await goto("/upgrade", { invalidateAll: true }); return; }
    const kept = !starter && (await peek()) !== null;
    await goto(kept ? "/create?mode=document&upload=1" : afterAuthPath(), { invalidateAll: true });
  }
</script>
<svelte:head><title>{t("Create your account")} · Docustay</title><meta name="description" content="Create a free Docustay account: send documents for signature, 15 a month at no cost." /></svelte:head>

{#if step === "done"}
  <div class="done" role="status" data-testid="signup-done">
    <svg viewBox="0 0 52 52" aria-hidden="true" class="tick"><circle cx="26" cy="26" r="24" /><path d="M15 27l8 8 14-16" /></svg>
    <h1 class="text-2xl font-bold tracking-tight">{t("You are in")}</h1>
    <p class="mt-2 text-sm text-mute">{t("Taking you to your workspace…")}</p>
  </div>
{:else if step === "creating"}
  <div class="working" role="status" aria-live="polite" data-testid="signup-creating">
    <span class="spin" aria-hidden="true"></span>
    <h1 class="text-xl font-bold tracking-tight">{t("Setting up your workspace")}</h1>
    <p class="mt-2 text-sm text-mute">{t("A few seconds. Nothing to do.")}</p>
  </div>
{:else if step === "code" || step === "verifying"}
  <h1 class="text-2xl font-bold tracking-tight">{t("Check your email")}</h1>
  <p class="mt-2 text-sm text-mute"><Rich text={t("We sent a six-digit code to <addr>{email}</addr>. Enter it to finish creating your account.", { email })} parts={{ addr: { strong: true } }} /></p>
  {#if problem}<div class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="signup-problem"><p>{problem}</p></div>{/if}
  <div class="mt-5" data-testid="signup-code-form">
    <CodeBoxes bind:this={boxes} bind:value={code} invalid={bad} busy={step === "verifying"} oncomplete={check} label={t("Six-digit code")} />
    {#if step === "verifying"}<p class="mt-3 text-sm text-mute" role="status">{t("Checking…")}</p>{/if}
  </div>
  <p class="mt-5 text-sm">
    <button type="button" class="text-brand underline disabled:opacity-50 disabled:no-underline" onclick={resend} disabled={busy || resendIn > 0}>{resendIn > 0 ? `${t("Send a new code")} (${resendIn})` : t("Send a new code")}</button>
    {#if sent} <span class="text-mute">{t("A new code is on its way.")}</span>{/if}
  </p>
  <p class="mt-2 text-sm"><button type="button" class="text-mute underline" onclick={() => { step = "email"; problem = null; code = ""; }} disabled={busy}>{t("Use a different email")}</button></p>
{:else}
  <h1 class="text-2xl font-bold tracking-tight">{t("Create your Docustay account")}</h1>
  <p class="mt-2 text-sm text-mute">{fromDrop ? t("Your document is waiting. Make an account and it opens ready for fields.") : t("Upload a document, send it, get it signed and sealed. Free to start.")}</p>
  {#if wantsPro}<p class="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand" data-testid="signup-pro">{t("Pro selected")} · {t("you go straight to checkout next")}</p>{/if}
  {#if starter}<div class="mt-4"><StarterCard slug={starter} onclear={() => { clearStarter(); starter = null; }} /></div>{/if}
  {#if problem}<div class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="signup-problem"><p>{problem}</p>{#if kind === "exists" || kind === "limit"}<p class="mt-1"><a class="underline" href="/login">{t("Sign in")}</a></p>{/if}</div>{/if}
  <form class="mt-5 space-y-4" onsubmit={send} data-testid="signup-form">
    {#if google}<GoogleButton clientId={google.clientId ?? google} oncredential={withGoogle} onerror={() => (google = null)} /><p class="text-center text-xs text-mute">{t("or")}</p>{/if}
    <div><label class="label" for="e">{t("Email")}</label><input id="e" class="field" type="email" autocomplete="email" bind:value={email} required disabled={step === "sending"} data-testid="signup-email" /></div>
    <label class="flex items-start gap-2.5 text-sm text-mute"><input type="checkbox" class="mt-1" bind:checked={policy} data-testid="signup-policy" /><span><Rich text={t("I agree to the <terms>Terms of Service</terms>, <privacy>Privacy Policy</privacy> and <dpa>Data Processing Addendum</dpa>.")} parts={{ terms: { href: "/legal/terms", class: "text-brand", target: "_blank" }, privacy: { href: "/legal/privacy", class: "text-brand", target: "_blank" }, dpa: { href: "/legal/dpa", class: "text-brand", target: "_blank" } }} /></span></label>
    <BotCheck bind:this={bot} siteKey={botKey} ontoken={setBotToken} />
    <button class="btn primary w-full" disabled={busy} data-testid="signup-submit">{step === "sending" ? t("Sending the code…") : t("Email me a code")}</button>
    <p class="text-sm"><Rich text={t("Already have an account? <in>Sign in</in>")} parts={{ in: { href: "/login", class: "text-brand" } }} /></p>
    {#if demo}<p class="text-sm"><Rich text={t("Just looking? <demo>Try the demo</demo>. No account needed.")} parts={{ demo: { href: "/demo", class: "text-brand" } }} /></p>{/if}
  </form>
{/if}
<style>
  .done, .working { text-align: center; padding: 1.5rem 0; }
  .tick { width: 64px; height: 64px; margin: 0 auto 1rem; display: block; }
  .tick circle { fill: none; stroke: #8f8af8; stroke-width: 2.5; stroke-dasharray: 160; stroke-dashoffset: 160; animation: sg-draw 600ms ease-out forwards; }
  .tick path { fill: none; stroke: #5a3ac1; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: sg-draw 420ms ease-out 450ms forwards; }
  .spin { display: block; width: 40px; height: 40px; margin: 0 auto 1rem; border-radius: 50%; border: 3px solid #d3d0f5; border-top-color: #5a3ac1; animation: sg-spin 800ms linear infinite; }
  @keyframes sg-draw { to { stroke-dashoffset: 0; } } @keyframes sg-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .tick circle, .tick path { animation: none; stroke-dashoffset: 0; } .spin { animation-duration: 2.4s; } }
</style>
