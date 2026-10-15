<script>
  // Round 3: a person who signed (or was asked to sign) a document can ask the organisation that sent it to show or remove what it holds about them. This is where an owner or admin answers that: look the address up, then remove the details.
  import { t } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  let email = $state(""), busy = $state(false), problem = $state(null), report = $state(null), result = $state(null), confirm = $state(false);
  async function look() {
    busy = true; problem = null; result = null; confirm = false;
    const r = await api("/api/documents/pdf/data-report", { method: "POST", body: { email } });
    busy = false;
    if (!r.ok) { problem = r.error ?? t("That could not be looked up."); report = null; return; }
    report = r.json;
  }
  async function remove() {
    busy = true; problem = null;
    const r = await api("/api/documents/pdf/data-erase", { method: "POST", body: { email } });
    busy = false; confirm = false;
    if (!r.ok) { problem = r.error ?? t("That could not be done."); return; }
    result = r.json; report = null;
  }
  const docState = (d) => (d.signed ? t("Signed") : d.state);
</script>
<div class="mt-10 max-w-2xl space-y-3" data-testid="privacy-requests">
  <h2 class="text-lg font-semibold">{t("Privacy requests")}</h2>
  <p class="text-sm text-mute">{t("When someone asks what this workspace holds about them, or asks to be removed, look up their email address here. Removing them clears their name, address, phone, answers and uploads from every document that is not signed yet, and cancels any document still waiting on them. A document they already signed is kept as the signed record.")}</p>
  <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); look(); }}>
    <label class="sr-only" for="priv-email">{t("Email address")}</label>
    <input id="priv-email" class="field flex-1" type="email" bind:value={email} placeholder={t("Email address")} autocomplete="off" data-testid="privacy-email" />
    <button class="btn" disabled={busy || !email.trim()} data-testid="privacy-look">{t("Look up")}</button>
  </form>
  {#if problem}<p class="text-sm text-bad" role="alert" data-testid="privacy-problem">{problem}</p>{/if}
  {#if report}
    {#if report.documents.length === 0}<p class="notice" data-testid="privacy-none">{t("This workspace holds nothing about that address.")}</p>
    {:else}
      <ul class="divide-y divide-line rounded-lg border border-line" data-testid="privacy-report">{#each report.documents as d}<li class="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span class="min-w-0 truncate">{d.title}</span><span class="shrink-0 text-mute">{docState(d)}</span></li>{/each}</ul>
      {#if !confirm}<button class="btn" onclick={() => (confirm = true)} data-testid="privacy-remove-open">{t("Remove their details…")}</button>
      {:else}<div class="flex items-center gap-2"><button class="btn primary" disabled={busy} onclick={remove} data-testid="privacy-remove-go">{busy ? t("Working…") : t("Remove their details")}</button><button class="btn" onclick={() => (confirm = false)}>{t("Cancel")}</button></div>{/if}
    {/if}
  {/if}
  {#if result}
    <div class="notice ok space-y-1" role="status" data-testid="privacy-result">
      <p>{t("{n, plural, one {# document cleaned} other {# documents cleaned}}", { n: result.removed.length })}{#if result.voided.length} · {t("{n, plural, one {# waiting document cancelled} other {# waiting documents cancelled}}", { n: result.voided.length })}{/if}</p>
      {#if result.kept.length}<p>{t("{n, plural, one {# signed document kept as the signed record} other {# signed documents kept as the signed record}}", { n: result.kept.length })}</p>{/if}
    </div>
  {/if}
</div>
