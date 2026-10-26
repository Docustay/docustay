<script>
  // Settings → Workspace → Team. R13-D067: the table now does what the routes already allowed: change a teammate's role, make someone Owner, remove a teammate,
  // and, while an invitation is still pending, re-send or cancel it (an invited person shows "Invited" until they accept). The server checks every one.
  import { cardTable } from "$lib/ui/cardTable.js";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import TeamsPanel from "$lib/TeamsPanel.svelte";
  import PlanPrompt from "$lib/pro/PlanPrompt.svelte";
  import { plan } from "$lib/pro/plan.svelte.js";
  import { edition } from "$lib/edition.svelte.js";
  import { chargeWords, SHORT } from "$lib/billing/billingModel.js";
  import Dialog from "$lib/ui/Dialog.svelte";
  import { handleRefusal } from "$lib/pro/planPrompt.svelte.js";
  let rows = $state(null), invites = $state([]), myEmail = $state(null), problem = $state(null), note = $state(null), name = $state(""), email = $state(""), phone = $state(""), rank = $state("member"), busy = $state(false), confirmRemove = $state(null);
  // owner-only "Reset two-step sign-in" on a teammate's row (20 Oct 2026): who has two-step on comes from the Security people list; only an owner is offered the button (the server refuses anyone else)
  let canReset = $state(false), hasTwo = $state({}), resetFor = $state(null), resetOpen = $state(false);
  const loadTwoStep = async () => { const s = await api("/api/settings/security"); canReset = s.ok && s.json?.canReset === true; const p = await api("/api/settings/security/people"); if (p.ok) hasTwo = Object.fromEntries((p.json.people ?? []).map((x) => [x.id, x.hasTwoStep])); };
  const low = (s) => String(s ?? "").trim().toLowerCase();
  const load = async () => {
    const [r, inv] = await Promise.all([api("/api/list/people/team"), api("/api/list/people/team/invites")]);
    if (r.ok) rows = r.json.rows ?? []; else problem = r.error ?? t("The team could not be loaded.");
    invites = inv.ok ? (inv.json.rows ?? []).filter((i) => i.status === "pending") : [];
    await loadTwoStep();
  };
  onMount(async () => { load(); const p = await api("/api/account/profile"); if (p.ok) myEmail = low(p.json.email); return live(["team"], load); });
  const pendingFor = (r) => invites.find((i) => low(i.email) === low(r.email)) ?? null;
  const roleName = (v) => ({ owner: t("Owner"), admin: t("Admin"), member: t("Member") })[v] ?? v;
  async function act(path, body, ok) {
    busy = true; note = null;
    const r = await api(path, { method: "POST", body });
    busy = false; note = r.ok ? ok : (r.error ?? t("That could not be done. Try again."));
    await load();
    return r.ok;
  }
  async function invite() {
    busy = true; note = null;
    const r = await api("/api/people/invite", { method: "POST", body: { email: email.trim(), displayName: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), role: "staff", staffRole: rank } });
    busy = false;
    if (!r.ok && await handleRefusal(r, { action: "invite_person" })) return;   // the plan sheet says where you stand and what each option gives
    note = r.ok ? t("Invitation sent to {email}.", { email: email.trim() }) : (r.error ?? t("The invitation could not be sent."));
    if (r.ok) { name = ""; email = ""; phone = ""; await load(); }
  }
  const setRole = (r, staffRole) => act("/api/people/staff-role", { personId: r.id, staffRole }, t("{name} is now {role}.", { name: r.display_name, role: roleName(staffRole) }));
  const resend = (r) => act("/api/people/invite", { personId: r.id, email: r.email, displayName: r.display_name, role: "staff", staffRole: r.staff_role === "owner" ? "admin" : r.staff_role }, t("Invitation sent again to {email}.", { email: r.email }));
  const cancel = (r, inv) => act("/api/people/invite/cancel", { inviteId: inv.id }, t("The invitation to {email} is cancelled.", { email: r.email }));
  const askReset = (r) => { resetFor = r; resetOpen = true; };
  async function doReset() { const r = resetFor; resetOpen = false; resetFor = null; if (r) await act("/api/settings/security/reset", { id: r.id }, t("Two-step sign-in was reset for {name}. We emailed them, and they are asked to set it up again when they next sign in.", { name: r.display_name })); }
  let confirmLeave = $state(false);
  // R13-D503: a member leaves on their own; the server refuses the only Owner with the way out, and that sentence is shown as it is
  async function leave() {
    busy = true; note = null;
    const r = await api("/api/people/leave", { method: "POST", body: {} });
    busy = false; confirmLeave = false;
    if (r.ok) { window.location.assign("/login"); return; }
    note = r.error ?? t("That could not be done. Try again.");
  }
  async function remove(r) {
    confirmRemove = null;
    await act(`/api/people/team/${r.id}/offboard`, { reassignments: [], futureSessions: { mode: "leave" } }, t("{name} is no longer on the team.", { name: r.display_name }));
  }
