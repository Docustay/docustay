<script>
  // Settings → Branding: the workspace's own name (R13-D003, 16 Oct 2026). Until this card a hosted workspace kept the name made from the owner's email at sign-up
  // ("Name's workspace"), with no control to change it, and that name is what the sidebar shows and what signing emails and pages call the sender. It is the host
  // setting practice.name (the brand port reads it first, then the tenant's name), written through the same settings route the rest of the host settings use.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  let saved = $state(null), name = $state(""), busy = $state(false), problem = $state(null), failed = $state(null);
  async function load() { const r = await api("/api/documents/settings"); failed = r.ok ? null : (r.error ?? t("The organisation name could not be loaded.")); if (r.ok) { saved = r.json?.organisation ?? ""; name = saved; } }   // R13-D448: a failed read is not "no card"
  onMount(load);
  async function save() {
    busy = true; problem = null;
    const r = await api("/api/settings", { method: "POST", body: { key: "practice.name", value: name.trim() } });
    busy = false;
    if (r.ok) { saved = name.trim(); toast(t("Saved."), "ok"); try { window.dispatchEvent(new CustomEvent("docustay:workspace-renamed", { detail: saved })); } catch { /* none */ } } else problem = r.error ?? t("That could not be saved. Try again.");
  }
</script>
{#if saved !== null}
<section class="mb-6 border-b border-line pb-4" data-testid="workspace-name-card">
  <form class="flex flex-wrap items-end gap-3" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <label class="grid gap-1 text-sm"><span class="font-medium">{t("Organisation name")}</span><input class="field w-full max-w-80" bind:value={name} maxlength="120" autocomplete="organization" data-testid="workspace-name" /></label>
    <button class="btn primary" type="submit" disabled={busy || !name.trim() || name.trim() === saved} data-testid="workspace-name-save">{t("Save")}</button>
  </form>
  {#if problem}<p class="mt-2 text-sm text-bad" role="alert">{problem}</p>{/if}
</section>
{:else if failed}
<section class="mb-6 border-b border-line pb-4" data-testid="workspace-name-failed"><p class="text-sm" role="alert">{failed} <button class="btn quiet" onclick={load}>{t("Try again")}</button></p></section>
{/if}
