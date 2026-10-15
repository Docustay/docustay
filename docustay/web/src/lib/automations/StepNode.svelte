<script>
  // One card on the automation canvas (board "Automation"): the step's kind in small capitals, what it does in words, and the server's problem with it in red. The card being edited is
  // outlined and breathes; each card rises into place in turn. Reduced motion: still cards. Wires join top to bottom (the handles are there for the wires, not for dragging).
  import { Handle, Position } from "@xyflow/svelte";
  let { data } = $props();
</script>
<div class="card-step" class:sel={data.selected} class:empty={data.empty} class:bad={data.problem} style={`--i:${data.index}`} data-testid="automation-step" data-kind={data.kind} data-selected={data.selected ? "true" : "false"}>
  {#if data.kind !== "when"}<Handle type="target" position={Position.Top} isConnectable={false} class="hd" />{/if}
  <div class="k">{data.label}</div>
  <div class="ti" data-testid="automation-step-title">{data.title}</div>
  {#if data.sub}<div class="sub">{data.sub}</div>{/if}
  {#if data.problem}<div class="pr" role="alert" data-testid="automation-step-problem">{data.problem}</div>{/if}
  <Handle type="source" position={Position.Bottom} isConnectable={false} class="hd" />
</div>
<style>
  .card-step { width: 340px; padding: 16px 18px; background: var(--card); color: var(--ink); border-radius: 14px; border: 1.5px solid transparent; box-shadow: 0 10px 30px rgba(40, 25, 100, .1); cursor: pointer; text-align: left;
    animation: lift .5s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(var(--i) * .08s); }
  .card-step.sel { border-color: #8585fd; animation: lift .5s cubic-bezier(.2, .8, .2, 1) both, pulse 1.8s ease-in-out .6s infinite; }
  .card-step.empty .ti { color: var(--mute); font-weight: 500; }
  .card-step.bad { border-color: var(--bad-line); }
  .k { font-family: var(--font-mono); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--brand); }
  .ti { font-weight: 600; margin-top: 4px; line-height: 1.35; }
  .sub { font-size: 12px; color: var(--mute); margin-top: 4px; }
  .pr { font-size: 12px; color: var(--bad); margin-top: 6px; }
  .card-step :global(.hd) { opacity: 0; width: 6px; height: 6px; min-width: 0; min-height: 0; border: 0; pointer-events: none; }
  @keyframes lift { from { opacity: 0; transform: perspective(700px) translateZ(-40px) rotateX(12deg); } to { opacity: 1; transform: none; } }
  @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(133, 133, 253, 0); } 50% { box-shadow: 0 0 0 6px rgba(133, 133, 253, .22); } }
  @media (prefers-reduced-motion: reduce) { .card-step, .card-step.sel { animation: none; } }
</style>
