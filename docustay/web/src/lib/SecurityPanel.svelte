<script>
  import PinCode from "$lib/ui/PinCode.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { deviceText } from "$lib/i18n/deviceText.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { passkeysSupported, registerPasskey } from "$lib/passkeys.js";
  // Settings → Security: your own two-step sign-in, the workspace rule that makes it compulsory, and where you are signed in.
  let status = $state(null), policy = $state(null), sessions = $state([]), current = $state(null);
  let enrol = $state(null), qr = $state(null), code = $state(""), backup = $state(null), msg = $state(null), busy = $state(false), offCode = $state("");
  const when = (x) => whenText(x);
  async function load() {
    const [s, p, l] = await Promise.all([api("/api/auth/two-step/status"), api("/api/settings/security"), api("/api/auth/sessions")]);
    status = s.ok ? s.json : null; policy = p.ok ? p.json : null; sessions = l.ok ? l.json.sessions ?? [] : []; current = l.ok ? l.json.current : null;
  }
  let pk = $state({ enabled: false, passkeys: [] }), pkName = $state("");
  async function loadPasskeys() { const r = await api("/api/auth/passkeys"); pk = r.ok ? { enabled: r.json?.enabled === true, passkeys: r.json?.passkeys ?? [] } : { enabled: false, passkeys: [] }; }
  async function addPasskey() { msg = null; busy = true; try { await registerPasskey(pkName.trim() || t("My passkey")); pkName = ""; await loadPasskeys(); } catch (e) { msg = e.message; } finally { busy = false; } }
  async function removeKey(id) { const r = await api("/api/auth/passkeys/remove", { method: "POST", body: { id } }); if (!r.ok) msg = r.error; await loadPasskeys(); }
  onMount(() => { load(); loadPasskeys(); return live(["team"], () => { load(); loadPasskeys(); }); });
  async function start() { msg = null; const r = await api("/api/auth/two-step/start", { method: "POST", body: {} }); if (!r.ok) { msg = r.error; return; } enrol = r.json; qr = await (await import("qrcode")).default.toDataURL(r.json.otpauthUrl, { margin: 1, width: 192 }); }
  async function confirm(e) { e.preventDefault(); busy = true; msg = null; const r = await api("/api/auth/two-step/confirm", { method: "POST", body: { code: code.trim() } }); busy = false; if (!r.ok) { msg = r.error ?? t("That code was not accepted."); return; } backup = r.json.backupCodes; enrol = null; qr = null; code = ""; await load(); }
  async function turnOff(e) { e.preventDefault(); busy = true; msg = null; const r = await api("/api/auth/two-step/disable", { method: "POST", body: { code: offCode.trim() } }); busy = false; if (!r.ok) { msg = r.error ?? t("That code was not accepted."); return; } offCode = ""; await load(); }
  let access = $state(null);   // Run 7: the access log (always on), shown to owners and admins
  async function loadAccess() { const r = await api("/api/documents/access-log"); access = r.ok ? (r.json?.data ?? r.json) : null; }
  $effect(() => { if (policy?.canChange) loadAccess(); });
  async function idle(m) { msg = null; const r = await api("/api/settings/security", { method: "POST", body: { idleMinutes: m } }); if (!r.ok) msg = r.error; await load(); }
  async function force(on) { msg = null; const r = await api("/api/settings/security", { method: "POST", body: { requireTwoStep: on } }); if (!r.ok) msg = r.error; await load(); }
  async function revoke(id) { await api("/api/auth/sessions/revoke", { method: "POST", body: { tokenId: id } }); await load(); }
  async function revokeOthers() { await api("/api/auth/sessions/revoke", { method: "POST", body: { all: true } }); await load(); }
  const on = $derived(status?.enabled === true || status?.confirmed === true || status?.on === true);
