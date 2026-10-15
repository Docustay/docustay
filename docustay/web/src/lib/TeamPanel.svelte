<script>
  import { cardTable } from "$lib/ui/cardTable.js";
  import ProLock from "$lib/pro/ProLock.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import TeamsPanel from "$lib/TeamsPanel.svelte";
  let rows = $state(null), problem = $state(null), note = $state(null), name = $state(""), email = $state(""), phone = $state(""), rank = $state("member"), busy = $state(false);
  const load = async () => { const r = await api("/api/list/people/team"); if (r.ok) rows = r.json.rows ?? []; else problem = r.error ?? t("The team could not be loaded."); };
  onMount(() => { load(); return live(["team"], load); });
  async function invite() {
    busy = true; note = null;
    const r = await api("/api/people/invite", { method: "POST", body: { email: email.trim(), displayName: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), role: "staff", staffRole: rank } });
    busy = false; note = r.ok ? t("Invitation sent to {email}.", { email: email.trim() }) : (r.error ?? t("The invitation could not be sent."));
    if (r.ok) { name = ""; email = ""; phone = ""; await load(); }
  }
</script>
{#if problem}<p class="text-bad" role="alert">{problem}</p>{:else if !rows}<p class="text-mute">{t("Loading…")}</p>{:else}
<div class="max-w-3xl space-y-5">
  <div class="overflow-x-auto rounded-xl border border-line"><table use:cardTable class="card-table w-full min-w-[420px] text-left text-[15px]"><thead class="bg-tint text-xs uppercase tracking-wide text-mute"><tr><th class="px-4 py-2.5">{t("Name")}</th><th class="px-4 py-2.5">{t("Email")}</th><th class="px-4 py-2.5">{t("Role")}</th></tr></thead>
    <tbody>{#each rows as r (r.id)}<tr class="border-t border-line"><td class="px-4 py-3">{r.display_name}</td><td class="px-4 py-3 text-mute">{r.email}</td><td class="px-4 py-3">{({ owner: t("Owner"), admin: t("Admin"), member: t("Member") })[r.staff_role] ?? r.staff_role}</td></tr>{/each}</tbody></table></div>
  <form class="space-y-2 rounded-xl border border-dashed border-line p-4" onsubmit={(e) => { e.preventDefault(); invite(); }}><p class="text-sm font-medium">{t("Invite a teammate")}</p>
    <div class="flex flex-wrap gap-2"><input class="field !w-48 !py-1.5" placeholder={t("Name")} bind:value={name} aria-label={t("Name")} required /><input class="field !w-60 !py-1.5" type="email" placeholder={t("Email")} bind:value={email} aria-label={t("Email")} required /><input class="field !w-44 !py-1.5" type="tel" placeholder={t("Phone (optional)")} bind:value={phone} aria-label={t("Phone")} autocomplete="tel" />
      <select class="field !w-auto max-w-full !py-1.5" bind:value={rank} aria-label={t("Role")}><option value="admin">{t("Admin — everything except deleting the workspace")}</option><option value="member">{t("Member — send and track documents")}</option></select><ProLock item="team_roles" tip={t("Pro adds your team, with unlimited users and roles. On Free the owner is the one user.")}>{#snippet children(locked)}<button class="btn primary" disabled={busy || locked} data-testid="team-invite">{t("Send invitation")}</button>{/snippet}</ProLock></div></form>
  {#if note}<p class="text-sm" role="status" data-testid="team-note">{note}</p>{/if}
  <TeamsPanel people={rows} />
</div>{/if}
