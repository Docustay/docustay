<script>
  // A suggested change to the open document or the template's answers, on hairlines (Run 8: no box). Accepted: a violet sweep passes over the new words (motion board Done 6), with Undo in the panel's toast.
  import { t } from "$lib/i18n/index.svelte.js";
  import { describePatches } from "./diff.js";
  let { proposal, onaccept, onreject } = $props();
  const lines = $derived(proposal.kind === "changes" ? describePatches(proposal.patches, proposal.previousSource) : Object.entries(proposal.values ?? {}).map(([k, v]) => ({ kind: "value", label: proposal.labels?.[k] ?? k, b: String(v) })));
</script>
<div class="dc grid gap-2" class:applied={proposal.state === "accepted"} data-testid="chat-proposal" data-state={proposal.state}>
  <div class="font-semibold">{proposal.summary || (proposal.kind === "values" ? t("Suggested answers") : t("Suggested changes"))}</div>
  <ul class="grid gap-1.5" aria-label={t("What would change")}>
    {#each lines as l}
      <li class="text-sm">
        {#if l.kind === "value"}<span class="text-mute">{l.label}:</span> <ins class="bg-brand-soft no-underline px-0.5">{l.b}</ins>
        {:else if l.kind === "add"}<span class="text-mute">{t("Add after block {n}:", { n: l.n })}</span> <ins class="bg-brand-soft no-underline px-0.5">{l.b}</ins>
        {:else if l.kind === "remove"}<span class="text-mute">{t("Remove block {n}:", { n: l.n })}</span> <del class="opacity-70">{l.before}</del>
        {:else}<span class="text-mute">{t("Block {n}:", { n: l.n })}</span> <del class="opacity-70">{l.before}</del> → <ins class="bg-brand-soft no-underline px-0.5">{l.b}</ins>{/if}
      </li>
    {/each}
  </ul>
  {#if proposal.rejected?.length}<div class="text-mute text-sm">{t("{n} part could not be applied and was left out.", { n: proposal.rejected.length })}</div>{/if}
  {#if proposal.state === "proposed"}
    <div class="flex flex-wrap gap-2">
      <button class="btn primary" style="min-height:36px" data-testid="chat-accept" onclick={() => onaccept?.(proposal)}>{t("Accept")}</button>
      <button class="btn quiet" style="min-height:40px" data-testid="chat-reject" onclick={() => onreject?.(proposal)}>{t("Reject")}</button>
    </div>
  {:else}
    <div class="text-sm text-mute" data-testid="chat-proposal-state">{proposal.state === "accepted" ? t("Accepted") : proposal.state === "rejected" ? t("Rejected") : t("Undone")}</div>
  {/if}
</div>
<style>
  .dc { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: .7rem 0; }
  .dc ins { position: relative; background-image: linear-gradient(90deg, color-mix(in srgb, var(--brand) 26%, transparent), color-mix(in srgb, var(--brand) 26%, transparent)); background-repeat: no-repeat; background-size: 100% 100%; }
  .dc.applied ins { animation: sweep 700ms cubic-bezier(.2,.8,.2,1) both; }
  @keyframes sweep { from { background-size: 0% 100%; } 70% { background-size: 100% 100%; } to { background-size: 100% 100%; } }
  @media (prefers-reduced-motion: reduce) { .dc.applied ins { animation: none; } }
</style>
