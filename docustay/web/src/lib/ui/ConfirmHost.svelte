<script>
  // Draws the question asked by `ask()` (confirm.svelte.js) in the same dialog as every other dialog. Escape and the close button answer "no".
  import Dialog from "./Dialog.svelte";
  import { confirmState, settle } from "./confirm.svelte.js";
  import { t } from "$lib/i18n/index.svelte.js";
</script>
<Dialog open={confirmState.open} title={confirmState.message} onclose={() => settle(false)} testid="confirm-dialog">
  {#if confirmState.input}<input class="field w-full" aria-label={confirmState.message} bind:value={confirmState.value} maxlength="500" data-testid="confirm-input" onkeydown={(e) => { if (e.key === "Enter" && (!confirmState.required || confirmState.value.trim())) { e.preventDefault(); settle(true); } }} />{/if}
  {#snippet footer()}
    <button class="btn" type="button" onclick={() => settle(false)} data-testid="confirm-no">{confirmState.no}</button>
    <button class="btn {confirmState.danger ? 'danger' : 'primary'}" type="button" disabled={confirmState.input && confirmState.required && !confirmState.value.trim()} onclick={() => settle(true)} data-testid="confirm-yes">{confirmState.yes}</button>
  {/snippet}
</Dialog>
