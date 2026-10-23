<script>
  // C5 (subtle on cream, 16 Oct 2026): a thin violet line that travels round a card's edge (an idea from Magic UI, MIT, rebuilt here in plain CSS: a rotating conic gradient behind a masked border).
  // Used on the Pro plan card and on ONE primary call to action in a closing band. Stands still for reduced motion.
  let { radius = 22, width = 1.5, class: cls = "", children } = $props();
</script>
<div class="bb {cls}" style="--r:{radius}px;--w:{width}px">{@render children?.()}</div>
<style>
  @property --ang { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
  .bb { position: relative; border-radius: var(--r); }
  .bb::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: var(--w); background: conic-gradient(from var(--ang), var(--hairline) 0%, var(--hairline) 62%, rgb(90 58 193 / .55) 80%, var(--hairline) 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: beam 6s linear infinite; pointer-events: none; }
  @keyframes beam { to { --ang: 360deg; } }
  @media (prefers-reduced-motion: reduce) { .bb::before { animation: none; --ang: 120deg; } }
</style>
