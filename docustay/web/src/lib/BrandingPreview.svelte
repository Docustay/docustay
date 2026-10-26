<script>
  // Settings → Branding: what a signer sees, drawn from the saved settings (accent colour, logo on or off, the note under the title, the footer line). It reads the same settings route the form
  // above saves to and redraws when they change; nothing here is its own copy of a setting.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let org = $state(""), v = $state({}), logo = $state(null);
  const val = (k, d) => (v[k] === undefined || v[k] === null ? d : v[k]);
  const accent = $derived(/^#[0-9a-f]{6}$/i.test(String(val("brand.accent", ""))) ? String(val("brand.accent", "")) : "");
  async function load() {
    const r = await api("/api/documents/settings"); if (!r.ok) return;
    org = r.json?.organisation ?? "";
    const flat = {}; for (const g of r.json?.groups ?? []) for (const f of g.fields) flat[f.key] = f.value; v = flat;
    const p = await api("/api/settings/branding/logo/login?probe=1"); logo = p.status === 200 ? "/api/settings/branding/logo/login?v=" + Date.now() : null;
  }
  onMount(() => { load(); const off = live(["settings", "branding"], load); const on = () => load(); window.addEventListener("docustay:workspace-renamed", on); window.addEventListener("docustay:settings-saved", on); return () => { off?.(); window.removeEventListener("docustay:workspace-renamed", on); window.removeEventListener("docustay:settings-saved", on); }; });
</script>
<aside class="min-w-0" aria-label={t("What a signer sees")} data-testid="branding-preview">
  <p class="mb-2 text-[12px] text-mute">{t("What a signer sees")}</p>
  <div class="paper-ground rounded-md p-4">
    <div class="rounded-[3px] border bg-white p-4 text-[#15171c]" style="border-color: var(--paper-sheet-line); {accent ? `border-top: 3px solid ${accent}` : ''}">
      {#if logo && val("brand.show_logo", true) !== false}<img src={logo} alt="" class="mb-1.5 h-7 w-auto" data-testid="branding-preview-logo" />{/if}
      <p class="text-[11px] text-[#5a5f6a]">{org}</p>
      <p class="paper-serif text-[18px] font-medium leading-tight">{t("Services agreement")}</p>
      {#if val("brand.welcome_note", "")}<p class="mt-1 text-[11.5px] text-[#5a5f6a]" data-testid="branding-preview-note">{val("brand.welcome_note", "")}</p>{/if}
      <div class="mt-3 space-y-1.5" aria-hidden="true"><i class="block h-1 rounded bg-[#e6e2da]"></i><i class="block h-1 w-5/6 rounded bg-[#e6e2da]"></i><i class="block h-1 w-2/3 rounded bg-[#e6e2da]"></i></div>
      <div class="mt-4 flex justify-end"><span class="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style="background: {accent || 'var(--brand)'}">{t("Finish and sign")}</span></div>
    </div>
    {#if val("brand.hide_footer", false) !== true}<p class="mt-2 text-center text-[10.5px] text-mute">{t("Sent with Docustay")}</p>{/if}
  </div>
</aside>
