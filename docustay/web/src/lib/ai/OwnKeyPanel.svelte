<script>
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  const ENGINE = "/api/documents/engine";
  let status = $state(null), key = $state(""), busy = $state(false), problem = $state(null), test = $state(null);
  const val = (r) => r.json?.data ?? r.json;
  async function load() { const r = await api(`${ENGINE}/ai/status`); if (r.ok) status = val(r); }
  onMount(() => { load(); return live(["settings"], load); });
  async function save() {
    busy = true; problem = null;
    const r = await api(`${ENGINE}/ai/key`, { method: "POST", body: { key } });
    busy = false;
    if (!r.ok) { problem = r.error; return; }
    key = ""; toast(t("Key saved."), "ok"); load();
  }
  async function runTest() {
    busy = true; test = { state: "testing" };
    const r = await api(`${ENGINE}/ai/test`, { method: "POST", body: {} });
    busy = false;
    const d = r.ok ? val(r) : null;
    test = r.ok && d?.ok ? { state: "ok", model: d.model } : { state: "bad", message: (d && d.message) || r.error || t("The provider did not answer.") };
  }
  async function clear() {
    busy = true; problem = null;
    const r = await api(`${ENGINE}/ai/key/clear`, { method: "POST", body: {} });
    busy = false;
    if (!r.ok) { problem = r.error; return; }
    toast(t("Key removed."), "ok"); load();
  }
</script>

<section class="mt-8 rounded-xl border border-line p-4" data-testid="ai-own-key">
  <h2 class="font-semibold">{t("Your own AI key")}</h2>
  <p class="mt-1 text-sm text-mute">{t("Use your own account with the provider instead of ours. The key is stored sealed and is never shown again.")}</p>
  {#if status}<p class="mt-2 text-sm" data-testid="ai-key-state">{status.ownKey ? t("A key of your own is saved.") : status.serviceKey ? t("Drafts use this service's key.") : t("No key is set yet.")}</p>{/if}
  <div class="mt-3 flex flex-wrap items-center gap-2">
    <input class="field min-h-[40px] min-w-0 flex-1" type="password" autocomplete="off" bind:value={key} placeholder={t("Paste the key")} data-testid="ai-key-input" />
    <button class="btn primary min-h-[40px]" disabled={busy || !key.trim()} onclick={save} data-testid="ai-key-save">{t("Save key")}</button>
    {#if status?.ownKey}<button class="btn min-h-[40px]" disabled={busy} onclick={runTest} data-testid="ai-key-test">{t("Test connection")}</button><button class="btn quiet min-h-[40px]" disabled={busy} onclick={clear} data-testid="ai-key-clear">{t("Remove key")}</button>{/if}
  </div>
  {#if problem}<p class="mt-2 text-sm text-bad">{problem}</p>{/if}
  {#if test?.state === "testing"}<p class="mt-2 text-sm text-mute" role="status">{t("Testing…")}</p>{:else if test?.state === "ok"}<p class="mt-2 text-sm text-ok" role="status" data-testid="ai-key-test-ok">{t("Connected: {model}", { model: test.model })}</p>{:else if test?.state === "bad"}<p class="mt-2 text-sm text-bad" role="alert" data-testid="ai-key-test-bad">{test.message}</p>{/if}
</section>
