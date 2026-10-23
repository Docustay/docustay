<script>
  // A sheet of paper: white, a 1px paper border, 3 to 4px corners, Newsreader at 15px/1.7, on the warm paper ground. Used where people read and sign (the document page, the signing page).
  let { ground = false, class: cls = "", children } = $props();
</script>
<div class="{ground ? 'paper-ground rounded-md p-4 sm:p-8' : ''}">
  <div class="paper-serif mx-auto max-w-[680px] rounded-[4px] border bg-white px-6 py-7 text-[15px] leading-[1.7] text-[#15171c] sm:px-12 sm:py-12 {cls}" style="border-color: var(--paper-sheet-line)">{@render children?.()}</div>
</div>
