<script>
  // Settings → Account: the person's own name (and the email they sign in with, read only). The name is what a teammate, a signer's notice and the audit trail call them.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  let me = $state(null), name = $state(""), busy = $state(false), problem = $state(null);
  onMount(async () => { const r = await api("/api/account/profile"); if (r.ok) { me = r.json; name = me.displayName ?? ""; } });
  async function save() {
    busy = true; problem = null;
    const r = await api("/api/account/profile", { method: "PUT", body: { displayName: name } });
    busy = false;
    if (r.ok) { me = r.json; name = me.displayName; toast(t("Saved."), "ok"); } else problem = r.error ?? t("That could not be saved. Try again.");
  }
</script>
{#if me}
<section class="rounded-xl border border-line p-4" data-testid="profile-card">
  <h2 class="text-lg font-semibold">{t("Your name")}</h2>
  <p class="mt-1 text-sm text-mute">{t("This is how your teammates, the people you send to and the activity log refer to you.")}</p>
  <form class="mt-3 flex flex-wrap items-end gap-3" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <label class="grid min-w-0 flex-1 gap-1 text-sm"><span class="font-medium">{t("Name")}</span><input class="field w-full" bind:value={name} maxlength="80" autocomplete="name" data-testid="profile-name" /></label>
    <button class="btn primary" type="submit" disabled={busy || !name.trim() || name.trim() === (me.displayName ?? "")} data-testid="profile-save">{t("Save")}</button>
  </form>
  <p class="mt-3 text-sm text-mute [overflow-wrap:anywhere]">{t("You sign in with")} <span class="font-mono">{me.email}</span></p>
  {#if problem}<p class="mt-2 text-sm text-bad" role="alert">{problem}</p>{/if}
</section>
{/if}
