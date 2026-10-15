<script>
  // LAUNCH step 8: the public demo. One button makes a throw-away Maple Street workspace and opens it; nothing to type, no account. States: ready, starting, done, and every refusal in plain words (busy, too many, bot check, off).
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { botCheckSiteKey, authConfig } from "$lib/auth.js";
  import BotCheck from "$lib/BotCheck.svelte";
  import { entry } from "$lib/entry/mood.svelte.js";
  let step = $state("ready"), problem = $state(null), kind = $state(null), botKey = $state(null), token = $state(null), off = $state(false), bot;
  const busy = $derived(step === "starting");
  $effect(() => { entry.mood = step === "done" ? "done" : busy ? "working" : problem ? "error" : "idle"; });
  onMount(async () => {
    botKey = await botCheckSiteKey();
    try { const c = await authConfig(); off = !c.demo; } catch { /* the server answers when the button is pressed */ }
  });
  onDestroy(() => { entry.mood = "idle"; });
  async function start() {
    problem = null; kind = null; step = "starting";
    const r = await api("/api/demo/start", { method: "POST", body: { turnstileToken: token } });
    if (r.ok) { step = "done"; await new Promise((x) => setTimeout(x, 700)); await goto("/documents?tour=1", { invalidateAll: true }); return; }
    step = "ready"; bot?.reset();
    kind = r.json?.error?.detail?.code ?? null;
    problem = r.status === 0 ? r.error : r.status === 429 ? (r.json?.error?.message ?? t("The demo is busy right now. Please try again in a few minutes.")) : r.status === 403 && kind === "demo_off" ? t("The demo is not available right now.") : (r.json?.error?.message ?? t("Could not open the demo. Try again in a moment."));
  }
</script>
<svelte:head><title>{t("Try the demo")} · Docustay</title></svelte:head>
{#if step === "done"}
  <div class="done" role="status" data-testid="demo-done"><h1 class="text-2xl font-bold tracking-tight">{t("Your demo is ready")}</h1><p class="mt-2 text-sm text-mute">{t("Opening Maple Street Property Management…")}</p></div>
{:else if step === "starting"}
  <div class="done" role="status" aria-live="polite" data-testid="demo-starting"><span class="spin" aria-hidden="true"></span><h1 class="text-xl font-bold tracking-tight">{t("Setting up your demo")}</h1><p class="mt-2 text-sm text-mute">{t("A few seconds. Nothing to do.")}</p></div>
{:else}
  <h1 class="text-2xl font-bold tracking-tight">{t("Try Docustay with sample documents")}</h1>
  <p class="mt-2 text-sm text-mute">{t("You get a small property-management workspace with leases and applications already in it. Send a document, sign it yourself, ask Scribe to draft one. No account, no card.")}</p>
  <ul class="mt-4 space-y-1.5 text-sm text-mute" data-testid="demo-promises">
    <li>{t("Nothing is emailed to anyone: every message is kept in a demo inbox you can open.")}</li>
    <li>{t("The demo is removed after 24 hours, or keep your work by creating a free account.")}</li>
  </ul>
  {#if problem}<div class="mt-4 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="demo-problem"><p>{problem}</p>{#if kind === "demo_ip_limit"}<p class="mt-1"><a class="underline" href="/signup">{t("Create a free account")}</a></p>{/if}</div>{/if}
  {#if off}<div class="mt-4 rounded-lg border border-line bg-tint px-3 py-2 text-sm text-mute" data-testid="demo-off"><p>{t("The demo is not available right now.")} <a class="text-brand underline" href="/signup">{t("Create a free account")}</a></p></div>
  {:else}
    <div class="mt-5"><BotCheck bind:this={bot} siteKey={botKey} ontoken={(tk) => (token = tk)} /></div>
    <button type="button" class="btn primary mt-4 w-full" onclick={start} data-testid="demo-start">{t("Open the demo")}</button>
  {/if}
  <p class="mt-4 text-sm"><a class="text-brand" href="/signup">{t("Rather start for real? Create an account")}</a></p>
{/if}
<style>
  .done { text-align: center; padding: 1.5rem 0; }
  .spin { display: block; width: 40px; height: 40px; margin: 0 auto 1rem; border-radius: 50%; border: 3px solid #d3d0f5; border-top-color: #5a3ac1; animation: sg-spin 800ms linear infinite; }
  @keyframes sg-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
</style>
