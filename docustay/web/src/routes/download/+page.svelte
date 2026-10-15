<script>
  import { onMount } from "svelte";
  import { newKey } from "$lib/api.js";
  import { wordsFor, dirOf, LANGUAGES, pickLanguage, fmt, serverMessage } from "$lib/i18n.js";
  // the language is the one the person chose on the signing page (saved in this browser), else the browser's own
  let lang = $state("en"); const T = $derived(wordsFor(lang));
  const SAVED = "docustay-sign-lang";
  const pickLang = () => { try { const v = localStorage.getItem(SAVED); if (LANGUAGES.includes(v)) return v; } catch { /* storage may be blocked */ } return pickLanguage(navigator.languages ?? [navigator.language]); };
  let phase = $state("loading"), view = $state(null), token = null, code = $state(""), msg = $state(null), busy = $state(false);

  async function call(path, body = {}) {
    const r = await fetch(`/api/public/pdf/download/${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": newKey() }, body: JSON.stringify({ presented: token, ...body }) });
    if (path === "file") { if (!r.ok) throw Object.assign(new Error(T.sp.fetchFailed), { status: r.status }); return r.blob(); }
    const json = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(json?.error?.message ? serverMessage(lang, json.error.message) : T.sp.wentWrong), { status: r.status });
    return json;
  }
  const settle = (v) => { view = v; phase = v.needsCode ? "gate" : "ready"; };
  onMount(async () => {
    lang = pickLang(); document.documentElement.lang = lang; document.documentElement.dir = dirOf(lang);
    const t = new URLSearchParams(location.search).get("t");
    history.replaceState(null, "", location.pathname);      // the link's secret leaves the address bar at once
    if (!t) { phase = "refused"; return; }
    token = t;
    try { settle(await call("view")); } catch (e) { phase = e.status === 403 ? "refused" : "trouble"; }
  });
  async function askCode() { msg = null; try { const r = await call("send-code"); msg = fmt(T.sp.gateSent, r.to, r.validMinutes); } catch (e) { msg = e.message; } }
  async function submitCode() { msg = null; try { const r = await call("verify", { code }); if (r.verified) { code = ""; settle(await call("view")); } else msg = r.code === "locked" ? T.sp.gateLocked : r.code === "expired" ? T.sp.gateExpired : r.code === "wrong_code" ? `${T.sp.gateWrong}${r.triesLeft != null ? " " + fmt(T.sp.gateTries, r.triesLeft) : ""}` : serverMessage(lang, r.message); } catch (e) { msg = e.message; } }
  async function get(what, documentId = null, name = "document") {
    busy = true; msg = null;
    try {
      const blob = await call("file", { which: what, documentId });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}${what === "certificate" ? " - certificate" : " (signed)"}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { msg = e.status === 403 ? T.sp.codeFirst : T.sp.fetchFailed; } finally { busy = false; }
  }
  $effect(() => { document.title = view?.title ? `${view.title} — ${T.sp.signedCopy}` : T.sp.signedCopy; });
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>
<div class="flex min-h-screen flex-col bg-tint">
{#if phase === "loading"}<p class="m-auto text-mute" data-testid="download-loading">{T.loading}</p>
{:else if phase === "refused" || phase === "trouble"}
  <div class="m-auto max-w-[44ch] px-6 text-center" data-testid="download-refused"><h1 class="text-2xl font-bold">{T.refusedTitle}</h1><p class="mt-3" role="alert">{phase === "refused" ? T.sp.expiredLink : T.sp.ourSide}</p></div>
{:else}
  <div class="m-auto w-full max-w-[480px] space-y-4 px-6 py-10" data-testid="download-ready">
    {#if view.org?.logoUrl}<img src={view.org.logoUrl} alt={view.org?.name ?? ""} class="h-9 w-auto" />{:else if view.org?.name}<p class="text-sm text-mute">{view.org.name}</p>{/if}
    <h1 class="text-2xl font-bold tracking-tight">{view.title}</h1>
    {#if phase === "gate"}
      <p>{fmt(T.sp.gateNeeds, view.org?.name ?? T.sp.theSender)} {fmt(T.sp.gateWill, view.email)}</p>
      <form class="flex max-w-xs flex-col gap-2" onsubmit={(e) => { e.preventDefault(); submitCode(); }}>
        <button type="button" class="btn" onclick={askCode}>{T.sp.gateEmailMe}</button>
        <input class="field" bind:value={code} inputmode="numeric" autocomplete="one-time-code" aria-label={T.sp.gateCode} />
        <button class="btn primary" disabled={!code.trim()}>{T.sp.openSigned}</button></form>
    {:else}
      <ul class="space-y-2">
        {#each view.documents as d}<li class="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2"><span class="truncate">{d.title}</span><button class="btn primary !py-1.5" disabled={busy} onclick={() => get("signed", d.id, d.title)} data-testid="download-signed">{T.sp.download}</button></li>{/each}
      </ul>
      {#if view.certificate}<button class="btn" disabled={busy} onclick={() => get("certificate", null, view.title)} data-testid="download-certificate">{T.sp.downloadCert}</button>{/if}
    {/if}
    {#if msg}<p class="text-sm text-mute" role="status">{msg}</p>{/if}
  </div>
{/if}
</div>
