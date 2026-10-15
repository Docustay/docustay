<script>
  // The message box: grows with what is typed (up to six lines), Enter sends, Shift+Enter makes a new line, ↑ in an empty box recalls the last message, Stop while an answer streams, attach a file, and the line that
  // says an AI can be wrong. The structure follows the Prompt Input of Svelte AI Elements (MIT, Copyright (c) 2026 Sikandar Bhide).
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = $bindable(""), busy = false, disabled = false, name = "", attached = null, onsend, onstop, onrecall = () => null, onattach = null, box = $bindable(null), variant = "plain", placeholder = "", foot = "", extra = null } = $props();
  // Run 8 looks: `plain` (A, C: a soft field on #fafafb), `soft` (B: a grey rounded field with a send square), `dark` (D: the dark command bar). `extra` is a snippet beside the send (D's Think harder tag).
  let file = $state(null), recallAt = $state(-1);
  function grow() { if (!box) return; box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, 6 * 24 + 20)}px`; }
  $effect(() => { value; grow(); });
  function key(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy && value.trim()) { recallAt = -1; onsend?.(value); } }
    else if (e.key === "ArrowUp" && !value) { const v = onrecall(Math.max(recallAt, -1) + 1); if (v) { e.preventDefault(); recallAt += 1; value = v; } }
  }
  async function picked(e) { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) await onattach?.(f); }
</script>
<form class="pin {variant}" onsubmit={(e) => { e.preventDefault(); if (!busy && value.trim()) onsend?.(value); }}>
  {#if attached}<div class="attached text-sm" data-testid="chat-attached"><Icon name="files" size={14} /> {attached.name}</div>{/if}
  <div class="row">
    {#if onattach}<button type="button" class="btn quiet !min-h-0 !p-2" style="min-height:44px;min-width:44px" aria-label={t("Attach a file")} data-testid="chat-attach" onclick={() => file?.click()}><Icon name="plus" size={18} /></button><input bind:this={file} type="file" class="sr-only" tabindex="-1" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg" data-testid="chat-attach-input" onchange={picked} />{/if}
    <textarea bind:this={box} bind:value rows="1" maxlength="4000" class="field grow" style="min-height:44px;resize:none;overflow-y:auto" {disabled} placeholder={placeholder || t("Ask {name}…", { name })} aria-label={t("Your message")} data-testid="chat-input" onkeydown={key} oninput={grow}></textarea>
    {#if extra}{@render extra()}{/if}
    {#if busy}<button class="btn" type="button" style="min-height:44px" data-testid="chat-stop" onclick={() => onstop?.()}>{t("Stop")}</button>
    {:else}<button class="btn primary" type="submit" style="min-height:44px;min-width:44px" disabled={disabled || !value.trim()} data-testid="chat-send" aria-label={t("Send message")}><Icon name="send" size={18} /></button>{/if}
  </div>
  {#if foot !== null}<p class="foot text-xs text-mute">{foot || t("AI can make mistakes. Review before sending.")}</p>{/if}
</form>
<style>
  .pin { display: grid; gap: .3rem; padding: .6rem .7rem .45rem; border-top: 1px solid var(--line); background: var(--card); }
  .row { display: flex; gap: .4rem; align-items: flex-end; }
  .attached { display: flex; align-items: center; gap: .35rem; color: var(--mute); overflow-wrap: anywhere; }
  .foot { margin: 0; text-align: center; }
  .pin :global(textarea.field) { background: #fafafb; border-color: var(--line); border-radius: 10px; }
  :global(:root[data-theme="dark"]) .pin :global(textarea.field) { background: var(--tint); }
  .soft { border-top: 0; background: transparent; }
  .soft :global(textarea.field) { background: var(--tint) !important; border-color: transparent !important; border-radius: 14px !important; }
  .dark { border: 0; border-radius: 14px; background: #16161d; color: #fff; padding: .5rem .55rem; box-shadow: 0 18px 40px rgb(10 10 30 / .35); }
  .dark :global(textarea.field) { background: transparent !important; border-color: transparent !important; color: #fff; }
  .dark :global(textarea.field::placeholder) { color: rgb(255 255 255 / .55); }
  .dark :global(.btn.quiet) { color: rgb(255 255 255 / .8); }
  .dark :global(.btn.primary) { background: #8585fd; border-color: #8585fd; color: #16161d; }
  .dark .foot { display: none; }
  .row { align-items: center; }
</style>
