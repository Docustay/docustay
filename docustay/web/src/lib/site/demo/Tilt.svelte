<script>
  // A card that leans toward the pointer and catches a little light (Run 9 board "Cards that tilt"): CSS 3D, no library. Off for reduced motion and for touch screens, where it stays flat.
  let { children, label = "" } = $props();
  let el = $state(null);
  const ok = () => typeof matchMedia !== "undefined" && !matchMedia("(prefers-reduced-motion: reduce)").matches && matchMedia("(hover: hover)").matches;
  function move(e) { if (!ok() || !el) return; const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; el.style.setProperty("--rx", `${(-y * 7).toFixed(2)}deg`); el.style.setProperty("--ry", `${(x * 9).toFixed(2)}deg`); el.style.setProperty("--gx", `${(x + 0.5) * 100}%`); el.style.setProperty("--gy", `${(y + 0.5) * 100}%`); }
  function leave() { if (!el) return; el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); }
</script>
<div class="tilt" bind:this={el} onpointermove={move} onpointerleave={leave} role="presentation">{@render children()}</div>
<style>
  .tilt { --rx: 0deg; --ry: 0deg; --gx: 50%; --gy: 0%; position: relative; height: 100%; border: 1px solid var(--d-border); border-radius: 14px; background: radial-gradient(420px circle at var(--gx) var(--gy), rgb(90 58 193 / 0.065), transparent 60%), var(--d-panel); padding: 26px; transform: perspective(900px) rotateX(var(--rx)) rotateY(var(--ry)); transition: transform .25s ease-out, border-color .2s; will-change: transform; }
  .tilt:hover { border-color: rgb(90 58 193 / 0.5); }
  @media (prefers-reduced-motion: reduce) { .tilt { transform: none; transition: none; } }
</style>
