<script>
  // LAUNCH steps 8-9: the calm strip at the top of a demo workspace: what this is, when it goes, the demo inbox (every email the demo "sent" is kept here, with its signing link), the tour, and "Keep my work"
  // (email → six-digit code → this same workspace becomes a real Free account). Shown only while the workspace is a demo; nothing renders for anyone else.
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { appEvent } from "$lib/appEvents.js";
  import { plan, loadPlan } from "$lib/pro/plan.svelte.js";
  import Dialog from "$lib/ui/Dialog.svelte";
  import CodeBoxes from "$lib/entry/CodeBoxes.svelte";
  import { tick } from "svelte";
  import { startTour } from "./tour.js";
  import { i18n } from "$lib/i18n/index.svelte.js";
  const demo = $derived(plan.data?.demo ?? null);
  let inboxOpen = $state(false), keepOpen = $state(false), messages = $state([]), inboxState = $state("idle");
  let step = $state("email"), email = $state(""), code = $state(""), policy = $state(false), problem = $state(null), bad = $state(false), boxes;
  const busy = $derived(step === "sending" || step === "verifying");
  async function openInbox() { inboxOpen = true; inboxState = "loading"; const r = await api("/api/demo/inbox"); messages = r.ok ? (r.json?.messages ?? r.json?.data?.messages ?? []) : []; inboxState = r.ok ? "ready" : "error"; }
  function openKeep() { keepOpen = true; step = "email"; problem = null; code = ""; }
  async function send(e) {
    e?.preventDefault(); problem = null;
    if (!policy) { problem = t("Please agree to the Terms, Privacy Policy and Data Processing Addendum."); return; }
    step = "sending";
    const r = await api("/api/demo/keep/request", { method: "POST", body: { email, lang: i18n.lang } });
    if (r.ok) { step = "code"; await tick(); boxes?.focus(); } else { problem = r.error ?? r.json?.error?.message ?? t("Could not send the code. Try again."); step = "email"; }
  }
  async function check(v) {
    problem = null; bad = false; step = "verifying";
    const r = await api("/api/demo/keep/confirm", { method: "POST", body: { email, code: v, policy, lang: i18n.lang } });
    if (r.ok) { step = "done"; await appEvent("demo_keep_complete"); await appEvent("signup_complete", { via: "demo_keep" }); setTimeout(() => location.assign("/documents"), 900); return; }
    problem = r.error ?? r.json?.error?.message ?? t("Could not finish. Try again.");
    const c = r.json?.error?.detail?.code;
    if (r.status === 403) { bad = true; code = ""; step = "code"; await tick(); boxes?.focus(); setTimeout(() => (bad = false), 500); }
    else step = c === "exists" || c === "demo_expired" || c === "not_demo" ? "email" : "code";
  }
  let toured = false;
  $effect(() => { if (demo && !toured && typeof location !== "undefined" && new URLSearchParams(location.search).get("tour") === "1") { toured = true; history.replaceState(null, "", location.pathname); setTimeout(() => startTour(), 900); } });
  const when = (iso) => whenText(iso, { dateStyle: "medium", timeStyle: "short" });
</script>
{#if demo}
  <div class="demo-bar" role="region" aria-label={t("Demo")} data-testid="demo-banner">
    <p class="min-w-0 flex-1"><strong>{t("This is a demo.")}</strong> <span class="text-mute">{t("Sample data, nothing is emailed. Removed {when}.", { when: when(demo.expiresAt) })}</span></p>
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="btn quiet !min-h-9 !px-3" onclick={() => startTour()} data-testid="demo-tour">{t("Take the tour")}</button>
      <button type="button" class="btn quiet !min-h-9 !px-3" onclick={openInbox} data-testid="demo-inbox-open" data-demo="inbox">{t("Demo inbox")}{#if demo.mailCount} ({demo.mailCount}){/if}</button>
      <button type="button" class="btn primary !min-h-9 !px-3" onclick={openKeep} data-testid="demo-keep" data-demo="keep">{t("Keep my work")}</button>
    </div>
  </div>
  <Dialog bind:open={inboxOpen} title={t("Demo inbox")} description={t("Every email this demo would have sent. Nothing left your browser.")} testid="demo-inbox">
    {#if inboxState === "loading"}<p class="text-sm text-mute" role="status">{t("Loading…")}</p>
    {:else if inboxState === "error"}<p class="text-sm text-bad" role="alert">{t("Could not load the inbox. Try again.")}</p>
    {:else if !messages.length}<p class="text-sm text-mute" data-testid="demo-inbox-empty">{t("Nothing yet. Send a document and its signing email appears here.")}</p>
    {:else}<ul class="grid gap-3" data-testid="demo-inbox-list">{#each messages as m (m.id)}<li class="rounded-xl border border-line p-3 text-sm"><p class="font-semibold">{m.subject}</p><p class="text-mute">{t("To")} {m.to} · {when(m.created_at)}</p>{#if m.link}<p class="mt-2"><a class="btn primary" href={m.link} data-testid="demo-inbox-sign">{t("Open the signing page")}</a></p>{/if}</li>{/each}</ul>{/if}
  </Dialog>
  <Dialog bind:open={keepOpen} title={t("Keep my work")} description={t("Create a free account and this workspace becomes yours: what you made stays, the sample documents go.")} testid="demo-keep-dialog">
    {#if step === "done"}
      <p class="text-sm" role="status" data-testid="demo-keep-done">{t("Done. Taking you to your account…")}</p>
    {:else if step === "code" || step === "verifying"}
      <p class="text-sm text-mute">{t("We sent a six-digit code to {email}.", { email })}</p>
      {#if problem}<p class="mt-3 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="demo-keep-problem">{problem}</p>{/if}
      <div class="mt-4"><CodeBoxes bind:this={boxes} bind:value={code} invalid={bad} busy={step === "verifying"} oncomplete={check} label={t("Six-digit code")} /></div>
      {#if step === "verifying"}<p class="mt-3 text-sm text-mute" role="status">{t("Checking…")}</p>{/if}
      <p class="mt-4 text-sm"><button type="button" class="text-mute underline" disabled={busy} onclick={() => { step = "email"; problem = null; code = ""; }}>{t("Use a different email")}</button></p>
    {:else}
      {#if problem}<p class="mb-3 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert" data-testid="demo-keep-problem">{problem} {#if /already has/i.test(problem)}<a class="underline" href="/login">{t("Sign in")}</a>{/if}</p>{/if}
      <form class="space-y-4" onsubmit={send}>
        <div><label class="label" for="keep-email">{t("Email")}</label><input id="keep-email" class="field" type="email" autocomplete="email" bind:value={email} required disabled={step === "sending"} data-testid="demo-keep-email" /></div>
        <label class="flex items-start gap-2.5 text-sm text-mute"><input type="checkbox" class="mt-1" bind:checked={policy} data-testid="demo-keep-policy" /><span>{t("I agree to the Terms of Service, Privacy Policy and Data Processing Addendum.")}</span></label>
        <button class="btn primary w-full" disabled={busy} data-testid="demo-keep-send">{step === "sending" ? t("Sending the code…") : t("Email me a code")}</button>
      </form>
    {/if}
  </Dialog>
{/if}
<style>
  .demo-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1rem; padding: .6rem .9rem; border-radius: .85rem; background: var(--brand-soft, #efeafe); color: var(--ink, #14112b); font-size: .875rem; border: 1px solid color-mix(in srgb, var(--brand, #5a3ac1) 25%, transparent); }
</style>
