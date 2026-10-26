<script>
  // Round 3: deleting your account or your workspace, the way people expect it — in the app, with a typed confirmation, a recent sign-in, a cooling-off period you can cancel in, and a download offered first.
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { inDemo } from "$lib/pro/plan.svelte.js";
  let { wsName = "", show = "both" } = $props();   // "account" (Settings → Account, every member) | "workspace" (Workspace → Data, owners) | "both"
  let st = $state(null), loaded = $state(false), failed = $state(null);
  let endedNote = $state(null), openKind = $state(null), understood = $state(false), typed = $state(""), busy = $state(false), problem = $state(null), needSignIn = $state(false);
  async function load() { if (await inDemo()) { st = null; loaded = true; return; } const r = await api("/api/account/deletion"); failed = r.ok ? null : (r.error ?? t("The delete options could not be loaded.")); st = r.ok ? r.json : null; loaded = true;   // R13-D448: a failed read is not "nothing to delete"
    dispatchEvent(new CustomEvent("ds-deletion", { detail: { state: st } })); }
  onMount(load);
  let deepLinked = false;   // ?delete=workspace (from the sole-owner notice on My account) opens the confirmation once
  $effect(() => { if (!deepLinked && loaded && show !== "account" && st?.isOwner && !st.workspace && page.url.searchParams.get("delete") === "workspace") { deepLinked = true; openKind = "workspace"; queueMicrotask(() => document.getElementById("delete-workspace")?.scrollIntoView({ block: "center" })); } });
  const days = (n) => t("{n, plural, one {# day} other {# days}}", { n });
  function close() { openKind = null; understood = false; typed = ""; problem = null; needSignIn = false; }
  async function request(kind) {
    busy = true; problem = null; needSignIn = false;
    const r = await api(kind === "account" ? "/api/account/deletion" : "/api/product/docustay/delete-workspace", { method: "POST", body: { confirm: typed, ...(kind === "workspace" ? { acknowledgePlanLoss: understood } : {}) } });
    busy = false;
    if (!r.ok) { if (r.json?.error?.detail?.code === "reauth_required") needSignIn = true; problem = r.error ?? t("That could not be done."); return; }
    if (kind === "workspace") endedNote = r.json?.planEnded ?? null;
    close(); await load();
  }
  async function keep(kind) {
    busy = true; problem = null;
    const r = await api(kind === "account" ? "/api/account/deletion/cancel" : "/api/product/docustay/delete-workspace/cancel", { method: "POST", body: {} });
    busy = false;
    if (!r.ok) { problem = r.error ?? t("That could not be done."); return; }
    endedNote = null; await load();
  }
  async function signInAgain() { await api("/api/auth/logout", { method: "POST", body: {} }); try { sessionStorage.setItem("ds-signed-out", "1"); } catch { /* ignore */ } await goto("/login"); }
