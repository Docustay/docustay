<script>
  // One changelog entry on the date rail (frame: Changelog): a 150px date column with a dot on a vertical hairline, a 340px art cover, a 26px title and the words.
  let { date, label = "", title, cover = null, children, tag = "" } = $props();
  const text = $derived(label || new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
</script>
<article class="entry relative grid gap-4 pb-14 md:grid-cols-[150px_1fr] md:gap-10"><time class="font-mono text-[12.5px] text-faint md:pt-2" datetime={date}>{text}</time>
<span class="dot absolute hidden md:block" aria-hidden="true"></span>
<div class="min-w-0">{#if cover}<div class="mb-6 overflow-hidden rounded-[20px] border border-line">{@render cover()}</div>{/if}<h2 class="text-[26px] font-medium leading-tight tracking-tight">{title}{#if tag} <span class="chip info ml-1 align-middle">{tag}</span>{/if}</h2><div class="mt-3 text-[15.5px] leading-relaxed text-text-2">{@render children?.()}</div></div></article>
<style>
  .dot { left: 150px; top: .75rem; width: 9px; height: 9px; margin-left: 15px; border-radius: 99px; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
  .entry:not(:last-child)::before { content: ""; position: absolute; left: calc(150px + 19px); top: 1.4rem; bottom: -.7rem; width: 1px; background: var(--line); display: none; }
  @media (min-width: 768px) { .entry:not(:last-child)::before { display: block; } }
</style>
