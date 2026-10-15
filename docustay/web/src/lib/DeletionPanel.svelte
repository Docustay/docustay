<script>
  // Round 3: deleting your account or your workspace, the way people expect it — in the app, with a typed confirmation, a recent sign-in, a cooling-off period you can cancel in, and a download offered first.
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  let { wsName = "", show = "both" } = $props();   // "account" (Settings → Account, every member) | "workspace" (Workspace → Data, owners) | "both"
  let st = $state(null), loaded = $state(false);
  let openKind = $state(null), typed = $state(""), busy = $state(false), problem = $state(null), needSignIn = $state(false);
  async function load() { const r = await api("/api/account/deletion"); st = r.ok ? r.json : null; loaded = true; dispatchEvent(new CustomEvent("ds-deletion", { detail: { state: st } })); }
  onMount(load);
  const days = (n) => t("{n, plural, one {# day} other {# days}}", { n });
  function close() { openKind = null; typed = ""; problem = null; needSignIn = false; }
  async function request(kind) {
    busy = true; problem = null; needSignIn = false;
    const r = await api(kind === "account" ? "/api/account/deletion" : "/api/product/docustay/delete-workspace", { method: "POST", body: { confirm: typed } });
    busy = false;
    if (!r.ok) { if (r.json?.error?.detail?.code === "reauth_required") needSignIn = true; problem = r.error ?? t("That could not be done."); return; }
    close(); await load();
  }
  async function keep(kind) {
    busy = true; problem = null;
    const r = await api(kind === "account" ? "/api/account/deletion/cancel" : "/api/product/docustay/delete-workspace/cancel", { method: "POST", body: {} });
    busy = false;
    if (!r.ok) { problem = r.error ?? t("That could not be done."); return; }
    await load();
  }
  async function signInAgain() { await api("/api/auth/logout", { method: "POST", body: {} }); try { sessionStorage.setItem("ds-signed-out", "1"); } catch { /* ignore */ } await goto("/login"); }
</script>
{#snippet confirmBox(kind, label)}
  <label class="block text-sm" for="del-{kind}">{label}</label>
  <input id="del-{kind}" class="field w-full" bind:value={typed} autocomplete="off" data-testid="delete-{kind}-confirm" />
  {#if problem}<p class="text-sm text-bad" role="alert" data-testid="delete-{kind}-problem">{problem}</p>{/if}
  {#if needSignIn}<button class="btn" onclick={signInAgain} data-testid="delete-{kind}-signin">{t("Sign in again")}</button>{/if}
  <div class="flex gap-2"><button class="btn primary" disabled={busy || !typed.trim()} onclick={() => request(kind)} data-testid="delete-{kind}-go">{busy ? t("Working…") : t("Schedule deletion")}</button><button class="btn" onclick={close} data-testid="delete-{kind}-cancel">{t("Cancel")}</button></div>
{/snippet}
{#if loaded && st}
{#if show !== "workspace"}
<div class="mt-10 max-w-2xl space-y-3 rounded-xl border border-bad p-4" data-testid="delete-account">
  <h2 class="text-lg font-semibold">{t("Delete my account")}</h2>
  {#if st.account}
    <p class="notice warn" role="status" data-testid="delete-account-pending">{t("Your account will be deleted on {date}.", { date: whenText(st.account.scheduledFor, { dateStyle: "long" }) })}</p>
    <p class="text-sm text-mute">{t("Until then you can change your mind. Nothing has been removed yet.")}</p>
    {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
    <button class="btn primary" disabled={busy} onclick={() => keep("account")} data-testid="delete-account-keep">{t("Keep my account")}</button>
  {:else}
    <p class="text-sm text-mute">{t("This erases your name, email address and other details from this workspace and signs you out everywhere. Documents you already signed stay as the signed record, with your name as you signed it, because they are evidence of an agreement with other people. Documents you were asked to sign but had not signed are removed. You have {days} to change your mind.", { days: days(st.graceDays.account) })}</p>
    <p class="text-sm"><a class="underline" href="/api/account/export" data-testid="export-account">{t("Download my data first")}</a></p>
    {#if st.soleOwner}<p class="notice warn" data-testid="delete-account-sole-owner">{t("You are the only owner of this workspace. Make someone else an owner first, or delete the whole workspace instead.")}</p>
    {:else if openKind !== "account"}<button class="btn" onclick={() => { close(); openKind = "account"; }} data-testid="delete-account-open">{t("Delete my account…")}</button>
    {:else}{@render confirmBox("account", t("Type your email address to confirm"))}{/if}
  {/if}
</div>
{/if}
{#if show !== "account" && st.isOwner}
<div class="mt-10 max-w-2xl space-y-3 rounded-xl border border-bad p-4" data-testid="delete-workspace">
  <h2 class="text-lg font-semibold">{t("Delete this workspace")}</h2>
  {#if st.workspace}
    <p class="notice warn" role="status" data-testid="delete-workspace-pending">{t("This workspace will be deleted on {date}. Everything keeps working until then.", { date: whenText(st.workspace.scheduledFor, { dateStyle: "long" }) })}</p>
    {#if problem}<p class="text-sm text-bad" role="alert">{problem}</p>{/if}
    <button class="btn primary" disabled={busy} onclick={() => keep("workspace")} data-testid="delete-workspace-keep">{t("Keep this workspace")}</button>
  {:else}
    <p class="text-sm text-mute">{t("This removes the whole workspace for good: its documents and signed copies, templates, people, settings and sign-in sessions. Download everything first. Only an owner can do this, and a workspace with a paid plan has to cancel the plan first. Every owner is emailed, and you have {days} to change your mind.", { days: days(st.graceDays.workspace) })}</p>
    {#if openKind !== "workspace"}<button class="btn" onclick={() => { close(); openKind = "workspace"; }} data-testid="delete-workspace-open">{t("Delete this workspace…")}</button>
    {:else}{@render confirmBox("workspace", t("Type the workspace name to confirm") + (wsName ? ` (${wsName})` : ""))}{/if}
  {/if}
</div>
{/if}
{/if}