</script>
<div class="max-w-2xl space-y-8" data-testid="security-panel">
  {#if msg}<p class="rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{msg}</p>{/if}
  {#if pk.enabled}
    <section data-testid="passkeys"><h2 class="text-lg font-semibold">{t("Passkeys")}</h2>
      <p class="mt-1 text-sm text-mute">{t("Sign in with your fingerprint, face or device lock instead of a password. A passkey stays on your device; Docustay keeps only its public half.")}</p>
      {#if pk.passkeys.length}<ul class="mt-3 divide-y divide-line rounded-xl border border-line" data-testid="passkey-list">{#each pk.passkeys as k (k.id)}<li class="flex items-center gap-3 px-3 py-2 text-sm"><span class="font-medium">{k.name === "My passkey" ? t("My passkey") : k.name}</span><span class="text-xs text-mute">{k.lastUsedAt ? t("used {date}", { date: when(k.lastUsedAt) }) : t("never used")}</span><button class="btn quiet ml-auto !min-h-9" onclick={() => removeKey(k.id)} data-testid="passkey-remove">{t("Remove")}</button></li>{/each}</ul>{/if}
      {#if passkeysSupported()}<form class="mt-3 flex flex-wrap gap-2" onsubmit={(e) => { e.preventDefault(); addPasskey(); }}><input class="field w-56" placeholder={t("Name, such as Work laptop")} aria-label={t("Passkey name")} bind:value={pkName} data-testid="passkey-name" /><button class="btn" disabled={busy} data-testid="passkey-add">{t("Add a passkey")}</button></form>
      {:else}<p class="mt-2 text-sm text-mute">{t("This browser cannot make passkeys.")}</p>{/if}
    </section>
  {/if}
  <section><h2 class="text-lg font-semibold">{t("Two-step sign-in")}</h2>
    <p class="mt-1 text-sm text-mute">{t("After your password or email code, you also enter a six-digit code from an authenticator app on your phone.")}</p>
    {#if backup}
      <div class="mt-3 rounded-xl border border-line p-4" data-testid="backup-codes"><p class="text-sm font-medium">{t("Two-step is on. Save these backup codes now — each works once, and they are not shown again.")}</p>
        <pre class="mt-2 grid grid-cols-2 gap-1 text-sm">{backup.join("\n")}</pre><button class="btn mt-2" onclick={() => (backup = null)}>{t("I have saved them")}</button></div>
    {:else if on}
      <p class="mt-3 text-sm" data-testid="two-step-on">{status?.since ? t("On since {date}.", { date: when(status.since) }) : t("On.")}</p>
      <form class="mt-3 flex flex-wrap items-center gap-2" onsubmit={turnOff}><PinCode bind:value={offCode} label={t("Current code")} testid="pin-off" /><button class="btn" disabled={busy || !offCode.trim()}>{t("Turn off")}</button></form>
    {:else if enrol}
      <div class="mt-3 flex flex-wrap gap-5 rounded-xl border border-line p-4" data-testid="enrol">
        {#if qr}<img src={qr} alt={t("QR code to scan with your authenticator app")} class="h-48 w-48" />{/if}
        <form class="space-y-2" onsubmit={confirm}><p class="text-sm"><Rich text={t("Scan this with an authenticator app, or enter the key <key>{secret}</key>. Then type the code it shows.", { secret: enrol.secret })} parts={{ key: { code: true } }} /></p>
          <PinCode bind:value={code} label={t("Code from your app")} testid="pin-enrol" /><div><button class="btn primary" disabled={busy || !code.trim()}>{t("Turn on")}</button></div></form></div>
    {:else}{#if policy?.youMustUseTwoStep}<p class="notice warn mt-3" role="alert" data-testid="two-step-required">{t("Your workspace requires two-step sign-in. Set it up to carry on.")}</p>{/if}<button class="btn primary mt-3" onclick={start} data-testid="two-step-start">{t("Set up two-step")}</button>{/if}
  </section>
  {#if policy?.canChange}
    <section><h2 class="text-lg font-semibold">{t("Require it for everyone")}</h2>
      <p class="mt-1 text-sm text-mute">{t("When this is on, nobody on your team can use the workspace until they have set up two-step sign-in.")}</p>
      <label class="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.requireTwoStep} disabled={!policy.youHaveTwoStep && !policy.requireTwoStep} onchange={(e) => force(e.currentTarget.checked)} data-testid="require-two-step" />{t("Require two-step sign-in for every team member")}</label>
      {#if !policy.youHaveTwoStep && !policy.requireTwoStep}<p class="mt-1 text-xs text-mute">{t("Set it up for yourself first.")}</p>{/if}
    </section>
    <section><h2 class="text-lg font-semibold">{t("Sign out when idle")}</h2>
      <p class="mt-1 text-sm text-mute">{t("Sign people out after a period without activity. They sign in again to carry on; nothing they saved is lost.")}</p>
      <label class="mt-3 flex flex-wrap items-center gap-2 text-sm">{t("Sign out after")}
        <select class="field w-auto" value={String(policy.idleMinutes)} onchange={(e) => idle(Number(e.currentTarget.value))} data-testid="idle-minutes">
          {#each [0, 15, 30, 60, 240, 480] as m (m)}<option value={String(m)}>{m === 0 ? t("Never") : m < 60 ? t("{n} minutes", { n: m }) : t("{n} hours", { n: m / 60 })}</option>{/each}
        </select></label>
      </section>
    {#if access}
      <section data-testid="access-log"><div class="flex flex-wrap items-center gap-2"><h2 class="text-lg font-semibold">{t("Access log")}</h2><a class="btn ml-auto" href="/api/documents/access-log.csv" data-testid="access-log-csv">{t("Download CSV")}</a></div>
        <p class="mt-1 text-sm text-mute">{t("Every time someone on your team opens, downloads or exports a document. Kept for as long as the workspace exists.")}</p>
        <ul class="mt-3 grid gap-1 text-sm">{#each access.events ?? [] as e (e.id)}<li class="flex min-w-0 flex-wrap gap-x-3 border-b border-line py-1.5"><span class="font-medium">{e.user_name ?? e.user_email ?? t("Someone")}</span><span>{e.action === "view" ? t("opened") : e.action === "download" ? t("downloaded") : t("exported")}</span><span class="max-w-full truncate">{e.title ?? e.what ?? ""}{e.title && e.what ? ` · ${e.what}` : ""}</span><span class="ml-auto text-mute">{when(e.at)}</span></li>{:else}<li class="text-mute" data-testid="access-log-empty">{t("Nothing yet. Opening a document adds the first line.")}</li>{/each}</ul>
      </section>
    {/if}
  {/if}
  <section><h2 class="text-lg font-semibold">{t("Where you are signed in")}</h2>
    <ul class="mt-2 divide-y divide-line rounded-xl border border-line" data-testid="sessions">
      {#each sessions as s (s.tokenId)}<li class="flex items-center justify-between gap-3 px-4 py-2 text-sm"><span>{deviceText(s.device, s.userAgentSummary)} · {t("signed in {date}", { date: when(s.createdAt) })}{#if s.tokenId === current} <strong>({t("this device")})</strong>{/if}</span>
        {#if s.tokenId !== current}<button class="btn !py-1" onclick={() => revoke(s.tokenId)}>{t("Sign out")}</button>{/if}</li>{/each}
    </ul>
    {#if sessions.length > 1}<button class="btn mt-2" onclick={revokeOthers} data-testid="sign-out-others">{t("Sign out everywhere else")}</button>{/if}</section>
</div>
