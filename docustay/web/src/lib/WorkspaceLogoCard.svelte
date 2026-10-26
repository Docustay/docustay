<script>
  // Settings → Branding: the workspace's own logo (R13-D057, 16 Oct 2026). "Show my logo on the signing page" and the signed copy's letterhead both read the logo, but nothing in
  // this app could add one. The picture is read in the browser and sent through the host's own logo route (the same one every workspace uses), which stores it and keeps it small.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  let busy = $state(false), problem = $state(null), src = $state(null), shown = $state(false);
  const probe = async () => { const r = await api("/api/settings/branding/logo/login?probe=1"); if (r.status === 200) { src = "/api/settings/branding/logo/login?v=" + Date.now(); } shown = true; };
  onMount(() => { probe(); window.addEventListener("docustay:settings-saved", probe); return () => window.removeEventListener("docustay:settings-saved", probe); });   // R13-D519: read again when the settings come back after an error
  function toBase64(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] ?? ""); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); }); }
  async function pick(e) {
    const file = e.currentTarget.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { problem = t("That picture is {mb} MB. Choose one up to 2 MB.", { mb: (file.size / 1048576).toFixed(1) }); e.currentTarget.value = ""; return; }   // R13-D147: say the limit instead of the raw "request body too large"
    busy = true; problem = null;
    try {
      const dataBase64 = await toBase64(file);
      const r = await api("/api/settings/branding/logo", { method: "POST", body: { kind: "login", dataBase64 } });
      if (r.ok) { src = "/api/settings/branding/logo/login?v=" + Date.now(); toast(t("Saved."), "ok"); } else problem = r.error ?? t("That could not be saved. Try again.");
    } catch { problem = t("That file could not be read."); }
    busy = false; e.currentTarget.value = "";
  }
</script>
{#if shown}
<section class="mb-6 border-b border-line pb-4" data-testid="workspace-logo-card">
  <div class="flex flex-wrap items-center gap-4">
    {#if src}<img src={src} alt={t("Your logo")} class="h-12 w-auto rounded border border-line bg-white p-1" data-testid="workspace-logo-image" />{/if}
    <label class="grid gap-1 text-sm"><span class="font-medium">{t("Organisation logo")}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp" class="field w-full max-w-80" disabled={busy} onchange={pick} data-testid="workspace-logo-file" /></label>
  </div>
  <p class="mt-2 text-sm text-mute">{t("A PNG, JPG or WebP picture, up to 2 MB. It appears on the page a person signs on and at the top of the signed copy.")}</p>
  {#if problem}<p class="mt-2 text-sm text-bad" role="alert">{problem}</p>{/if}
</section>
{/if}
