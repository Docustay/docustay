<script>
  // AUTOMATIONS (Run 9 Part 3.6; R9-a). The automations: when a document from a chosen template or form is signed, send the next one, wait, remind, tell you. Each row says whether it is
  // on and how many times it has run. Free sees the list and can build and test one; turning one on is Pro. (Scribe's bundles of plays stay on Plays → Automations.)
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import ProLock from "$lib/pro/ProLock.svelte";
  const un = (r) => r.json?.data ?? r.json;
  let rows = $state([]), pro = $state(true), loaded = $state(false), problem = $state(null);
  async function load() { const r = await api("/api/documents/automations"); loaded = true; if (r.ok) { const d = un(r); rows = d.automations ?? []; pro = d.pro !== false; problem = null; } else problem = r.error ?? t("The automations could not be loaded."); }
  onMount(() => { load(); return live(["plays", "documents"], load); });
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric" }) : "");
  const steps = (f) => (f?.steps ?? []).length;
</script>
<svelte:head><title>{t("Automations")} · Docustay</title></svelte:head>
<div class="flex flex-wrap items-start gap-3">
  <div class="min-w-0"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Automations")}</h1>
    <p class="mt-1 text-mute">{t("When a document is signed, send the next one, wait, remind and tell you, on its own.")}</p></div>
  <a class="btn primary ml-auto" href="/automations/new" data-testid="automations-new">{t("New automation")}</a>
</div>
{#if problem}<p class="notice warn mt-3" role="alert">{problem}</p>{/if}
<div class="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
  <table class="w-full min-w-[640px] text-left text-[14px]" data-testid="automations-table">
    <thead class="font-mono text-[.7rem] uppercase tracking-wider text-faint"><tr><th class="h-9 px-4">{t("Automation")}</th><th class="px-4">{t("Status")}</th><th class="px-4">{t("Steps")}</th><th class="px-4">{t("Last ran")}</th></tr></thead>
    <tbody>
      {#if !loaded}<tr><td colspan="4" class="p-4"><PageSkel kind="list" testid="automations-skel" /></td></tr>
      {:else}
        {#each rows as b (b.id)}
          <tr class="h-10 border-t border-line" data-testid="automation-row" data-id={b.id}>
            <td class="px-4 py-2"><a class="font-medium text-ink no-underline hover:underline" href={`/automations/${b.id}`}>{b.title}</a></td>
            <td class="px-4 py-2" data-testid="automation-row-status">{b.enabled ? t("{n, plural, one {On · ran # time} other {On · ran # times}}", { n: b.runCount ?? 0 }) : t("Off")}</td>
            <td class="px-4 py-2 tabular-nums">{steps(b.flow)}</td>
            <td class="px-4 py-2 text-mute">{b.lastRunAt ? when(b.lastRunAt) : t("Never")}</td>
          </tr>
        {:else}
          <tr><td colspan="4" class="px-4 py-8 text-center" data-testid="automations-empty">{t("No automations yet. Make one to send the next document when one is signed.")}</td></tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>
<p class="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute" data-testid="automations-note">{t("Each document an automation sends counts toward your monthly documents.")}
  {#if !pro}<ProLock item="playbooks" badgeOnly tip={t("An automation is part of Pro. You can still build one and test it.")} />{/if}</p>
