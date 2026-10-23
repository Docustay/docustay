<script>
  // The ten recovery codes, shown once: Download, Copy, Print, and a box the person ticks to say they saved them. `onsaved` fires when they press Finish.
  import CopyButton from "$lib/ui/CopyButton.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { codes = [], onsaved = () => {}, finishLabel = "" } = $props();
  let saved = $state(false);
  const pretty = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
  const text = $derived(`${t("Docustay recovery codes")}\n${t("Each works once. Keep them somewhere safe.")}\n\n${codes.map(pretty).join("\n")}\n`);
  function download() {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "docustay-recovery-codes.txt"; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function print() {
    const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.append(f);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    f.contentDocument.write(`<!doctype html><title>${esc(t("Docustay recovery codes"))}</title><body style="font-family:system-ui;padding:32px"><h1 style="font-size:20px">${esc(t("Docustay recovery codes"))}</h1><p>${esc(t("Each works once. Keep them somewhere safe."))}</p><ol style="font:18px/2 ui-monospace,monospace;columns:2">${codes.map((c) => `<li>${esc(pretty(c))}</li>`).join("")}</ol>`);
    f.contentDocument.close(); f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000);
  }
</script>
<div data-testid="recovery-codes">
  <p class="text-sm text-text-2">{t("If you lose your phone or your key, one of these gets you back in. Each works once, and they are not shown again.")}</p>
  <ol class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl border border-line bg-card p-4 font-mono text-[15px]" data-testid="recovery-list">
    {#each codes as c, i (c)}<li class="flex gap-2"><span class="w-5 text-right text-faint">{i + 1}</span><span>{pretty(c)}</span></li>{/each}
  </ol>
  <div class="mt-3 flex flex-wrap gap-2">
    <button type="button" class="btn" onclick={download} data-testid="recovery-download"><Icon name="download" size={16} />{t("Download")}</button>
    <CopyButton value={text} label={t("Copy")} copiedLabel={t("Copied")} testid="recovery-copy" class="!border !border-line-strong" />
    <button type="button" class="btn" onclick={print} data-testid="recovery-print"><Icon name="printer" size={16} />{t("Print")}</button>
  </div>
  <label class="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={saved} data-testid="recovery-saved" />{t("I saved these codes somewhere safe")}</label>
  <button type="button" class="btn primary mt-3" disabled={!saved} onclick={onsaved} data-testid="recovery-finish">{finishLabel || t("Finish")}</button>
</div>