</script>
{#snippet planNotice(p)}
  {#if p && p.kind !== "none"}
    <div class="notice warn space-y-2" role="alert" data-testid="delete-plan-notice">
      <p class="font-semibold">{p.kind === "lifetime" ? t("Deleting ends your Lifetime plan.") : t("Deleting ends your {plan} plan now.", { plan: p.planName })}</p>
      {#if p.kind === "lifetime"}<p>{t("Lifetime was a one-time purchase. You will lose it: it cannot be recovered, and Docustay gives no refunds.")}</p>
      {:else if p.daysLeft > 0}<p data-testid="delete-days-left">{t("{n, plural, one {You have # paid day left in this period.} other {You have # paid days left in this period.}}", { n: p.daysLeft })} {t("Those days are lost. They cannot be recovered, and Docustay gives no refunds and no credit for them.")}</p>
      {:else}<p>{t("Your plan is cancelled the moment you schedule the deletion. Docustay gives no refunds.")}</p>{/if}
      <label class="flex items-start gap-2 text-sm"><input type="checkbox" class="mt-1" bind:checked={understood} data-testid="delete-plan-understood" /><span>{p.kind === "lifetime" ? t("I understand my Lifetime plan ends now and cannot be recovered.") : t("I understand my plan ends now and the paid days left are lost.")}</span></label>
    </div>
  {/if}
{/snippet}
{#snippet confirmBox(kind, label)}
  <!-- R13-D402: the workspace button stays locked until the exact name is typed (case and outer spaces ignored, as the server checks) -->
  <label class="block text-sm" for="del-{kind}">{label}</label>
  <input id="del-{kind}" class="field w-full" bind:value={typed} autocomplete="off" data-testid="delete-{kind}-confirm" />
  {#if problem}<p class="text-sm text-bad" role="alert" data-testid="delete-{kind}-problem">{problem}</p>{/if}
  {#if needSignIn}<button class="btn" onclick={signInAgain} data-testid="delete-{kind}-signin">{t("Sign in again")}</button>{/if}
  <div class="flex gap-2"><button class="btn primary" disabled={busy || !typed.trim() || (kind === "workspace" && wsName && typed.trim().toLowerCase() !== wsName.trim().toLowerCase()) || (kind === "workspace" && st.plan && st.plan.kind !== "none" && !understood)} onclick={() => request(kind)} data-testid="delete-{kind}-go">{busy ? t("Working…") : t("Schedule deletion")}</button><button class="btn" onclick={close} data-testid="delete-{kind}-cancel">{t("Cancel")}</button></div>
{/snippet}
{#if loaded && st}
{#if show !== "workspace"}
<div class="space-y-3 rounded-xl border border-bad p-4" data-testid="delete-account">
  <h2 class="text-lg font-semibold">{t("Delete my account")}</h2>
  {#if st.account}
    <p class="notice warn" role="status" data-testid="delete-account-pending">{t("Your account will be deleted on {date}.", { date: whenText(st.account.scheduledFor, { dateStyle: "long" }) })}</p>
    <p class="text-sm text-mute">{t("Until then you can change your mind. Nothing has been removed yet.")}</p>
    {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
    <button class="btn primary" disabled={busy} onclick={() => keep("account")} data-testid="delete-account-keep">{t("Keep my account")}</button>
  {:else}
    <p class="text-sm text-mute">{t("This erases your name, email address and other details from this workspace and signs you out everywhere. Documents you already signed stay as the signed record, with your name as you signed it, because they are evidence of an agreement with other people. Documents you were asked to sign but had not signed are removed. You have {days} to change your mind.", { days: days(st.graceDays.account) })}</p>
    <p class="text-sm"><a class="inline-flex min-h-6 items-center underline" href="/api/account/export" download="docustay-my-data.json" data-sveltekit-reload data-testid="export-account">{t("Download my data first")}</a></p>
    {#if st.soleOwner}<div class="notice warn space-y-2" data-testid="delete-account-sole-owner"><p>{t("You are the only owner of this workspace. Make someone else an owner first, or delete the whole workspace instead.")}</p>
      <p class="flex flex-wrap gap-x-4 gap-y-1"><a data-sveltekit-reload class="inline-flex min-h-6 items-center underline" href="/settings?tab=data&delete=workspace#delete-workspace" data-testid="sole-owner-to-workspace">{t("Go to Delete this workspace")}</a><a data-sveltekit-reload class="btn !min-h-9" href="/settings?tab=data&delete=workspace#delete-workspace" data-testid="sole-owner-both">{t("Delete the workspace and my account together")}</a></p>
      <p class="text-xs">{t("Deleting the workspace removes everyone's account in it, including yours, and your sign-in unless you also use it in another workspace.")}</p></div>
    {:else if openKind !== "account"}<button class="btn" onclick={() => { close(); openKind = "account"; }} data-testid="delete-account-open">{t("Delete my account…")}</button>
    {:else}{@render confirmBox("account", t("Type your email address to confirm"))}{/if}
  {/if}
</div>
{/if}
{#if show !== "account" && st.isOwner}
<div id="delete-workspace" class="space-y-3 rounded-xl border border-bad p-4" data-testid="delete-workspace">
  <h2 class="text-lg font-semibold">{t("Delete this workspace")}</h2>
  {#if st.workspace}
    <p class="notice warn" role="status" data-testid="delete-workspace-pending">{t("This workspace will be deleted on {date}. Everything keeps working until then.", { date: whenText(st.workspace.scheduledFor, { dateStyle: "long" }) })}</p>
    {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
    {#if endedNote}<p class="notice warn" data-testid="delete-plan-ended">{endedNote.kind === "lifetime" ? t("Your Lifetime plan ended today. It cannot be recovered.") : endedNote.daysLost > 0 ? t("Your {plan} plan was cancelled today. {n, plural, one {# paid day was lost.} other {# paid days were lost.}}", { plan: endedNote.planName, n: endedNote.daysLost }) : t("Your {plan} plan was cancelled today.", { plan: endedNote.planName })}</p>{/if}
    <p class="text-sm text-mute" data-testid="delete-keep-free">{t("If you press “Keep this workspace”, it comes back on the Free plan. A paid plan that was cancelled for this deletion is not restored; you can choose a plan again in Billing.")}</p>
    <button class="btn primary" disabled={busy} onclick={() => keep("workspace")} data-testid="delete-workspace-keep">{t("Keep this workspace")}</button>
  {:else}
    <p class="text-sm text-mute">{t("This removes the whole workspace for good: its documents and signed copies, templates, people, settings and sign-in sessions. Download everything first. Only an owner can do this. A paid plan ends at once (you are told what is lost before you confirm). Every owner is emailed, and you have {days} to change your mind. If you do, the workspace comes back on the Free plan.", { days: days(st.graceDays.workspace) })}</p>
    {@render planNotice(st.plan)}
    {#if openKind !== "workspace"}<button class="btn" onclick={() => { close(); openKind = "workspace"; }} data-testid="delete-workspace-open">{t("Delete this workspace…")}</button>
    {:else}{@render confirmBox("workspace", t("Type the workspace name to confirm") + (wsName ? ` (${wsName})` : ""))}{/if}
  {/if}
</div>
{/if}
{:else if loaded && failed}
<div class="space-y-3 rounded-xl border border-line p-4" data-testid="delete-options-failed" role="alert">
  <h2 class="text-lg font-semibold">{t("Delete my account")}</h2>
  <p class="text-sm">{failed} <button class="btn quiet" onclick={load}>{t("Try again")}</button></p>
</div>
{/if}
