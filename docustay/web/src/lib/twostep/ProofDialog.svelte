<script>
  // "Confirm it's you": the person's CURRENT second step, asked before anything that changes their two-step (add or remove a method, new recovery codes, turn it off).
  // `run(proof)` does the change and answers null on success or a sentence on failure; the dialog stays open on failure with the wrong-code state, and closes on success.
  import Dialog from "$lib/ui/Dialog.svelte";
  import CodeBoxes from "$lib/entry/CodeBoxes.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { passkeysSupported, proveWithPasskey } from "$lib/passkeys.js";
  let { open = $bindable(false), title = "", description = "", overview = null, run = async () => null, confirmLabel = "" } = $props();
  let code = $state(""), recovery = $state(""), useRecovery = $state(false), problem = $state(null), busy = $state(false), bad = $state(false), boxes = $state(null);
  const hasApp = $derived(overview?.authenticatorApp?.on === true);
  const hasKey = $derived((overview?.passkeys?.length ?? 0) > 0 && passkeysSupported());
  const hasRecovery = $derived((overview?.recoveryLeft ?? 0) > 0);
  $effect(() => { if (open) { code = ""; recovery = ""; useRecovery = false; problem = null; bad = false; queueMicrotask(() => boxes?.focus()); } });
  async function go(proof) {
    busy = true; problem = null; bad = false;
    const err = await run(proof);
    busy = false;
    if (err) { problem = err; bad = true; code = ""; recovery = ""; queueMicrotask(() => boxes?.focus()); return; }
    open = false;
  }
  const withCode = (v) => go({ code: v });
  async function withKey() { try { busy = true; problem = null; const proof = await proveWithPasskey(); busy = false; await go(proof); } catch (e) { busy = false; problem = e.message; } }
</script>
<Dialog bind:open {title} description={description || t("Enter a code from your authenticator app, or use another way, to confirm it's you.")} testid="proof-dialog">
  <div class="space-y-4">
    {#if hasKey}
      <button type="button" class="btn primary w-full" onclick={withKey} disabled={busy} data-testid="proof-passkey"><Icon name="fingerprint" size={18} />{t("Use my passkey or security key")}</button>
    {/if}
    {#if hasApp && !useRecovery}
      <div>
        <label class="label" for="proof-code">{t("Code from your authenticator app")}</label>
        <CodeBoxes bind:this={boxes} bind:value={code} id="proof-code" invalid={bad} {busy} oncomplete={withCode} label={t("Six-digit code")} />
      </div>
    {/if}
    {#if useRecovery || (!hasApp && hasRecovery && !hasKey)}
      <form class="space-y-2" onsubmit={(e) => { e.preventDefault(); go({ code: recovery.trim() }); }}>
        <label class="label" for="proof-recovery">{t("Recovery code")}</label>
        <input id="proof-recovery" class="field font-mono" bind:value={recovery} autocomplete="off" autocapitalize="characters" spellcheck="false" data-testid="proof-recovery" />
        <button class="btn primary" disabled={busy || !recovery.trim()}>{confirmLabel || t("Confirm")}</button>
      </form>
    {/if}
    {#if problem}<p class="notice bad" role="alert" data-testid="proof-problem">{problem}</p>{/if}
    {#if hasApp && hasRecovery}
      <button type="button" class="text-sm underline" onclick={() => { useRecovery = !useRecovery; problem = null; }} data-testid="proof-toggle">{useRecovery ? t("Use my authenticator app instead") : t("Use a recovery code instead")}</button>
    {/if}
  </div>
</Dialog>
