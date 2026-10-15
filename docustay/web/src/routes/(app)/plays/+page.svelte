<script>
  // PLAYS — what guides Scribe (Launch step 7): Skills (add-ons, house styles, your own) and Packs (a bundle of skills and templates for one job). One row in the sidebar, two sections of one screen. ?tab=packs opens Packs.
  import { t } from "$lib/i18n/index.svelte.js";
  import Skills from "$lib/screens/Skills.svelte";
  import Packs from "$lib/screens/Packs.svelte";
  let tab = $state(typeof location !== "undefined" && new URLSearchParams(location.search).get("tab") === "packs" ? "packs" : "skills");
  const pick = (k) => { tab = k; history.replaceState(null, "", k === "packs" ? "?tab=packs" : location.pathname); };
</script>
<svelte:head><title>{tab === "packs" ? `${t("Playbooks")} · ` : ""}{t("Plays")} · Docustay</title></svelte:head>
<h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Plays")}</h1>
<nav class="mb-5 mt-3 flex gap-1 border-b border-line pb-2" role="tablist" aria-label={t("Plays sections")} data-testid="plays-tabs">{#each [["skills", t("Plays")], ["packs", t("Playbooks")]] as [k, l]}<button role="tab" aria-selected={tab === k} class="ptab {tab === k ? 'on' : ''}" onclick={() => pick(k)} data-testid="plays-tab-{k}">{l}</button>{/each}</nav>
{#if tab === "packs"}<Packs embedded />{:else}<Skills embedded />{/if}
<style>
  .ptab { padding: 7px 12px; border-radius: 9px; font-size: 13.5px; color: var(--mute); } .ptab:hover { color: var(--ink); background: var(--tint); } .ptab.on { background: var(--tint); color: var(--ink); font-weight: 500; }
</style>
