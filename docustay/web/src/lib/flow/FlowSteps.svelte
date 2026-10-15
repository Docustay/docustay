<script>
  // THE STEP BAR across every document screen, drawn from the flow definition (Start, Write, Who signs, Place fields, Details, Check, Send). `current` is the step id the screen is on;
  // `mode` is document | template | use | form (the steps that do not apply to a mode are not drawn); `onpick(id)` makes a step a button (omit it to show progress only).
  import { STEPS } from "./flowDefinition.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  let { current = "start", mode = "document", onpick = null, reached = null, hide = [], saveLabel = null } = $props();
  const labelOf = (s) => (s.id === "save" && saveLabel ? saveLabel : tl(mode === "form" && s.formLabel ? s.formLabel : s.label));   // Run 7: a form reads "Who fills it", "Check as a visitor", "Publish"
  const steps = $derived(STEPS.filter((s) => s.modes.includes(mode) && !hide.includes(s.id)));
  const at = $derived(steps.findIndex((s) => s.id === current));
  const done = (i) => (reached ? steps[i].id in reached && reached[steps[i].id] : i < at);
</script>
<nav aria-label={t("Steps")} class="flow-steps" data-testid="flow-steps">
  <ol>
    {#each steps as s, i (s.id)}
      <li class:on={i === at} class:done={done(i) && i !== at} aria-current={i === at ? "step" : undefined}>
        {#if onpick}<button type="button" onclick={() => onpick(s.id)} data-testid="flow-step-{s.id}"><span class="n">{i + 1}</span><span class="l">{labelOf(s)}</span></button>
        {:else}<span class="b" data-testid="flow-step-{s.id}"><span class="n">{i + 1}</span><span class="l">{labelOf(s)}</span></span>{/if}
      </li>
    {/each}
  </ol>
</nav>
<style>
  .flow-steps ol { display: flex; gap: 6px; list-style: none; margin: 0 0 14px; padding: 0; overflow-x: auto; }
  li { flex: none; }
  button, .b { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px 0 8px; border-radius: 999px; background: var(--tint, #ece4d3); color: var(--mute, #6b6659); border: 0; font: inherit; font-size: 14px; }
  button { cursor: pointer; }
  .n { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #fff; font-size: 12px; font-weight: 600; }
  li.on button, li.on .b { background: var(--ink, #1c1b19); color: var(--paper, #fff); }
  li.on .n { background: var(--paper, #fff); color: var(--ink, #1c1b19); }
  li.done .n { background: #d9ecd9; }
  @media (max-width: 640px) { .l { display: none; } li.on .l { display: inline; } }
</style>
