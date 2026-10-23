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
  import PageHeader from "$lib/ui/PageHeader.svelte"; import Avatar from "$lib/ui/Avatar.svelte"; import Thumbnail from "$lib/ui/Thumbnail.svelte";
  const nameOf = (p) => [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;
  const whereIs = (p) => { const n = p.documents ?? 0; if (!n) return t("No documents yet"); const r = p.recent?.[0]; const st = r?.state === "executed" ? t("sealed") : r?.party_status === "signed" ? t("signed") : r?.party_status === "viewed" ? t("opened") : r?.state === "declined" ? t("declined") : t("waiting"); return `${n === 1 ? t("1 document") : t("{n} documents", { n })}, ${st}`; };
  const un = (r) => r.json?.data ?? r.json;
  let rows = $state([]), total = $state(0), q = $state(""), problem = $state(null), edit = $state(null), f = $state({ firstName: "", lastName: "", email: "" });
  let mates = $state([]), loaded = $state(false), source = $state("");   // Run 7: "" everyone · form = people who filled in a form · signer = everyone else   // D-062: the empty sentence waits for the first answer
  async function load() { if (source === "team") { const r = await api("/api/documents/teammates"); loaded = true; if (r.ok) { mates = (r.json?.data ?? r.json)?.teammates ?? []; } else problem = r.error ?? t("Contacts could not be loaded."); return; } const r = await api(`/api/documents/people?q=${encodeURIComponent(q)}${source ? `&source=${source}` : ""}`); loaded = true; if (r.ok) { rows = un(r).contacts ?? []; total = un(r).total ?? rows.length; } else problem = r.error ?? t("Contacts could not be loaded."); }
  let timer; const reload = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  function start(p) { edit = p ?? {}; f = { firstName: p?.first_name ?? "", lastName: p?.last_name ?? "", email: p?.email ?? "" }; problem = null; }
  async function save() {
    const r = edit.id ? await api("/api/documents/people/update", { method: "POST", body: { contactId: edit.id, ...f } }) : await api("/api/documents/people", { method: "POST", body: { ...f } });
    if (!r.ok) { problem = r.error ?? t("That did not save."); return; } problem = null; edit = null; await load();
  }
  async function drop(p) { if (!await ask(t("Remove {name} from Contacts? Documents they signed are kept.", { name: p.email }))) return; const r = await api("/api/documents/people/delete", { method: "POST", body: { contactId: p.id } }); if (!r.ok) { problem = r.error; return; } await load(); }
  onMount(() => { if (edition.rank === "member") return; load(); return live(["people"], load); });   // R8-40: a member does not read the workspace's address book
</script>
<svelte:head><title>{t("Contacts")} · Docustay</title></svelte:head>
{#if edition.rank === "member"}<PageHeader title={t("Contacts")} />
<p class="max-w-2xl text-[13px] text-mute" data-testid="people-member">{t("Contacts is the workspace's address book, kept by an owner or an admin. When you add people to a document, Add from Contacts and your team finds your teammates and everyone this workspace has sent to.")}</p>
{:else}
<PageHeader title={t("Contacts")}>
  {#snippet filters()}<input class="field !w-full sm:!w-64" placeholder={t("Search contacts")} aria-label={t("Search contacts")} bind:value={q} oninput={reload} data-testid="people-search" />
    <select class="field !w-auto" bind:value={source} onchange={load} aria-label={t("Show")} data-testid="people-source"><option value="">{t("Everyone")}</option><option value="signer">{t("Sent a document")}</option><option value="team">{t("Team")}</option></select>{/snippet}
  {#snippet actions()}<a data-sveltekit-reload class="btn" href="/api/documents/people.csv" data-testid="people-csv">{t("Download CSV")}</a><button class="btn primary" onclick={() => start(null)} data-testid="people-add">{t("Add a contact")}</button>{/snippet}
</PageHeader>
<p class="text-[13px] text-mute">{t("Everyone you have sent a document to, saved so you can pick them next time.")}</p>
{#if problem}<p class="notice warn mt-3" role="alert" data-testid="people-problem">{problem}</p>{/if}
{#if edit}
  <div class="mt-4 grid gap-3 border-y border-line py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end" data-testid="people-form">
    <div class="grid gap-3 sm:contents"><label class="grid gap-1"><span class="text-[13px] font-medium">{t("First name")}</span><input class="field" bind:value={f.firstName} data-testid="people-first" /></label><label class="grid gap-1"><span class="text-[13px] font-medium">{t("Last name")}</span><input class="field" bind:value={f.lastName} data-testid="people-last" /></label></div>
    <label class="grid gap-1"><span class="text-[13px] font-medium">{t("Email")}</span><input class="field" type="email" bind:value={f.email} data-testid="people-email" /></label>
    <div class="flex gap-2"><button class="btn primary" onclick={save} data-testid="people-save">{t("Save")}</button><button class="btn quiet" onclick={() => (edit = null)}>{t("Cancel")}</button></div>
  </div>
{/if}
{#if source === "team"}
  <p class="mt-4 text-[13px] text-mute" data-testid="team-note">{t("Your teammates. They are managed in Settings → Team, and you can pick them when you choose who signs.")} <a class="text-link underline" href="/settings?tab=team">{t("Open Team")}</a></p>
  <ul class="mt-2" data-testid="team-list">{#each mates as m (m.id)}
    <li class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-2.5" data-testid={`team-row-${m.email}`}>
      <Avatar name={m.name} size={30} /><span class="min-w-0"><span class="block truncate text-[13px] font-medium text-ink">{m.name}{#if m.you} <span class="text-xs font-normal text-mute">({t("you")})</span>{/if}</span><span class="block truncate text-[12px] text-mute">{m.email}</span></span>
      <span class="flex items-center gap-2"><span class="chip" data-testid="team-tag">{t("Team")}</span><span class="text-[12px] text-mute">{({ owner: t("Owner"), admin: t("Admin"), member: t("Member") })[m.role] ?? m.role}</span></span></li>
  {:else}<li class="py-6 text-center text-[13px] text-mute">{t("No teammates yet.")}</li>{/each}</ul>
{:else}
<p class="mt-4 text-[12px] text-faint" data-testid="people-total">{t("Contacts")}: {total}</p>
<ul class="mt-1" data-testid="people-list">
  {#each rows as p (p.id)}
    <li class="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_110px_190px_auto]" data-testid={`people-row-${p.email}`}>
      <Avatar name={nameOf(p)} size={30} />
      <span class="min-w-0"><a class="block truncate text-[13px] font-medium text-ink no-underline hover:underline" href={`/contacts/${p.id}`} data-testid={`people-open-${p.email}`}>{nameOf(p)}</a><span class="block truncate text-[12px] text-mute">{p.email}<span class="ml-1.5 text-faint">· {({ form: t("Form"), signer: t("Signer"), manual: t("Added by hand") })[p.source] ?? p.source}</span></span></span>
      <span class="hidden items-center sm:flex" aria-hidden={(p.recent ?? []).length ? undefined : "true"}>{#each (p.recent ?? []) as d, i (d.id)}<span class="-ml-3 first:ml-0" style="z-index:{10 - i}"><Thumbnail width={22} kind={d.state === "executed" ? "sealed" : d.state} src={`/api/documents/pdf/${d.id}/thumb.png?w=120`} /></span>{/each}</span>
      <span class="col-span-3 col-start-2 row-start-2 text-[12px] text-mute sm:col-span-1 sm:col-start-auto sm:row-start-auto"><span class="block truncate">{whereIs(p)}</span><span class="block text-faint">{when(p.last_activity_at)}</span></span>
      <span class="flex items-center justify-end gap-1 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"><button class="btn quiet" onclick={() => start(p)}>{t("Edit")}</button><button class="btn quiet" onclick={() => drop(p)} data-testid={`people-del-${p.email}`}>{t("Remove")}</button></span>
    </li>
  {:else}{#if !loaded}<li data-testid="list-loading"><PageSkel kind="list" testid="people-skel" /></li>{:else}<li data-testid="people-empty"><EmptyState title={q.trim() ? t("No contacts match \"{q}\"", { q: q.trim() }) : t("No one yet")} line={q.trim() ? t("Check the spelling, or search by email address.") : t("Contacts appear here after you send a document or a form is filled in.")}>{#snippet art()}<Paper width={72} skeleton />{/snippet}</EmptyState></li>{/if}{/each}
</ul>
{/if}
{/if}