</script>
{#if problem}<p class="text-bad" role="alert" data-testid="team-failed">{problem} <button class="btn quiet" onclick={() => { problem = null; load(); }}>{t("Try again")}</button></p>{:else if !rows}<p class="text-mute">{t("Loading…")}</p>{:else}
<div class="min-w-0 space-y-8" data-testid="team-panel">
  <form class="rounded-xl border border-dashed border-line p-4" onsubmit={(e) => { e.preventDefault(); invite(); }} data-testid="team-invite-form"><p class="text-sm font-medium">{t("Invite a teammate")}</p>{#if confirmRemove == null}<PlanPrompt action="invite_person" id="invite" watch={rows?.length} />{/if}
    <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]"><input class="field !w-full !py-1.5" placeholder={t("Name")} bind:value={name} aria-label={t("Name")} required /><input class="field !w-full !py-1.5" type="email" placeholder={t("Email")} bind:value={email} aria-label={t("Email")} required /><input class="field !w-full !py-1.5" type="tel" placeholder={t("Phone (optional)")} bind:value={phone} aria-label={t("Phone (optional)")} />
      <select class="field !w-full !py-1.5" bind:value={rank} aria-label={t("Role")}><option value="admin">{t("Admin — Everything except deleting the workspace and resetting a teammate's two-step.")}</option><option value="member">{t("Member — Make, send and track their own documents; use templates and the plays that are switched on.")}</option></select><button class="btn primary" disabled={busy} data-testid="team-invite">{t("Send invitation")}</button></div>
    <ul class="mt-3 grid gap-1 text-[12.5px] text-mute" data-testid="team-charge-words">{#each chargeWords(edition.selfHost ? "selfhost" : (SHORT[plan.data?.plan?.key] ?? "free"), plan.data?.plans?.find((p) => p.key === "docustay_payg")?.priceMinor) as w}<li>{w}</li>{/each}</ul></form>
{#if note}<p class="text-sm" role="status" data-testid="team-note">{note}</p>{/if}
  <div class="overflow-x-auto rounded-xl border border-line"><table use:cardTable class="card-table w-full sm:min-w-[540px] text-left text-[15px]" data-testid="team-table"><thead class="bg-tint text-xs uppercase tracking-wide text-mute"><tr><th class="px-4 py-2.5">{t("Name")}</th><th class="px-4 py-2.5">{t("Email")}</th><th class="px-4 py-2.5">{t("Role")}</th><th class="px-4 py-2.5">{t("Status")}</th><th class="px-4 py-2.5"><span class="sr-only">{t("Actions")}</span></th></tr></thead>
    <tbody>{#each rows as r (r.id)}{@const inv = pendingFor(r)}{@const me = myEmail && low(r.email) === myEmail}<tr class="border-t border-line" data-testid="team-row">
      <td class="px-4 py-3">{r.display_name}{#if me}{" "}<span class="text-mute text-sm">({t("you")})</span>{/if}</td>
      <td class="px-4 py-3 text-mute [overflow-wrap:anywhere]">{r.email}</td>
      <td class="px-4 py-3">{#if me || r.staff_role === "owner"}{roleName(r.staff_role)}{:else}<select class="field !w-auto !py-1" value={r.staff_role} disabled={busy} aria-label={t("Role for {name}", { name: r.display_name })} data-testid="team-role" onchange={(e) => setRole(r, e.currentTarget.value)}><option value="admin">{t("Admin")}</option><option value="member">{t("Member")}</option></select>{/if}</td>
      <td class="px-4 py-3">{#if inv}<span class="text-mute" data-testid="team-pending">{t("Invited")}</span>{:else}{t("Active")}{/if}{#if !inv && r.id in hasTwo}<span class="block text-xs text-mute" data-testid="team-two-step">{hasTwo[r.id] ? t("Two-step on") : t("Two-step off")}</span>{/if}</td>
      <td class="px-4 py-3"><div class="flex flex-wrap justify-end gap-1.5">
        {#if inv}<button type="button" class="btn !py-1 whitespace-nowrap" disabled={busy} data-testid="team-resend" onclick={() => resend(r)}>{t("Resend")}</button><button type="button" class="btn !py-1 whitespace-nowrap" disabled={busy} data-testid="team-cancel" onclick={() => cancel(r, inv)}>{t("Cancel invite")}</button>{/if}
        {#if canReset && !me && !inv && hasTwo[r.id]}<button type="button" class="btn !py-1 whitespace-nowrap" disabled={busy} data-testid="team-reset-two-step" onclick={() => askReset(r)}>{t("Reset two-step sign-in")}</button>{/if}
        {#if me && r.staff_role !== "owner" && !inv}{#if confirmLeave}<button type="button" class="btn danger !py-1 whitespace-nowrap" disabled={busy} data-testid="team-leave-confirm" onclick={leave}>{t("Yes, leave")}</button><button type="button" class="btn !py-1" onclick={() => (confirmLeave = false)}>{t("Stay")}</button>{:else}<button type="button" class="btn !py-1 whitespace-nowrap" disabled={busy} data-testid="team-leave" onclick={() => (confirmLeave = true)}>{t("Leave this workspace")}</button>{/if}{/if}
        {#if !me && r.staff_role !== "owner" && !inv && edition.rank === "owner"}<button type="button" class="btn !py-1 whitespace-nowrap" disabled={busy} data-testid="team-make-owner" onclick={() => setRole(r, "owner")}>{t("Make Owner")}</button>{/if}
        {#if !me && !inv && (r.staff_role !== "owner" || edition.rank === "owner")}{#if confirmRemove === r.id}<button type="button" class="btn danger !py-1 whitespace-nowrap" disabled={busy} data-testid="team-remove-confirm" onclick={() => remove(r)}>{t("Yes, remove")}</button><button type="button" class="btn !py-1" onclick={() => (confirmRemove = null)}>{t("Keep")}</button>{:else}<button type="button" class="btn !py-1 whitespace-nowrap" disabled={busy} data-testid="team-remove" onclick={() => (confirmRemove = r.id)}>{t("Remove")}</button>{/if}{/if}
      </div></td></tr>{/each}</tbody></table></div>
  {#if confirmRemove != null}<PlanPrompt action="remove_person" id="remove" />{/if}
  <TeamsPanel people={rows} />
</div>
<Dialog bind:open={resetOpen} title={t("Reset two-step sign-in for {name}?", { name: resetFor?.display_name ?? "" })} description={t("This removes their authenticator app, passkeys, security keys and recovery codes. We email them to say so, and they are asked to set it up again when they next sign in.")} onclose={() => (resetFor = null)} testid="team-reset-dialog">
  {#snippet footer()}<button class="btn quiet" onclick={() => (resetOpen = false)}>{t("Keep it")}</button><button class="btn primary" disabled={busy} onclick={doReset} data-testid="team-reset-confirm">{t("Reset two-step sign-in")}</button>{/snippet}
</Dialog>
{/if}
