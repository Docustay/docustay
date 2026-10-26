<script>
  // THE PROGRESS OF AN AI JOB: queued, writing, checking, ready. `stage` comes from the job itself (the worker writes it), never guessed here. aria-live so a screen reader hears it move.
  import { t } from "$lib/i18n/index.svelte.js";
  let { stage = "queued", testid = "job-steps" } = $props();
  const STEPS = $derived([["queued", t("Queued")], ["writing", t("Writing")], ["checking", t("Checking")], ["ready", t("Ready")]]);
  const at = $derived(Math.max(0, STEPS.findIndex(([k]) => k === stage)));
</script>
<ol class="flex flex-wrap items-center gap-2 text-sm" aria-live="polite" data-testid={testid} data-stage={stage}>
  {#each STEPS as [k, label], i (k)}
    <li class="rounded-full px-3 py-1 {i === at ? 'bg-ink text-paper font-medium' : i < at ? 'bg-tint' : 'text-mute border border-line'}" aria-current={i === at ? "step" : undefined} data-step={k}>{label}</li>
  {/each}
</ol>
