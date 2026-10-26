<script>
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  // Which team a document or template belongs to. Shows nothing at all until the workspace has made a team.
  let { kind, id, current = null, onChange = () => {} } = $props();
  let teams = $state([]), value = $state(current ?? ""), note = $state(null), failed = $state(null);
  const loadT = async () => { const r = await api("/api/documents/teams"); failed = r.ok ? null : (r.error ?? t("Teams could not be loaded.")); if (r.ok) teams = r.json.teams ?? []; };   // R13-D448: a failed read is not "no teams" (which shows nothing at all)
  onMount(() => { loadT(); return live(["team"], loadT); });
  async function pick(e) {
    const v = e.currentTarget.value; note = null;
    const r = await api("/api/documents/teams/assign", { method: "POST", body: { kind, id, teamId: v || null } });
    if (!r.ok) { note = r.error ?? t("That could not be changed."); value = current ?? ""; return; }
    value = v; onChange(v || null);
  }
</script>
{#if failed}
  <span class="text-xs" role="alert" data-testid="team-picker-failed">{failed} <button class="btn quiet" onclick={loadT}>{t("Try again")}</button></span>
{:else if teams.length}
  <label class="flex items-center gap-2 text-sm text-mute">{t("Team")} <select class="field !w-auto !py-1" {value} onchange={pick} data-testid="team-picker"><option value="">{t("No team")}</option>{#each teams as tm}<option value={tm.id}>{tm.name}</option>{/each}</select></label>
  {#if note}<span class="text-xs text-bad" role="alert">{note}</span>{/if}
{/if}
