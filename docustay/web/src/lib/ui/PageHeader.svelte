<script>
  // The header of every portal page (combined style): STICKY, 52px, a hairline under it. A back link and breadcrumb, the title at 15px/600, a one-line note, and the actions on the right.
  // The main column scrolls under it, the sidebar and this header never move. `back` = { href, label } puts "All documents /" before the title.
  let { title, line = "", back = null, filters = null, actions = null, titleTestid = "", class: cls = "" } = $props();
</script>
<header class="page-head mb-5 {cls}">
  {#if back}<a href={back.href} class="inline-flex min-h-6 shrink-0 items-center text-[13px] text-mute no-underline hover:text-ink" data-testid="page-back">{back.label}</a><span class="shrink-0 text-faint" aria-hidden="true">/</span>{/if}
  <div class="flex min-w-0 flex-1 items-baseline gap-3"><h1 class="truncate" data-testid={titleTestid || undefined}>{title}</h1>{#if line}<p class="hidden truncate text-[12.5px] text-mute sm:block">{line}</p>{/if}</div>
  {#if filters}<div class="order-last flex basis-full items-center gap-2 pb-2 sm:order-none sm:basis-auto sm:pb-0 [&>input]:min-w-0 [&>input]:flex-1 sm:[&>input]:flex-none">{@render filters()}</div>{/if}
  {#if actions}<div class="flex shrink-0 items-center justify-end gap-2">{@render actions()}</div>{/if}
</header>
