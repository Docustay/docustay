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
  /* combined style: the steps are a quiet breadcrumb (12px text, the current one in ink, a hairline between), not pills */
  .flow-steps ol { display: flex; align-items: center; gap: 0; list-style: none; margin: 0; padding: 0; overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
  li { flex: none; display: inline-flex; align-items: center; }
  li + li::before { content: ""; width: 14px; height: 1px; margin: 0 6px; background: var(--line-strong); }
  button, .b { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 0 2px; border: 0; background: transparent; color: var(--mute); font: inherit; font-size: 12px; }
  button { cursor: pointer; } button:hover { color: var(--ink); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  .n { font-family: var(--font-mono); font-size: 11px; color: var(--faint); }
  li.on button, li.on .b { color: var(--ink); font-weight: 600; } li.on .n { color: var(--brand); }
  li.done .n { color: var(--ok); }
  @media (max-width: 640px) { .l { display: none; } li.on .l { display: inline; } button, .b { min-height: 44px; min-width: 28px; justify-content: center; } }
</style>
