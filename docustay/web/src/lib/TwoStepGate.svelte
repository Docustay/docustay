<script>
  // HOTFIX 11 Oct 2026 — the page a person sees when their workspace requires two-step sign-in and they have not set it up: one Set up button, the steps, then Carry on. Never a redirect.
  // An owner or admin also gets a quiet way to turn the requirement off, so an owner can never be locked out (the server lets an owner reach that one setting while enrolling).
  import { onMount } from "svelte";
  import PinCode from "$lib/ui/PinCode.svelte";
  import Rich from "$lib/i18n/Rich.svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { twoStepGate } from "$lib/twoStepGate.svelte.js";
  let enrol = $state(null), qr = $state(null), code = $state(""), backup = $state(null), msg = $state(null), busy = $state(false), canChange = $state(false);
  onMount(async () => { const p = await api("/api/settings/security"); canChange = p.ok && p.json?.canChange === true; });
  async function start() { msg = null; busy = true; const r = await api("/api/auth/two-step/start", { method: "POST", body: {} }); busy = false; if (!r.ok) { msg = r.error; return; } enrol = r.json; qr = await (await import("qrcode")).default.toDataURL(r.json.otpauthUrl, { margin: 1, width: 192 }); }
  async function confirm(e) { e.preventDefault(); busy = true; msg = null; const r = await api("/api/auth/two-step/confirm", { method: "POST", body: { code: code.trim() } }); busy = false; if (!r.ok) { msg = r.error ?? t("That code was not accepted."); return; } backup = r.json.backupCodes; enrol = null; qr = null; code = ""; }
  function carryOn() { twoStepGate.needed = false; location.reload(); }
  async function turnOffRequirement() { msg = null; busy = true; const r = await api("/api/settings/security", { method: "POST", body: { requireTwoStep: false } }); busy = false; if (!r.ok) { msg = r.error; return; } carryOn(); }
</script>
<section class="max-w-xl" data-testid="two-step-gate">
  <h1 class="text-2xl font-semibold">{t("Set up two-step sign-in")}</h1>
  <p class="mt-2 text-text-2">{t("Your workspace requires two-step sign-in. Set it up to carry on.")}</p>
  {#if msg}<p class="mt-3 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{msg}</p>{/if}
  {#if backup}
    <div class="mt-4 rounded-xl border border-line p-4" data-testid="gate-backup-codes"><p class="text-sm font-medium">{t("Two-step is on. Save these backup codes now — each works once, and they are not shown again.")}</p>
      <pre class="mt-2 grid grid-cols-2 gap-1 text-sm">{backup.join("\n")}</pre><button class="btn primary mt-3" onclick={carryOn} data-testid="gate-carry-on">{t("Carry on")}</button></div>
  {:else if enrol}
    <div class="mt-4 flex flex-wrap gap-5 rounded-xl border border-line p-4" data-testid="gate-enrol">
      {#if qr}<img src={qr} alt={t("QR code to scan with your authenticator app")} class="h-48 w-48" />{/if}
      <form class="space-y-2" onsubmit={confirm}><p class="text-sm"><Rich text={t("Scan this with an authenticator app, or enter the key <key>{secret}</key>. Then type the code it shows.", { secret: enrol.secret })} parts={{ key: { code: true } }} /></p>
        <PinCode bind:value={code} label={t("Code from your app")} testid="gate-pin" /><div><button class="btn primary" disabled={busy || !code.trim()}>{t("Turn on")}</button></div></form></div>
  {:else}
    <button class="btn primary mt-4" onclick={start} disabled={busy} data-testid="gate-set-up">{t("Set up")}</button>
  {/if}
  {#if canChange && !backup}<p class="mt-6 text-sm text-mute">{t("You can also stop requiring it for the workspace.")} <button class="underline" onclick={turnOffRequirement} disabled={busy} data-testid="gate-turn-off-requirement">{t("Stop requiring it")}</button></p>{/if}
</section>
