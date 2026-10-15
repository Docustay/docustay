<script>
  // The white email card with the variables filled in. `html` is the preview the server already renders (sanitised there); shown in a sandboxed iframe so it cannot touch the page.
  let { html = "", subject = "", from = "", line = "", height = 360, title = "Email preview", subjectId = "", frameId = "email-preview" } = $props();
</script>
<div class="frame-ring overflow-hidden rounded-xl border border-line-strong bg-card"><div class="border-b border-line bg-tint px-4 py-2.5 text-sm">{#if from}<div class="text-faint">{from}</div>{/if}{#if subject}<div class="font-medium" data-testid={subjectId || undefined}>{subject}</div>{/if}{#if line}<div class="text-mute">{line}</div>{/if}</div><iframe {title} sandbox="" srcdoc={html} class="w-full bg-white" style="height:{height}px" data-testid={frameId}></iframe></div>
