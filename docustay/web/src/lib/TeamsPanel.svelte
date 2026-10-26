<script>
  import ProLock from "$lib/pro/ProLock.svelte";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  // Teams: named groups. Work can belong to one team; a switch limits ordinary members to their teams' work (owners and admins always see everything).
  let { people = [] } = $props();
  let teams = $state(null), problem = $state(null), note = $state(null), name = $state(""), busy = $state(false), limit = $state(false), limitOffered = $state(false), openId = $state(null), edit = $state({});
  async function load() {
    const [tm, s] = await Promise.all([api("/api/documents/teams"), api("/api/documents/settings")]);
    if (tm.ok) teams = tm.json.teams ?? []; else problem = tm.error ?? t("Teams could not be loaded.");
    const lf = s.ok ? (s.json.groups ?? []).flatMap((g) => g.fields).find((f) => f.key === "teams.restrict_visibility") : null;
    limitOffered = Boolean(lf); limit = lf?.value === true;   // R13-D270: the switch shows only where the server offers the setting (Docustay leaves it out; ticking it answered "not a setting in Docustay")
  }
  onMount(() => { load(); return live(["team"], load); });
  const proNote = (r) => (r.status === 403 ? t("Teams are part of Docustay Pro.") : (r.error ?? t("That did not work.")));
  async function create(e) { e.preventDefault(); busy = true; note = null; const r = await api("/api/documents/teams", { method: "POST", body: { name } }); busy = false; if (!r.ok) { note = proNote(r); return; } name = ""; await load(); }
  async function rename(tm) { const r = await api("/api/documents/teams/rename", { method: "POST", body: { teamId: tm.id, name: edit[tm.id] ?? tm.name } }); note = r.ok ? null : r.error; await load(); }
  async function remove(tm) { if (!await ask(t("Delete the team “{name}”? Its documents and templates are kept and become unassigned.", { name: tm.name }))) return; const r = await api("/api/documents/teams/delete", { method: "POST", body: { teamId: tm.id } }); note = r.ok ? null : r.error; await load(); }
  async function toggle(tm, id, on) {
    const ids = new Set(tm.members.map((m) => m.id)); if (on) ids.add(id); else ids.delete(id);
    const r = await api("/api/documents/teams/members", { method: "POST", body: { teamId: tm.id, userRefs: [...ids] } }); note = r.ok ? null : r.error; await load();
  }
  async function setLimit(on) { const r = await api("/api/documents/settings", { method: "POST", body: { key: "teams.restrict_visibility", value: on } }); note = r.ok ? null : proNote(r); await load(); }
</script>
<section class="space-y-4" data-testid="teams-panel">
  <h2 class="text-lg font-semibold">{t("Teams")}</h2>
  <p class="text-sm text-mute">{t("Group your people, then put documents and templates in a team. Reports can be filtered by team.")}</p>
  {#if problem}<p class="text-bad" role="alert">{problem}</p>{:else if teams}
    {#if limitOffered}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={limit} onchange={(e) => setLimit(e.currentTarget.checked)} data-testid="restrict-visibility" />{t("Limit documents to their teams (owners and admins still see everything)")}</label>{/if}
    <ul class="divide-y divide-line rounded-xl border border-line" data-testid="team-list">
      {#each teams as tm (tm.id)}
        <li class="px-4 py-3"><div class="flex flex-wrap items-center gap-2"><strong>{tm.name}</strong><span class="text-xs text-mute">{t("{people, plural, one {# person} other {# people}} · {docs, plural, one {# document} other {# documents}} · {tpls, plural, one {# template} other {# templates}}", { people: tm.members.length, docs: tm.documents, tpls: tm.templates })}</span>
          <button class="btn !py-1 ml-auto" onclick={() => (openId = openId === tm.id ? null : tm.id)}>{openId === tm.id ? t("Close") : t("Edit")}</button></div>
          {#if openId === tm.id}
            <div class="mt-3 space-y-3"><div class="flex gap-2"><input class="field !w-60 !py-1.5" value={tm.name} oninput={(e) => (edit[tm.id] = e.currentTarget.value)} aria-label={t("Team name")} /><button class="btn" onclick={() => rename(tm)}>{t("Rename")}</button><button class="btn" onclick={() => remove(tm)}>{t("Delete team")}</button></div>
              <div class="grid gap-1 sm:grid-cols-2">{#each people as p (p.id)}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={tm.members.some((m) => m.id === p.id)} onchange={(e) => toggle(tm, p.id, e.currentTarget.checked)} />{p.display_name}</label>{/each}</div></div>
          {/if}</li>
      {:else}<li class="px-4 py-3 text-sm text-mute">{t("No teams yet.")}</li>{/each}
    </ul>
    <form class="flex flex-wrap items-center gap-2" onsubmit={create}><input class="field min-w-0 flex-1 basis-40 !w-auto !py-1.5" placeholder={t("New team name")} bind:value={name} aria-label={t("New team name")} required maxlength="80" /><ProLock item="team_roles" tip={t("Teams let you group people and what they see. Part of Pro.")}>{#snippet children(locked)}<button class="btn primary" disabled={busy || locked} data-testid="teams-add">{t("Add team")}</button>{/snippet}</ProLock></form>
  {:else}<p class="text-mute">{t("Loading…")}</p>{/if}
  {#if note}<p class="text-sm text-bad" role="alert" data-testid="teams-note">{note}</p>{/if}
</section>
