<script>
  // PLAYS — what guides Scribe (Launch step 7): Skills (add-ons, house styles, your own) and Packs (a bundle of skills and templates for one job). One row in the sidebar, two sections of one screen. ?tab=packs opens Packs.
  import { t } from "$lib/i18n/index.svelte.js";
  import PageHeader from "$lib/ui/PageHeader.svelte"; import Tabs from "$lib/ui/Tabs.svelte";
  import Skills from "$lib/screens/Skills.svelte";
  import Packs from "$lib/screens/Packs.svelte";
  let tab = $state(typeof location !== "undefined" && new URLSearchParams(location.search).get("tab") === "packs" ? "packs" : "skills");
  const pick = (k) => { tab = k; history.replaceState(null, "", k === "packs" ? "?tab=packs" : location.pathname); };
</script>
<svelte:head><title>{tab === "packs" ? `${t("Playbooks")} · ` : ""}{t("Plays")} · Docustay</title></svelte:head>
<PageHeader title={t("Plays")} />
<Tabs class="mb-3" label={t("Plays sections")} testid="plays-tabs" idPrefix="plays-tab" value={tab} onchange={pick} items={[{ value: "skills", label: t("Skills") }, { value: "packs", label: t("Playbooks") }]} />
{#if tab === "packs"}<Packs embedded />{:else}<Skills embedded />{/if}
