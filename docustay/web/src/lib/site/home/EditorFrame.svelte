<script>
  // Frame "Write it, or have Scribe draft it": an 880px editor frame: a 200px field list, a white paper page with a violet signature field, a 240px field-settings column.
  import Icon from "$lib/ui/Icon.svelte";
  const fields = [["Signature", "pen"], ["Initials", "type"], ["Date signed", "calendar"], ["Full name", "user"], ["Text", "type"], ["Checkbox", "check"], ["Payment", "card"]];
</script>
<div class="mx-auto max-w-[880px] overflow-hidden rounded-[20px] border border-line bg-card shadow-[var(--shadow)]">
  <div class="flex items-center gap-2 border-b border-line px-4 py-2.5"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="ml-3 font-mono text-[12px] text-mute">Mutual NDA · 2 pages</span></div>
  <div class="grid grid-cols-1 md:grid-cols-[200px_1fr_240px]">
    <aside class="hidden border-r border-line p-3 md:block"><p class="mono-h">Fields</p><ul class="mt-2 grid gap-1">{#each fields as [t, i], n}<li class="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-[13.5px] {n === 0 ? 'bg-tint font-medium' : 'text-mute'}"><Icon name={i} size={15} />{t}</li>{/each}</ul></aside>
    <div class="grid place-items-center bg-[var(--sidebar)] p-6"><div class="relative w-full max-w-[300px] rounded-[4px] p-6" style="background:#fff; color:#191919; box-shadow: 0 20px 50px -24px rgb(60 40 140 / 0.27)"><p class="text-[13px] font-semibold">Mutual Non-Disclosure Agreement</p><div class="mt-4 grid gap-2">{#each [100, 94, 98, 72, 100, 90] as w}<span class="h-[5px] rounded-full" style="width:{w}%; background:#e3e1da"></span>{/each}</div>
      <div class="sigfield mt-8 flex h-12 items-center gap-2 rounded-[8px] px-3 text-[12px]"><Icon name="pen" size={14} />Sign here · Partner</div></div></div>
    <aside class="border-t border-line p-4 text-[13px] md:border-l md:border-t-0"><p class="mono-h">Field settings</p>
      <dl class="mt-3 grid gap-3"><div><dt class="text-mute">Type</dt><dd class="mt-1 font-medium">Signature</dd></div><div><dt class="text-mute">Who fills it</dt><dd class="mt-1 rounded-[9px] border border-line bg-tint px-2.5 py-1.5">Partner</dd></div><div><dt class="text-mute">Required</dt><dd class="mt-1 flex items-center gap-2"><span class="inline-block h-4 w-7 rounded-full bg-[var(--accent)]"></span>Yes</dd></div></dl></aside>
  </div>
</div>
<style>
  .dot { width: 9px; height: 9px; border-radius: 99px; background: var(--line-strong); }
  .mono-h { font-family: var(--font-mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .sigfield { border: 1.5px dashed #6c5ce0; background: rgb(108 92 224 / .1); color: #4b3db8; }
</style>
