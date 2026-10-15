<script>
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import EmptyState from "$lib/ui/EmptyState.svelte"; import Paper from "$lib/ui/Paper.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { when } from "$lib/docs.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { edition } from "$lib/edition.svelte.js";
  const un = (r) => r.json?.data ?? r.json;
  let rows = $state([]), total = $state(0), q = $state(""), problem = $state(null), edit = $state(null), f = $state({ firstName: "", lastName: "", email: "" });
  let loaded = $state(false), source = $state("");   // Run 7: "" everyone · form = people who filled in a form · signer = everyone else   // D-062: the empty sentence waits for the first answer
  async function load() { const r = await api(`/api/documents/people?q=${encodeURIComponent(q)}${source ? `&source=${source}` : ""}`); loaded = true; if (r.ok) { rows = un(r).contacts ?? []; total = un(r).total ?? rows.length; } else problem = r.error ?? t("People could not be loaded."); }
  let timer; const reload = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  function start(p) { edit = p ?? {}; f = { firstName: p?.first_name ?? "", lastName: p?.last_name ?? "", email: p?.email ?? "" }; problem = null; }
  async function save() {
    const r = edit.id ? await api("/api/documents/people/update", { method: "POST", body: { contactId: edit.id, ...f } }) : await api("/api/documents/people", { method: "POST", body: { ...f } });
    if (!r.ok) { problem = r.error ?? t("That did not save."); return; } edit = null; await load();
  }
  async function drop(p) { if (!await ask(t("Remove {name} from People? Documents they signed are kept.", { name: p.email }))) return; const r = await api("/api/documents/people/delete", { method: "POST", body: { contactId: p.id } }); if (!r.ok) { problem = r.error; return; } await load(); }
  onMount(() => { if (edition.rank === "member") return; if (new URLSearchParams(location.search).get("source") === "form") source = "form"; load(); return live(["people"], load); });   // R8-40: a member does not read the workspace's address book
</script>
<svelte:head><title>{t("People")} · Docustay</title></svelte:head>
{#if edition.rank === "member"}<h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("People")}</h1>
<p class="mt-3 max-w-2xl text-mute" data-testid="people-member">{t("People is the workspace's address book, kept by an owner or an admin. When you add people to a document, Add from past signers finds the people this workspace has sent to.")}</p>
{:else}
<div class="flex flex-wrap items-center gap-3"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("People")}</h1><a class="btn ml-auto" href="/api/documents/people.csv" data-testid="people-csv">{t("Download CSV")}</a><button class="btn primary" onclick={() => start(null)} data-testid="people-add">{t("Add a person")}</button></div>
<p class="mt-1 text-mute">{t("Everyone you have sent to or collected a form from, saved so you can pick them next time.")}</p>
<div class="mt-4 flex flex-wrap items-center gap-2"><input class="field !w-full sm:!w-72" placeholder={t("Search people")} aria-label={t("Search people")} bind:value={q} oninput={reload} data-testid="people-search" />
  <select class="field !w-auto" bind:value={source} onchange={load} aria-label={t("Show")} data-testid="people-source"><option value="">{t("Everyone")}</option><option value="form">{t("Filled in a form")}</option><option value="signer">{t("Sent a document")}</option></select></div>
{#if problem}<p class="notice warn mt-3" role="alert" data-testid="people-problem">{problem}</p>{/if}
{#if edit}
  <div class="card mt-4 grid max-w-xl gap-3 p-4" data-testid="people-form">
    <div class="grid gap-3 sm:grid-cols-2"><label class="grid gap-1"><span class="text-sm font-medium">{t("First name")}</span><input class="field" bind:value={f.firstName} data-testid="people-first" /></label><label class="grid gap-1"><span class="text-sm font-medium">{t("Last name")}</span><input class="field" bind:value={f.lastName} data-testid="people-last" /></label></div>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Email")}</span><input class="field" type="email" bind:value={f.email} data-testid="people-email" /></label>
    <div class="flex gap-2"><button class="btn primary" onclick={save} data-testid="people-save">{t("Save")}</button><button class="btn quiet" onclick={() => (edit = null)}>{t("Cancel")}</button></div>
  </div>
{/if}
<p class="mt-4 text-sm text-mute" data-testid="people-total">{t("People")}: {total}</p>
<ul class="mt-2 grid" data-testid="people-list">
  {#each rows as p (p.id)}
    <li class="flex flex-wrap items-center gap-x-3 border-b border-line py-2" data-testid={`people-row-${p.email}`}><a class="font-semibold text-ink no-underline hover:underline" href={`/people/${p.id}`} data-testid={`people-open-${p.email}`}>{[p.first_name, p.last_name].filter(Boolean).join(" ") || p.email}</a><span class="text-mute">{p.email}</span><span class="chip">{({ form: t("Form"), signer: t("Signer"), manual: t("Added by hand") })[p.source] ?? p.source}</span><span class="ml-auto text-sm text-mute">{when(p.last_activity_at)}</span><button class="btn quiet" onclick={() => start(p)}>{t("Edit")}</button><button class="btn quiet" onclick={() => drop(p)} data-testid={`people-del-${p.email}`}>{t("Remove")}</button></li>
  {:else}{#if !loaded}<li data-testid="list-loading"><PageSkel kind="list" testid="people-skel" /></li>{:else}<li data-testid="people-empty"><EmptyState title={t("No one yet")} line={t("People appear here after you send a document or a form is filled in.")}>{#snippet art()}<Paper width={72} skeleton />{/snippet}</EmptyState></li>{/if}{/each}
</ul>
{/if}
