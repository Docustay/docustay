<script>
  import Success from "$lib/fx/Success.svelte"; import { edition } from "$lib/edition.svelte.js";
  // FORMS (Run 7): every form template, its link, its options, its responses. A form is made from Templates → Form templates (the same six steps, ending in Publish);
  // this page publishes, shares, opens and closes, and collects. Every empty state has a way forward.
  import { ask } from "$lib/ui/confirm.svelte.js";
  import EmptyState from "$lib/ui/EmptyState.svelte"; import Paper from "$lib/ui/Paper.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { when } from "$lib/docs.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  import FormPublish from "$lib/forms/FormPublish.svelte";
  import FormShare from "$lib/forms/FormShare.svelte";
  import NewTemplateLock from "$lib/pro/NewTemplateLock.svelte";
  const un = (r) => r.json?.data ?? r.json;
  const BLANK = { verifyEmail: false, copyTo: null, expiresAt: null, responseLimit: null, intro: null, thankYou: null, fillAgain: false, embedSites: [], notifyOwner: true, confirmRespondent: true };
  let forms = $state([]), tpls = $state([]), libForms = $state([]), problem = $state(null), sel = $state(null), detail = $state(null), responses = $state([]);
  let adding = $state(false), pickId = $state(""), slug = $state(""), busy = $state(false), tried = $state(false);
  let s = $state({ ...BLANK }), newS = $state({ ...BLANK });
  let loaded = $state(false);
  const REASON = () => ({ retired: t("Retired templates cannot become forms."), not_approved: t("It needs approval before it can become a form."), no_signer: t("Nobody signs it yet, so nobody could fill it in."), too_many_people: t("A form has one person who fills it (and one team member who may counter-sign). This has more people: send it the ordinary way.") });
  async function load() {
    const [f, p, l] = await Promise.all([api("/api/documents/forms"), api("/api/documents/pdf/templates"), api("/api/documents/library?kind=form")]); loaded = true;
    // Run 10 (R10-18): a built-in form template is the workspace's master, not one of its own templates; "Publish" on the Templates page hands this page the master's id, so the master has to be a choice here too
    libForms = l.ok ? ((l.json?.templates ?? []).filter((x) => x.templateId).map((x) => ({ id: x.templateId, name: x.title, kind: "form" }))) : [];
    if (f.ok) forms = un(f).forms ?? un(f) ?? []; else problem = f.error ?? t("Forms could not be loaded.");
    if (p.ok) tpls = (p.json.templates ?? []).filter((x) => x.active !== false);
  }
  // only a template the server would accept is offered; every other one is listed with the reason it is not
  const publishable = $derived(tpls.filter((x) => !x.formReason && !(x.kind === "form" && x.self_serve_enabled)).concat(libForms.filter((b) => !tpls.some((x) => x.id === b.id) && !forms.some((f) => f.id === b.id && f.slug))));
  const blocked = $derived(tpls.filter((x) => x.formReason && x.kind !== "form"));
  const link = (d) => d?.slug ? `${location.origin}/f/${d.orgSlug ?? "-"}/${d.slug}` : "";
  async function open(f) {
    sel = f.id; const r = await api(`/api/documents/forms/${f.id}`); if (!r.ok) { problem = r.error; return; }
    detail = un(r); s = { ...BLANK, ...(detail.settings ?? {}) };
    const rr = await api(`/api/documents/forms/${f.id}/responses`); responses = rr.ok ? (un(rr).responses ?? []) : [];
  }
  async function publish(templateId, name, settings, enabled = true) {
    busy = true; problem = null;
    const r = await api("/api/documents/forms/publish", { method: "POST", body: { templateId, slug: name, settings, enabled } });
    // Run 8 R8-66: the notice sits at the top of the page and Publish at the foot of a long sheet — the refusal is also a toast, so the person sees why nothing happened
    busy = false; if (!r.ok) { problem = r.error ?? t("That did not save."); toast(problem, "bad", 8000); return null; }
    await load(); return un(r);
  }
  async function create() { tried = true; const f = await publish(pickId, slug.trim().toLowerCase(), $state.snapshot(newS)); if (f) { toast(t("Your form is live."), "ok"); adding = false; pickId = ""; slug = ""; tried = false; newS = { ...BLANK }; await open({ id: f.id }); } }
  async function toggle() { const r = await api("/api/documents/forms/open", { method: "POST", body: { templateId: sel, open: !detail.open } }); if (!r.ok) { problem = r.error; return; } await load(); await open({ id: sel }); }
  async function save() { if (await publish(sel, detail.slug, { ...$state.snapshot(s), counterSign: detail.settings?.counterSign ?? null }, detail.open)) { toast(t("Saved."), "ok"); await open({ id: sel }); } }
  // P10-B-4: words, not raw statuses; the Documents page's own words where they fit. A response counts once the visitor has signed; the others sit in a collapsed line.
  const word = (r) => r.state === "executed" ? t("Completed") : r.state === "partially_signed" && r.signed ? t("Waiting for a counter-signature") : r.state === "partially_signed" || r.state === "sent" ? t("Waiting for them to sign") : ({ draft: t("Draft"), declined: t("Declined"), expired: t("Expired"), voided: t("Cancelled"), void: t("Cancelled") })[r.state] ?? r.state;
  const signedList = $derived(responses.filter((r) => r.signed)), startedList = $derived(responses.filter((r) => !r.signed));
  async function remove() { if (!await ask(t("Unpublish this form? The link stops working. The form template and every response are kept, and you can publish it again."))) return; const r = await api("/api/documents/forms/remove", { method: "POST", body: { templateId: sel } }); if (!r.ok) { problem = r.error; return; } sel = null; detail = null; await load(); }
  onMount(async () => {
    if (edition.rank === "member") return;   // Run 8: forms are an owner's or an admin's; the page says so instead of asking for what it will be refused
    await load();
    const p = new URLSearchParams(location.search), n = p.get("new"), o = p.get("open");
    if (o) { const f = forms.find((x) => x.id === o); if (f) await open(f); else { adding = true; pickId = o; } }
    else if (n) { adding = true; pickId = n; }
  });
  onMount(() => live(["templates"], load));
  // Run 7 part 8: a response that arrives while a form is open lands at the top of its list with a short moment
  let arrived = $state(null), arrivedTimer;
  async function freshResponses() {
    if (!sel) return; const signed = (list) => new Set(list.filter((r) => r.state === "executed").map((r) => r.id)); const had = signed(responses);
    const rr = await api(`/api/documents/forms/${sel}/responses`); if (!rr.ok) return;
    const next = un(rr).responses ?? [];
    const fresh = next.find((r) => r.state === "executed" && !had.has(r.id));   // counted when the person has signed, not when they open the link
    if (fresh) { arrived = fresh.name ?? fresh.email ?? ""; clearTimeout(arrivedTimer); arrivedTimer = setTimeout(() => (arrived = null), 10000); }
    responses = next; await load();
  }
  onMount(() => live(["documents"], freshResponses));
