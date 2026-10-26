<script>
  // HOTFIX 11 Oct 2026 — the page a person sees when their workspace requires two-step sign-in and they have not set it up: one Set up button, then the four-stage wizard, then Carry on. Never a redirect.
  // An owner or admin also gets a quiet way to turn the requirement off, so an owner can never be locked out (the server lets an owner reach that one setting while enrolling).
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { twoStepGate } from "$lib/twoStepGate.svelte.js";
  import SetupWizard from "$lib/twostep/SetupWizard.svelte";
  let started = $state(false), msg = $state(null), busy = $state(false), canChange = $state(false), ov = $state(null);
  onMount(async () => { const [p, o] = await Promise.all([api("/api/settings/security"), api("/api/auth/two-step/overview")]); canChange = p.ok && p.json?.canChange === true; ov = o.ok ? o.json : { passkeysAvailable: false, on: false }; });
  function carryOn() { twoStepGate.needed = false; location.reload(); }
  async function turnOffRequirement() { msg = null; busy = true; const r = await api("/api/settings/security", { method: "POST", body: { mode: "off" } }); busy = false; if (!r.ok) { msg = r.error; return; } carryOn(); }
</script>
<section class="" data-testid="two-step-gate">
  <h1 class="text-2xl font-semibold">{t("Set up two-step sign-in")}</h1>
  <p class="mt-2 text-text-2">{t("Your workspace requires two-step sign-in. Set it up to carry on.")}</p>
  {#if msg}<p class="mt-3 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">{msg}</p>{/if}
  {#if started && ov}
    <div class="mt-5 max-w-2xl rounded-xl border border-line p-4 sm:p-6" data-testid="gate-wizard"><SetupWizard overview={ov} first ondone={carryOn} /></div>
  {:else}
    <button class="btn primary mt-4" onclick={() => (started = true)} disabled={!ov} data-testid="gate-set-up">{t("Set up")}</button>
  {/if}
  {#if canChange}<p class="mt-6 text-sm text-mute">{t("You can also stop requiring it for the workspace.")} <button class="underline" onclick={turnOffRequirement} disabled={busy} data-testid="gate-turn-off-requirement">{t("Stop requiring it")}</button></p>{/if}
</section>
