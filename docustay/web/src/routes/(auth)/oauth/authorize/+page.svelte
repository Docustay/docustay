<script>
  // The consent page of the hosted connector: an AI assistant (ChatGPT, Claude…) asks to work on DRAFTS in this workspace. Signed-out people are sent to sign in and come straight back here.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Icon from "$lib/ui/Icon.svelte";
  let state = $state("loading"), info = $state(null), problem = $state(null), busy = $state(false), q = {};
  onMount(async () => {
    q = Object.fromEntries(new URLSearchParams(location.search));
    if (q.response_type !== "code" || !q.client_id || !q.redirect_uri || !q.code_challenge) { state = "bad"; return; }
    const r = await api("/api/oauth/preview", { method: "POST", body: { client_id: q.client_id, redirect_uri: q.redirect_uri } });
    if (r.status === 401) { try { sessionStorage.setItem("ds-after-login", location.pathname + location.search); } catch { /* storage blocked */ } await goto("/login"); return; }
    if (!r.ok) { problem = r.error; state = "bad"; return; }
    info = r.json?.data ?? r.json; state = "ask";
  });
  async function allow() {
    busy = true; problem = null;
    const r = await api("/api/oauth/approve", { method: "POST", body: { client_id: q.client_id, redirect_uri: q.redirect_uri, state: q.state, code_challenge: q.code_challenge, code_challenge_method: q.code_challenge_method } });
    if (!r.ok) { problem = r.error ?? t("That did not work."); busy = false; return; }
    location.href = (r.json?.data ?? r.json).redirect;
  }
  function deny() { const u = new URL(q.redirect_uri); u.searchParams.set("error", "access_denied"); if (q.state) u.searchParams.set("state", q.state); location.href = u.toString(); }
</script>
<svelte:head><title>{t("Connect an assistant")} · Docustay</title></svelte:head>
<div class="card p-6" style="max-width:28rem" data-testid="oauth-consent">
  {#if state === "loading"}<p class="text-mute">{t("Loading…")}</p>
  {:else if state === "bad"}<h1 class="text-xl font-semibold">{t("This link cannot be used")}</h1><p class="mt-2 text-mute" role="alert">{problem ?? t("The assistant's request is incomplete.")}</p>
  {:else}
    <h1 class="text-xl font-semibold" data-testid="oauth-title">{t("{name} wants to connect", { name: info.client })}</h1>
    <p class="mt-2 text-sm text-mute">{t("It will work on documents in {workspace}. You can undo this any time in Developers → API keys.", { workspace: info.workspace ?? t("your workspace") })}</p>
    <div class="mt-4 grid gap-3 text-sm">
      <div><b>{t("It can")}</b><ul class="mt-1 list-disc pl-5 text-mute"><li>{t("See your templates, plays and recent documents")}</li><li>{t("Make drafts from a play or a template, and ask you questions")}</li><li>{t("Ask for a draft to be sent")}</li></ul></div>
      <div><b>{t("It cannot")}</b><ul class="mt-1 list-disc pl-5 text-mute"><li>{t("Send a document. You approve every send in Docustay.")}</li><li>{t("Change settings, keys or billing")}</li></ul></div>
      <p class="text-xs text-mute">{t("After you allow, you return to {host}.", { host: info.host })}</p>
    </div>
    {#if problem}<p class="notice warn mt-3" role="alert">{problem}</p>{/if}
    <div class="mt-5 flex gap-2"><button class="btn primary grow" disabled={busy} onclick={allow} data-testid="oauth-allow"><Icon name="check" size={16} />{t("Allow")}</button><button class="btn grow" disabled={busy} onclick={deny} data-testid="oauth-deny">{t("Cancel")}</button></div>
  {/if}
</div>
