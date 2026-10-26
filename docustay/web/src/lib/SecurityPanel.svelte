<script>
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { deviceText } from "$lib/i18n/deviceText.js";
  import Pager from "$lib/ui/Pager.svelte";
  import DataTable from "$lib/ui/DataTable.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  import SetupWizard from "$lib/twostep/SetupWizard.svelte";
  import ProofDialog from "$lib/twostep/ProofDialog.svelte";
  import RecoveryCodes from "$lib/twostep/RecoveryCodes.svelte";
  import Dialog from "$lib/ui/Dialog.svelte";
  import PasswordSection from "$lib/PasswordSection.svelte";
  // Settings → Security: your own two-step sign-in (ways to confirm it's you, recovery codes, remembered devices, recent activity), the workspace rule that makes it compulsory, and where you are signed in.
  let ov = $state(null), policy = $state(null), sessions = $state([]), current = $state(null), people = $state(null), sessionsFailed = $state(null), accessFailed = $state(null);
  let adding = $state(false), msg = $state(null), newCodes = $state(null), renaming = $state(null), renameTo = $state(""), graceDays = $state(7);
  const when = (x) => whenText(x);
  async function load() {
    const [o, p, l] = await Promise.all([api("/api/auth/two-step/overview"), api("/api/settings/security"), api("/api/auth/sessions")]);
    sessionsFailed = l.ok ? null : (l.error ?? t("Your sign-ins could not be loaded."));   // R13-D448: a failed read is not an empty list of sign-ins
    ov = o.ok ? o.json : null; policy = p.ok ? p.json : null; sessions = l.ok ? l.json.sessions ?? [] : []; current = l.ok ? l.json.current : null;
    if (policy?.canChange) { const r = await api("/api/settings/security/people"); people = r.ok ? r.json.people ?? [] : null; }
  }
  onMount(() => { load(); return live(["team"], load); });

  // ── the proof: your current second step, asked before anything that changes it ─────────────────
  let proofOpen = $state(false), proofReq = $state({ title: "", description: "", label: "", run: async () => null }), proofDone = null, proofSucceeded = false;
  /** Runs `run(proof)`. With two-step off there is nothing to prove; otherwise the dialog asks and keeps asking until it works or is closed ("cancelled"). */
  function askProof(title, run, { description = "", label = "" } = {}) {
    if (!ov?.on) return run(undefined);
    return new Promise((resolve) => {
      proofSucceeded = false; proofDone = resolve;
      proofReq = { title, description, label, run: async (proof) => { const err = await run(proof); if (!err) proofSucceeded = true; return err; } };
      proofOpen = true;
    });
  }
  $effect(() => { if (!proofOpen && proofDone) { const d = proofDone; proofDone = null; d(proofSucceeded ? null : "cancelled"); } });

  const methodCount = $derived((ov?.passkeys?.length ?? 0) + (ov?.authenticatorApp?.on ? 1 : 0));
  const ACTIVITY = $derived({ two_step_on: t("Two-step sign-in turned on"), two_step_off: t("Two-step sign-in turned off"), authenticator_added: t("Authenticator app added"), authenticator_removed: t("Authenticator app removed"),
    passkey_added: t("Passkey added"), passkey_removed: t("Passkey removed"), passkey_renamed: t("Passkey renamed"), security_key_added: t("Security key added"), security_key_removed: t("Security key removed"),
    recovery_codes_made: t("New recovery codes made"), recovery_code_used: t("Recovery code used to sign in"), device_remembered: t("Device remembered"), devices_forgotten: t("Remembered devices forgotten"),
    reset_by_owner: t("Reset by a workspace owner"), reminder_sent: t("Reminder sent by a workspace owner"), password_changed: t("Password changed") });
  let actPage = $state(1); const ACT_PER = 6;

  async function afterAdd() { adding = false; await load(); }
  function removeMethod(m) {
    const last = methodCount === 1;
    askProof(t("Remove this way"), async (proof) => {
      const r = m.kind === "totp" ? await api("/api/auth/two-step/authenticator/remove", { method: "POST", body: { proof } }) : await api("/api/auth/passkeys/remove", { method: "POST", body: { id: m.id, proof } });
      return r.ok ? null : r.error ?? t("Something went wrong. Try again.");
    }, { description: last ? t("This is your only way to confirm it's you. Removing it turns two-step sign-in off.") : t("You will no longer be able to use it to sign in."), label: t("Remove") }).then(async (e) => { if (!e) { toast(last ? t("Two-step sign-in is off") : t("Removed")); await load(); } });
  }
  async function rename(m) { const r = await api("/api/auth/passkeys/rename", { method: "POST", body: { id: m.id, name: renameTo.trim() } }); if (!r.ok) msg = r.error; renaming = null; await load(); }
  function makeCodes() {
    askProof(t("Make new recovery codes"), async (proof) => {
      const r = await api("/api/auth/two-step/recovery-codes", { method: "POST", body: { proof } });
      if (!r.ok) return r.error ?? t("Something went wrong. Try again.");
      newCodes = r.json?.data?.codes ?? r.json?.codes ?? []; return null;
    }, { description: t("Your old codes stop working the moment new ones are made.") }).then((e) => { if (!e) load(); });
  }
  function rememberHere() {
    askProof(t("Remember this device"), async (proof) => { const r = await api("/api/auth/two-step/devices/remember", { method: "POST", body: { proof } }); return r.ok ? null : r.error ?? t("Something went wrong. Try again."); },
      { description: t("On this device you will skip the second step for 30 days. Only do this on a device you own.") }).then(async (e) => { if (!e) { toast(t("This device is remembered for 30 days")); await load(); } });
  }
  async function forgetDevices(id = null) { const r = await api("/api/auth/two-step/devices/forget", { method: "POST", body: id ? { id } : {} }); if (!r.ok) msg = r.error; else toast(t("Forgotten")); await load(); }
  function turnOff() {
    askProof(t("Turn off two-step sign-in"), async (proof) => { const r = await api("/api/auth/two-step/disable", { method: "POST", body: { proof } }); return r.ok ? null : r.error ?? t("That code was not accepted."); },
      { description: t("Signing in will only need your password or email code. Enter a current code to confirm."), label: t("Turn off") }).then(async (e) => { if (!e) { toast(t("Two-step sign-in is off")); await load(); } });
  }

  // ── workspace rules ────────────────────────────────────────────────────────────────────────────
  let access = $state(null);   // Run 7: the access log (always on), shown to owners and admins
  let logPage = $state(1); const LOG_PER = 10;
  const LOG_COLS = [{ key: "who", label: t("Who") }, { key: "did", label: t("Did") }, { key: "what", label: t("Document") }, { key: "when", label: t("When"), align: "right" }];
  const logRows = $derived((access?.events ?? []).slice((logPage - 1) * LOG_PER, logPage * LOG_PER));
  async function loadAccess() { const r = await api("/api/documents/access-log"); accessFailed = r.ok ? null : (r.error ?? t("The access log could not be loaded.")); access = r.ok ? (r.json?.data ?? r.json) : null; }   // R13-D448: a failed read is not "Nothing yet"
  $effect(() => { if (policy?.canChange) loadAccess(); });
  async function idle(m) { msg = null; const r = await api("/api/settings/security", { method: "POST", body: { idleMinutes: m } }); if (!r.ok) msg = r.error; await load(); }
  async function setMode(mode) { msg = null; const r = await api("/api/settings/security", { method: "POST", body: { mode, days: graceDays } }); if (!r.ok) msg = r.error; else toast(t("Saved")); await load(); }
  async function remind(p) { const r = await api("/api/settings/security/remind", { method: "POST", body: { id: p.id } }); if (!r.ok) msg = r.error; else toast(t("Reminder sent to {name}", { name: p.name || p.email })); }
  async function reset(p) {
    if (!(await ask(t("Remove {name}'s two-step sign-in? They will set it up again.", { name: p.name || p.email }), { yes: t("Reset"), danger: true }))) return;
    const r = await api("/api/settings/security/reset", { method: "POST", body: { id: p.id } }); if (!r.ok) msg = r.error; else toast(t("Reset")); await load();
  }
  async function revoke(id) { await api("/api/auth/sessions/revoke", { method: "POST", body: { tokenId: id } }); await load(); }
  async function revokeOthers() { await api("/api/auth/sessions/revoke", { method: "POST", body: { all: true } }); await load(); }
  const methods = $derived([...(ov?.authenticatorApp?.on ? [{ kind: "totp", id: "totp", name: t("Authenticator app"), since: ov.authenticatorApp.since }] : []), ...(ov?.passkeys ?? []).map((p) => ({ ...p, kind: p.kind === "security_key" ? "security_key" : "passkey" }))]);
  const mode = $derived(policy?.mode ?? "off");
