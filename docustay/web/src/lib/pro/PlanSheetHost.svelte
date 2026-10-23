<script>
  // Mounted once in the signed-in layout: shows the one plan sheet (a limit, or a feature lock) for whatever refused or asked. See PlanPrompt.svelte.
  import PlanPrompt from "./PlanPrompt.svelte";
  import { planSheet, closePlanSheet } from "./planPrompt.svelte.js";
</script>
{#if planSheet.answer}{#key planSheet.answer}<PlanPrompt answer={planSheet.answer} form={planSheet.form} ctx={planSheet.ctx} onclose={closePlanSheet} />{/key}{/if}
