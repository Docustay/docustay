<script>
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  // Which team a document or template belongs to. Shows nothing at all until the workspace has made a team.
  let { kind, id, current = null, onChange = () => {} } = $props();
  let teams = $state([]), value = $state(current ?? ""), note = $state(null);
  const loadT = async () => { const r = await api("/api/documents/teams"); if (r.ok) teams = r.json.teams ?? []; };
  onMount(() => { loadT(); return live(["team"], loadT); });
  async function pick(e) {
    const v = e.currentTarget.value; note = null;
    const r = await api("/api/documents/teams/assign", { method: "POST", body: { kind, id, teamId: v || null } });
    if (!r.ok) { note = r.error ?? t("That could not be changed."); value = current ?? ""; return; }
    value = v; onChange(v || null);
  }
</script>
{#if teams.length}
  <label class="flex items-center gap-2 text-sm text-mute">{t("Team")} <select class="field !w-auto !py-1" {value} onchange={pick} data-testid="team-picker"><option value="">{t("No team")}</option>{#each teams as tm}<option value={tm.id}>{tm.name}</option>{/each}</select></label>
  {#if note}<span class="text-xs text-bad" role="alert">{note}</span>{/if}
{/if}