</script>
<svelte:head><title>{t("Forms")} · Docustay</title></svelte:head>
{#if edition.rank === "member"}<h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Forms")}</h1>
<p class="mt-3 max-w-2xl text-mute" data-testid="forms-member">{t("Forms are set up by an owner or an admin of this workspace.")}</p>
{:else}
<div class="flex flex-wrap items-center gap-3"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Forms")}</h1>
  <span class="ml-auto"><NewTemplateLock testid="prolock-forms-make">{#snippet children(locked)}<a class="btn" href="/create?mode=form" aria-disabled={locked ? "true" : undefined} data-testid="forms-make">{t("New form template")}</a>{/snippet}</NewTemplateLock></span>
  <button class="btn primary" onclick={() => (adding = !adding)} data-testid="forms-new">{t("Publish a form")}</button></div>
<p class="mt-1 text-mute">{t("One link that anyone can open, fill in and sign. Every response is its own signed document.")}</p>
{#if problem}<p class="notice warn mt-4" role="alert" data-testid="forms-problem">{problem}</p>{/if}
{#if adding}
  <div class="card mt-4 grid max-w-3xl gap-4 p-4" data-testid="forms-add">
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Template")}</span><select class="field" bind:value={pickId} data-testid="forms-template"><option value="">{t("Choose a template")}</option>{#each publishable as tp (tp.id)}<option value={tp.id}>{tp.name}{tp.kind === "form" ? "" : ` · ${t("document template")}`}</option>{/each}</select>
      {#if !publishable.length}<span class="text-sm text-mute" data-testid="forms-none">{t("None of your templates can be published as a form yet.")} <NewTemplateLock testid="prolock-forms-none">{#snippet children(locked)}<a class="text-brand underline" href="/create?mode=form" aria-disabled={locked ? "true" : undefined} data-testid="forms-none-create">{t("Make a form template")}</a>{/snippet}</NewTemplateLock></span>{/if}</label>
    {#if blocked.length}<details class="text-sm" data-testid="forms-blocked"><summary class="cursor-pointer text-mute">{t("Why are some templates not offered?")}</summary><ul class="mt-2 grid gap-1">{#each blocked as tp (tp.id)}<li><b>{tp.name}</b>: <span class="text-mute">{REASON()[tp.formReason] ?? t("It cannot become a form.")}</span></li>{/each}</ul></details>{/if}
    {#if pickId}<FormPublish bind:s={newS} bind:slug {tried} />
    <div class="flex gap-2"><button class="btn primary" disabled={busy || !pickId} onclick={create} data-testid="forms-create">{t("Publish")}</button><button class="btn quiet" onclick={() => (adding = false)}>{t("Cancel")}</button></div>{/if}
  </div>
{/if}
<div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
  <ul class="grid content-start gap-2" data-testid="forms-list">
    {#each forms as f (f.id)}
      <li><button class="card w-full p-3 text-left {sel === f.id ? 'border-brand' : ''}" onclick={() => open(f)} data-testid={`forms-row-${f.slug ?? f.id}`}><b class="block">{f.name}</b>{#if f.slug}<span class="block truncate text-xs text-mute">/f/…/{f.slug}</span>{/if}<span class="text-sm text-mute">{t("Responses")}: {f.responses} · {f.closed ? t("Closed") : f.open ? t("Open") : f.slug ? t("Off") : t("Not published")}</span></button></li>
    {:else}{#if !loaded}<li data-testid="list-loading"><div class="grid gap-2" aria-busy="true" role="status">{#each [0, 1] as i (i)}<div class="skel h-16 rounded-xl"></div>{/each}<span class="sr-only">{t("Loading…")}</span></div></li>{:else}<li data-testid="forms-empty"><EmptyState title={t("No forms yet")} line={t("A form is one link that anyone can open, fill in and sign. Every response is its own signed document.")}>{#snippet art()}<Paper width={72} skeleton />{/snippet}{#snippet action()}<NewTemplateLock testid="prolock-forms-empty">{#snippet children(locked)}<a class="btn primary" href="/create?mode=form" aria-disabled={locked ? "true" : undefined} data-testid="forms-empty-create">{t("Make a form template")}</a>{/snippet}</NewTemplateLock>{/snippet}</EmptyState></li>{/if}{/each}
  </ul>
  {#if detail}
    <section class="card grid content-start gap-4 p-4" data-testid="forms-detail">
      {#if arrived !== null}<div class="rounded-xl border border-line p-3"><Success tone="brand" art="ripple" count={forms.find((f) => f.id === sel)?.responses ?? null} title={t("New response")} line={arrived ? t("From {name}.", { name: arrived }) : ""} testid="moment-response" /></div>{/if}
      <div class="flex flex-wrap items-center gap-2"><h2 class="text-lg font-semibold">{detail.name}</h2><span class="chip">{detail.closed ? t("Closed") : detail.open ? t("Open") : detail.slug ? t("Off") : t("Not published")}</span>{#if detail.slug}<button class="btn ml-auto" onclick={toggle} data-testid="forms-toggle">{detail.open ? t("Turn off") : t("Turn on")}</button>{/if}<a class="btn {detail.slug ? '' : 'ml-auto'}" href={`/create/flow?mode=form&template=${detail.id}`} data-testid="forms-edit">{t("Edit the form")}</a></div>
      {#if detail.slug}<FormShare link={link(detail)} sites={detail.settings?.embedSites ?? []} />{/if}
      {#if detail.settings?.counterSign?.on}<p class="text-sm text-mute" data-testid="forms-counter">{t("A team member counter-signs every response.")}</p>{/if}
      <FormPublish bind:s bind:slug={detail.slug} lockSlug={!!detail.slug} />
      <div class="flex gap-2"><button class="btn primary" disabled={busy} onclick={save} data-testid="forms-save">{detail.slug ? t("Save settings") : t("Publish")}</button>{#if detail.slug}<button class="btn quiet" onclick={remove} data-testid="forms-remove">{t("Unpublish")}</button>{/if}</div>
      <div class="flex items-center gap-2"><h2 class="font-semibold">{t("Responses")}</h2>{#if responses.length}<a class="btn ml-auto" href={`/documents?form=${encodeURIComponent(detail.name)}`} data-testid="forms-in-documents">{t("See them in Documents")}</a><a class="btn" href={`/api/documents/forms/${detail.id}/responses.csv`} data-testid="forms-csv">{t("Download CSV")}</a>{/if}</div>
      <ul class="grid gap-1" data-testid="forms-responses">
        {#each signedList as r (r.id)}<li class="flex flex-wrap gap-x-3 border-b border-line py-2 text-sm"><a class="font-medium text-brand underline" href={`/documents/${r.id}`}>{r.name ?? r.title}</a><span class="text-mute">{r.email}</span><span class="ml-auto text-mute">{word(r)} · {when(r.created_at)}</span></li>
        {:else}<li class="text-mute" data-testid="forms-no-responses">{detail.slug && detail.open ? t("No responses yet. Share the link above to get the first one.") : t("No responses yet. Publish the form to get a link.")}</li>{/each}
      </ul>
      {#if startedList.length}<details class="mt-2" data-testid="forms-started"><summary class="cursor-pointer text-sm text-mute">{t("Started, not signed ({n})", { n: startedList.length })}</summary><ul class="mt-1 grid gap-1">{#each startedList as r (r.id)}<li class="flex flex-wrap gap-x-3 border-b border-line py-2 text-sm"><a class="font-medium text-brand underline" href={`/documents/${r.id}`}>{r.name ?? r.title}</a><span class="text-mute">{r.email}</span><span class="ml-auto text-mute">{word(r)} · {when(r.created_at)}</span></li>{/each}</ul></details>{/if}
    </section>
  {/if}
</div>
{/if}