</script>
<div class="space-y-10" data-testid="security-panel">
  {#if msg}<p class="rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{msg}</p>{/if}
  <div>
    <h2 class="sec-group">{t("Your sign-in")}</h2>
    <div class="sec-two mt-3">
      <div class="space-y-8">
  <PasswordSection {askProof} onchanged={load} />
  <section data-testid="two-step-section"><h2 class="text-lg font-semibold">{t("Two-step sign-in")}</h2>
    <p class="mt-1 text-sm text-mute">{t("After your password or email code, you also confirm it's you with a passkey, an authenticator app or a security key.")}</p>
    {#if policy?.youMustUseTwoStep && !ov?.on}<p class="notice warn mt-3" role="alert" data-testid="two-step-required">{t("Your workspace requires two-step sign-in. Set it up to carry on.")}</p>
    {:else if policy?.youWillNeedTwoStep && !ov?.on}<p class="notice warn mt-3" role="alert" data-testid="two-step-grace">{t("{n, plural, one {Your workspace will require two-step sign-in in # day.} other {Your workspace will require two-step sign-in in # days.}}", { n: policy.graceDaysLeft ?? 0 })}</p>{/if}
    {#if adding || (ov && !ov.on && adding)}
      <div class="mt-4 rounded-xl border border-line p-4 sm:p-6"><SetupWizard overview={ov} {askProof} first={!ov?.on} oncancel={() => (adding = false)} ondone={afterAdd} /></div>
    {:else if ov?.on}
      <p class="mt-3 text-sm" data-testid="two-step-on"><span class="inline-flex items-center gap-1 font-medium text-ok"><Icon name="check" size={14} />{t("On")}</span></p>
      <ul class="mt-3 divide-y divide-line rounded-xl border border-line" data-testid="methods">
        {#each methods as m (m.id)}
          <li class="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm" data-testid="method-row">
            <Icon name={m.kind === "totp" ? "smartphone" : m.kind === "security_key" ? "key" : "fingerprint"} size={18} />
            {#if renaming === m.id}
              <form class="flex min-w-0 flex-1 gap-2" onsubmit={(e) => { e.preventDefault(); rename(m); }}><input class="field min-w-0 flex-1" bind:value={renameTo} maxlength="80" aria-label={t("Name")} data-testid="rename-input" /><button class="btn !min-h-9 primary" data-testid="rename-save">{t("Save")}</button><button type="button" class="btn quiet !min-h-9" onclick={() => (renaming = null)}>{t("Cancel")}</button></form>
            {:else}
              <span class="min-w-0 flex-1"><span class="font-medium">{m.kind === "totp" ? t("Authenticator app") : m.name === "My passkey" ? t("My passkey") : m.name}</span>
                <span class="block text-xs text-mute">{m.kind === "totp" ? (m.since ? t("added {date}", { date: when(m.since) }) : "") : m.kind === "security_key" ? t("Security key") : t("Passkey")}{#if m.kind !== "totp"}{" · "}{m.lastUsedAt ? t("used {date}", { date: when(m.lastUsedAt) }) : t("never used")}{/if}</span></span>
              {#if m.kind !== "totp"}<button class="btn quiet !min-h-9" onclick={() => { renaming = m.id; renameTo = m.name; }} data-testid="method-rename">{t("Rename")}</button>{/if}
              <button class="btn quiet !min-h-9" onclick={() => removeMethod(m)} data-testid="method-remove">{t("Remove")}</button>
            {/if}
          </li>{/each}
      </ul>
      <button class="btn mt-3" onclick={() => (adding = true)} data-testid="add-method">{t("Add another way")}</button>
    {:else if ov}
      <button class="btn primary mt-3" onclick={() => (adding = true)} data-testid="two-step-start">{t("Set up two-step")}</button>
    {/if}
  </section>

  {#if ov?.on && !adding}
    <section data-testid="recovery-section"><h2 class="text-lg font-semibold">{t("Recovery codes")}</h2>
      <p class="mt-1 text-sm text-mute" data-testid="recovery-left">{t("{n, plural, one {# recovery code left.} other {# recovery codes left.}}", { n: ov.recoveryLeft })} {t("They get you in if you lose your phone or key.")}</p>
      <button class="btn mt-3" onclick={makeCodes} data-testid="recovery-new">{t("Make new codes")}</button>
    </section>
    <section data-testid="devices-section"><h2 class="text-lg font-semibold">{t("Remember this device")}</h2>
      <p class="mt-1 text-sm text-mute">{t("Skip the second step on a device you own for 30 days. Changing any way above forgets every device.")}</p>
      {#if ov.devices.length}<ul class="mt-3 divide-y divide-line rounded-xl border border-line" data-testid="devices">{#each ov.devices as d (d.id)}<li class="flex items-center gap-3 px-3 py-2 text-sm"><span class="min-w-0 flex-1">{d.label}<span class="block text-xs text-mute">{t("until {date}", { date: when(d.expiresAt) })}</span></span><button class="btn quiet !min-h-9" onclick={() => forgetDevices(d.id)} data-testid="device-forget">{t("Forget")}</button></li>{/each}</ul>{/if}
      <div class="mt-3 flex flex-wrap gap-2">{#if !ov.thisDeviceRemembered}<button class="btn" onclick={rememberHere} data-testid="remember-here">{t("Remember this device for 30 days")}</button>{:else}<span class="text-sm text-mute" data-testid="this-remembered">{t("This device is remembered.")}</span>{/if}{#if ov.devices.length}<button class="btn quiet" onclick={() => forgetDevices()} data-testid="devices-forget-all">{t("Forget all devices")}</button>{/if}</div>
    </section>
    <section data-testid="turn-off-section"><h2 class="text-lg font-semibold">{t("Turn off")}</h2>
      <p class="mt-1 text-sm text-mute">{t("Go back to signing in with only your password or email code. You will need a current code to do this.")}</p>
      <button class="btn danger mt-3" onclick={turnOff} data-testid="two-step-off">{t("Turn off two-step sign-in")}</button>
    </section>
  {/if}
  {#if ov && !adding && (ov.on || ov.activity.length)}
  <section data-testid="activity-section"><h2 class="text-lg font-semibold">{t("Recent activity")}</h2>
      {#if ov.activity.length}
        <ul class="mt-3 divide-y divide-line rounded-xl border border-line" data-testid="activity">{#each ov.activity.slice((actPage - 1) * ACT_PER, actPage * ACT_PER) as a (a.id)}<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{ACTIVITY[a.kind] ?? a.kind}{#if a.detail?.name}{" · "}{a.detail.name}{/if}</span><span class="shrink-0 text-xs text-mute">{when(a.at)}</span></li>{/each}</ul>
        <Pager total={ov.activity.length} per={ACT_PER} bind:page={actPage} testid="activity-pager" />
      {:else}<p class="mt-2 text-sm text-mute">{t("Nothing yet.")}</p>{/if}
    </section>
  {/if}
      </div>
  <section><h2 class="text-lg font-semibold">{t("Where you are signed in")}</h2>
    {#if sessionsFailed}<p class="mt-2 text-sm" role="alert" data-testid="sessions-failed">{sessionsFailed} <button class="btn quiet" onclick={load}>{t("Try again")}</button></p>{:else}
    <ul class="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="sessions">
      {#each sessions as s (s.tokenId)}<li class="flex items-center justify-between gap-3 px-4 py-2 text-sm"><span>{deviceText(s.device, s.userAgentSummary)} · {t("signed in {date}", { date: when(s.createdAt) })}{#if s.tokenId === current} <strong class="ml-1">({t("this device")})</strong>{/if}</span>
        {#if s.tokenId !== current}<button class="btn !py-1" onclick={() => revoke(s.tokenId)}>{t("Sign out")}</button>{/if}</li>{/each}
    </ul>{/if}
    <p class="mt-2 text-xs text-mute" data-testid="device-limit-note">{t("One login per person. A Free workspace can be signed in on 3 devices at once; signing in on a fourth signs out the oldest. Pay as you go, Pro and Lifetime have no device limit.")}</p>
    {#if !sessionsFailed && sessions.length > 1}<button class="btn mt-2" onclick={revokeOthers} data-testid="sign-out-others">{t("Sign out everywhere else")}</button>{/if}</section>
    </div>
  </div>
  {#if policy?.canChange}
    <div>
      <h2 class="sec-group">{t("Workspace rules")}</h2>
      <div class="pg-sections mt-3" style="--col: 26rem; --row: 2rem">
    <section data-testid="require-section"><h2 class="text-lg font-semibold">{t("Require it for everyone")}</h2>
      <p class="mt-1 text-sm text-mute">{t("Make everyone on your team set up two-step sign-in, straight away or after a few days to get ready.")}</p>
      <div class="mt-3 grid gap-2" role="radiogroup" aria-label={t("Require it for everyone")}>
        {#each [["off", t("Off"), t("Nobody has to.")], ["grace", t("Give people {n} days", { n: graceDays }), t("A notice with the days left shows until they have set it up.")], ["now", t("Required now"), t("Nobody can use the workspace until they have set it up.")]] as [k, label, hint] (k)}
          <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm {mode === k ? 'border-brand bg-tint' : ''}"><input type="radio" name="require-mode" checked={mode === k} disabled={k !== "off" && !policy.youHaveTwoStep && mode === "off"} onchange={() => setMode(k)} data-testid="require-{k}" class="mt-1" /><span><span class="font-medium">{label}</span><span class="block text-xs text-mute">{hint}</span></span></label>{/each}
      </div>
      {#if mode === "off"}<label class="mt-2 flex items-center gap-2 text-xs text-mute">{t("Days to get ready")}<select class="field w-auto" bind:value={graceDays} data-testid="grace-days">{#each [3, 7, 14, 30] as d (d)}<option value={d}>{d}</option>{/each}</select></label>{/if}
      {#if mode === "grace" && policy.graceDaysLeft != null}<p class="mt-2 text-xs text-mute" data-testid="grace-left">{t("{n, plural, one {# day left before it is required.} other {# days left before it is required.}}", { n: policy.graceDaysLeft })}</p>{/if}
      {#if !policy.youHaveTwoStep && mode === "off"}<p class="mt-1 text-xs text-mute">{t("Set it up for yourself first.")}</p>{/if}
      {#if people}
        <h3 class="mt-5 text-sm font-semibold">{t("Who has set it up")}</h3>
        <ul class="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="people">{#each people as p (p.id)}
          <li class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span class="min-w-0 flex-1"><span class="font-medium">{p.name || p.email}</span>{#if p.you}{" "}<span class="text-xs text-mute">({t("you")})</span>{/if}</span>
            {#if p.hasTwoStep}<span class="inline-flex items-center gap-1 text-xs text-ok"><Icon name="check" size={12} />{t("Set up")}</span>{#if !p.you && policy?.canReset}<button class="btn quiet !min-h-9" onclick={() => reset(p)} data-testid="person-reset">{t("Reset")}</button>{/if}
            {:else}<span class="text-xs text-warn">{t("Not yet")}</span>{#if !p.you}<button class="btn quiet !min-h-9" onclick={() => remind(p)} data-testid="person-remind">{t("Remind")}</button>{/if}{/if}</li>{/each}</ul>
      {/if}
    </section>
    <section><h2 class="text-lg font-semibold">{t("Sign out when idle")}</h2>
      <p class="mt-1 text-sm text-mute">{t("Sign people out after a period without activity. They sign in again to carry on; nothing they saved is lost.")}</p>
      <label class="mt-3 flex flex-wrap items-center gap-2 text-sm">{t("Sign out after")}
        <select class="field w-auto" value={String(policy.idleMinutes)} onchange={(e) => idle(Number(e.currentTarget.value))} data-testid="idle-minutes">
          {#each [0, 15, 30, 60, 240, 480] as m (m)}<option value={String(m)}>{m === 0 ? t("Never") : m < 60 ? t("{n, plural, one {# minute} other {# minutes}}", { n: m }) : t("{n, plural, one {# hour} other {# hours}}", { n: m / 60 })}</option>{/each}
        </select></label>
      </section>
      </div>
    </div>
    {#if accessFailed}
      <section data-testid="access-log"><h2 class="sec-group">{t("Access log")}</h2><p class="mt-2 text-sm" role="alert" data-testid="access-log-failed">{accessFailed} <button class="btn quiet" onclick={loadAccess}>{t("Try again")}</button></p></section>
    {:else if access}
      <section data-testid="access-log">
        <div class="flex flex-wrap items-end gap-2"><div><h2 class="sec-group">{t("Access log")}</h2>
          <p class="mt-1 text-sm text-mute">{t("Every time someone on your team opens, downloads or exports a document. Kept for as long as the workspace exists.")}</p></div>
          <a data-sveltekit-reload class="btn ml-auto" href="/api/documents/access-log.csv" data-testid="access-log-csv">{t("Download CSV")}</a></div>
        <div class="mt-3">
          <DataTable columns={LOG_COLS} rows={logRows} caption={t("Access log")} testid="access-log-table">
            {#snippet cell(e, c)}
              {#if c.key === "who"}<span class="font-medium">{e.user_name ?? e.user_email ?? t("Someone")}</span>
              {:else if c.key === "did"}{e.action === "view" ? t("opened") : e.action === "download" ? t("downloaded") : t("exported")}
              {:else if c.key === "what"}<span class="block max-w-[44ch] truncate">{e.title ?? e.what ?? ""}{e.title && e.what ? ` · ${e.what}` : ""}</span>
              {:else}<span class="text-mute">{when(e.at)}</span>{/if}
            {/snippet}
            {#snippet empty()}<p class="rounded-xl border border-line px-4 py-6 text-center text-sm text-mute" data-testid="access-log-empty">{t("Nothing yet. Opening a document adds the first line.")}</p>{/snippet}
          </DataTable>
          <Pager total={(access.events ?? []).length} per={LOG_PER} bind:page={logPage} testid="access-log-pager" />
        </div>
      </section>
    {/if}
  {/if}
</div>
<ProofDialog bind:open={proofOpen} overview={ov} title={proofReq.title} description={proofReq.description} confirmLabel={proofReq.label} run={proofReq.run} />
<Dialog open={newCodes !== null} title={t("Your new recovery codes")} onclose={() => (newCodes = null)} testid="new-codes-dialog">
  {#if newCodes}<RecoveryCodes codes={newCodes} onsaved={() => (newCodes = null)} />{/if}
</Dialog>
<style>
  .sec-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr)); gap: 2rem; align-items: start; }
  .sec-group { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2, var(--mute)); }
</style>
