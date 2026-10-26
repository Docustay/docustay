<script>
  // Scribe inside your own page (<docustay-scribe>): pick a play, say who signs, answer a few clickable questions, get a DRAFT. Nothing is sent: asking to send files an approval that a person decides in Docustay.
  // The key for this session is in the link's #fragment (never sent to any server); it is draft-only and ends in an hour. Events go to the parent website, and only to it.
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import Pick from "$lib/ui/Pick.svelte";
  let status = $state("loading"), plays = $state([]), play = $state(""), people = $state([{ name: "", email: "" }]), title = $state(page.url.searchParams.get("n") ?? ""), questions = $state(null), draftRef = $state(null), answers = $state({}), draft = $state(null), problem = $state(null), requested = $state(false), busy = $state(false);
  const parent = $derived(page.url.searchParams.get("o") ?? "");
  const key = () => decodeURIComponent((/[#&]k=([^&]+)/.exec(location.hash) ?? [])[1] ?? "");
  const say = (type, detail = {}) => { try { if (window.parent !== window && parent) window.parent.postMessage({ source: "docustay", version: 1, type, ...detail }, parent); } catch { /* no parent */ } };
  const resize = () => say("resize", { height: document.documentElement.scrollHeight });
  const call = async (method, path, body) => {
    const r = await fetch(path, { method, headers: { authorization: `Bearer ${key()}`, accept: "application/json", ...(body ? { "content-type": "application/json", "idempotency-key": crypto.randomUUID() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null); return { ok: r.ok, status: r.status, j: j?.data ?? j };
  };
  const fail = (r) => { problem = r.status === 401 ? "This session has ended. Ask the website for a new one." : (r.j?.error?.message ?? "That did not work."); say("error", { message: problem }); };
  onMount(async () => {
    if (!key()) { status = "error"; problem = "This link is missing its key. Ask the website for a new one."; say("error", { message: problem }); return; }
    const r = await call("GET", "/api/v1/templates/library?kind=document");   // R10-66: since Part 4R there are no document plays; the drafts come from the built-in Document templates
    if (!r.ok) { status = "error"; fail(r); return; }
    plays = (r.j?.templates ?? []).filter((p) => p.slug).map((p) => ({ name: p.slug, title: p.title, description: p.summary }));
    status = "ready"; say("ready"); resize();
  });
  const good = $derived(play && people.length && people.every((p) => p.name.trim() && /^\S+@\S+\.\S+$/.test(p.email.trim())));
  async function start() { busy = true; problem = null; await step("POST", "/api/v1/drafts", { template: play, people: people.map((p) => ({ name: p.name.trim(), email: p.email.trim() })), ...(title.trim() ? { title: title.trim() } : {}) }); busy = false; }
  async function answer() { busy = true; problem = null; await step("POST", `/api/v1/drafts/${encodeURIComponent(draftRef)}/answers`, { answers }); busy = false; }
  async function step(method, path, body) {
    const r = await call(method, path, body); if (!r.ok) { fail(r); return; }
    if (r.j.status === "needs_input") { questions = r.j.questions; draftRef = r.j.draftRef; answers = {}; }
    else { draft = r.j; questions = null; status = "drafted"; say("drafted", { documentId: r.j.documentId, title: r.j.title }); }
    setTimeout(resize, 50);
  }
  async function requestSend() { busy = true; const r = await call("POST", `/api/v1/documents/${draft.documentId}/send`, {}); busy = false; if (!r.ok) { fail(r); return; } requested = true; say("send_requested", { documentId: draft.documentId }); setTimeout(resize, 50); }
</script>
<svelte:head><title>Scribe · Docustay</title><meta name="robots" content="noindex" /></svelte:head>
<div class="mx-auto flex max-w-xl flex-col gap-4 p-4" data-testid="scribe">
  {#if status === "loading"}<p class="text-mute">Loading…</p>
  {:else if status === "error"}<p class="notice warn" role="alert" data-testid="scribe-problem">{problem}</p>
  {:else if status === "drafted"}
    <div class="card p-4" data-testid="scribe-drafted"><h2 class="text-lg font-semibold">{draft.title}</h2><p class="mt-1 text-sm text-mute">Your draft is ready. Nobody has been emailed.</p>
      {#if draft.checklist?.length}<ul class="mt-3 list-disc pl-5 text-sm text-mute">{#each draft.checklist as c}<li>{c}</li>{/each}</ul>{/if}
      {#if requested}<p class="notice ok mt-3" role="status" data-testid="scribe-requested">Asked. A person approves it in Docustay before anything is sent.</p>
      {:else}<button class="btn primary mt-3" disabled={busy} onclick={requestSend} data-testid="scribe-send">Ask to send</button>{/if}
      {#if problem}<p class="notice warn mt-3" role="alert">{problem}</p>{/if}</div>
  {:else if questions}
    <div class="grid gap-4" data-testid="scribe-questions">
      {#each questions as q (q.key)}
        <fieldset class="grid gap-2"><legend class="font-medium">{q.question ?? q.label ?? q.key}</legend>
          <div class="flex flex-wrap gap-2">{#each q.options as o}<button type="button" class="btn !min-h-11 {answers[q.key] === o.label ? 'primary' : ''}" aria-pressed={answers[q.key] === o.label} onclick={() => (answers[q.key] = o.label)} data-testid="scribe-opt">{o.label}</button>{/each}</div></fieldset>
      {/each}
      {#if problem}<p class="notice warn" role="alert">{problem}</p>{/if}
      <button class="btn primary" disabled={busy || questions.some((q) => answers[q.key] === undefined)} onclick={answer} data-testid="scribe-answer">Continue</button>
    </div>
  {:else}
    <div class="grid gap-4" data-testid="scribe-start">
      <div><span class="label">What do you need?</span><Pick options={plays.map((p) => ({ value: p.name, label: p.title ?? p.name, hint: p.description }))} value={play} onchange={(v) => (play = v)} placeholder="Choose a document" testid="scribe-play" /></div>
      <div class="grid gap-2"><span class="label">Who signs?</span>
        {#each people as p, i}<div class="flex gap-2"><input class="field grow" placeholder="Name" aria-label="Name {i + 1}" bind:value={p.name} data-testid="scribe-name" /><input class="field grow" type="email" placeholder="Email" aria-label="Email {i + 1}" bind:value={p.email} data-testid="scribe-email" />{#if people.length > 1}<button class="btn quiet" aria-label="Remove person {i + 1}" onclick={() => (people = people.filter((_, k) => k !== i))}>×</button>{/if}</div>{/each}
        {#if people.length < 6}<button class="btn quiet justify-self-start" onclick={() => (people = [...people, { name: "", email: "" }])}>+ Add a person</button>{/if}</div>
      {#if problem}<p class="notice warn" role="alert" data-testid="scribe-problem">{problem}</p>{/if}
      <button class="btn primary" disabled={!good || busy} onclick={start} data-testid="scribe-start-btn">{busy ? "Working…" : "Make a draft"}</button>
    </div>
  {/if}
</div>
