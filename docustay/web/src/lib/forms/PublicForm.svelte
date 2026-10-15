<script>
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, startLang } from "$lib/i18n/index.svelte.js";
  let { org, slug } = $props();
  let form = $state(null), limited = $state(false), gone = $state(false), busy = $state(false), problem = $state(null), emailed = $state(false);
  let name = $state(""), email = $state(""), website = $state(""), answers = $state({});
  const base = $derived(`/api/public/forms/${encodeURIComponent(org)}/${encodeURIComponent(slug)}`);
  onMount(async () => {
    startLang();   // R8-73: a visitor reads the form's own words in their language (?lang=, then a saved choice, then the browser), and <html lang> says so — as on the sign-in pages
    const r = await api(base);
    if (!r.ok) { if (r.status === 429) { limited = true; return; } gone = true; return; }   // P10-B-6
    form = r.json; for (const q of form.questions ?? []) answers[q.key] = q.default ?? "";
  });
  async function go(e) {
    e.preventDefault(); problem = null; busy = true;
    const r = await api(`${base}/start`, { method: "POST", body: { name, email, answers: form.questions?.length ? answers : null, website }, key: `form-${Date.now()}-${Math.random().toString(36).slice(2)}` });
    busy = false;
    if (!r.ok) { if (r.json?.error?.detail?.code?.startsWith("form_")) { form = { ...form, closed: r.json.error.detail.code.slice(5) }; return; } problem = r.status === 429 ? (JSON.stringify(r.json ?? "").includes("This form has had") ? t("This form has had too many tries in a short time. Try again later.") : t("Too many tries from this connection. Wait a few minutes and try again.")) : r.error ?? t("Something went wrong. Try again."); return; }
    if (r.json?.presented) { const embed = new URLSearchParams(location.search).get("embed") === "1"; location.assign(embed ? `${r.json.presented}${r.json.presented.includes("?") ? "&" : "?"}embed=1` : r.json.presented); return; }
    emailed = true;
  }
</script>
<svelte:head><title>{form ? form.title : t("Form")} · Docustay</title><meta name="robots" content="noindex" /></svelte:head>
<main class="mx-auto w-full max-w-lg px-4 py-10 sm:py-16" data-testid="pf-page">
  {#if limited}
    <h1 class="text-2xl font-bold">{t("Too many tries from this connection. Wait a few minutes and try again.")}</h1>
  {:else if gone}
    <h1 class="text-2xl font-bold">{t("This form is not available")}</h1>
    <p class="mt-2 text-mute">{t("The link may be wrong, or the form may have been turned off.")}</p>
  {:else if !form}
    <p class="text-mute" role="status">{t("Loading…")}</p>
  {:else}
    <p class="text-sm text-mute" data-testid="pf-org">{form.org?.name}</p>
    <h1 class="mt-1 text-2xl font-bold tracking-tight" data-testid="pf-title">{form.title}</h1>
    {#if form.intro || form.about}<p class="mt-2 text-text-2">{form.intro || form.about}</p>{/if}
    {#if form.closed}
      <p class="notice warn mt-6" role="status" data-testid="pf-closed">{form.closed === "expired" ? t("This form is closed.") : t("This form is not taking more responses.")}</p>
    {:else if emailed}
      <p class="notice ok mt-6" role="status" data-testid="pf-emailed">{t("Check your email. We sent you a link to continue.")}</p>
    {:else}
      <form class="mt-6 grid gap-4" onsubmit={go} data-testid="pf-form">
        <label class="grid gap-1"><span class="text-sm font-medium">{t("Your name")}</span><input class="field" bind:value={name} autocomplete="name" required maxlength="120" data-testid="pf-name" /></label>
        <label class="grid gap-1"><span class="text-sm font-medium">{t("Your email")}</span><input class="field" type="email" bind:value={email} autocomplete="email" required data-testid="pf-email" /></label>
        {#each form.questions ?? [] as q (q.key)}
          <label class="grid gap-1"><span class="text-sm font-medium">{q.label}</span><input class="field" bind:value={answers[q.key]} data-testid={`pf-q-${q.key}`} /></label>
        {/each}
        <input class="sr-only" tabindex="-1" autocomplete="off" aria-hidden="true" name="website" bind:value={website} />
        {#if problem}<p class="notice warn" role="alert" data-testid="pf-problem">{problem}</p>{/if}
        <button class="btn primary" disabled={busy} data-testid="pf-go">{form.verifyEmail ? t("Email me the link") : t("Continue")}</button>
      </form>
    {/if}
  {/if}
</main>
