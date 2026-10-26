<script>
  // MOTION 6 · THE DOCUMENT FLIES TO THEM (Run 9 board): after Send, an envelope arcs through 3D space to the signer's picture, then `ondone` lets the status update. About 1.5 s.
  // Reduced motion or a slow device: the envelope already beside the picture, and `ondone` at once. Decorative; the status line says what happened.
  import { onMount } from "svelte";
  let { name = "", initials = "", ondone = () => {}, testid = "fx-envelope-arc" } = $props();
  let landed = $state(false);
  onMount(() => { const quick = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-lite");
    const id = setTimeout(() => { landed = true; ondone(); }, quick ? 0 : 1500); return () => clearTimeout(id); });
</script>
<div class="ea" aria-hidden="true" data-testid={testid} data-landed={landed ? "" : undefined}>
  <span class="env"><i class="flap"></i></span>
  <span class="who"><span class="av">{initials}</span><span class="nm">{name}</span></span>
</div>
<style>
  .ea { position: relative; width: 280px; height: 120px; perspective: 900px; }
  .env { position: absolute; left: 6px; top: 40px; width: 58px; height: 38px; border-radius: 7px; background: linear-gradient(150deg, #6b4fd0, #5a3ac1); box-shadow: 0 12px 24px rgb(90 58 193 / .3); animation: ea-fly 1.4s cubic-bezier(.45,.05,.3,1) both; transform-style: preserve-3d; }
  .flap { position: absolute; inset: 0 0 45%; clip-path: polygon(0 0, 100% 0, 50% 100%); background: rgb(255 255 255 / .18); }
  .who { position: absolute; right: 8px; top: 30px; display: grid; justify-items: center; gap: 6px; }
  .av { width: 44px; height: 44px; border-radius: 50%; background: #d9d6fb; color: #3b2a87; display: grid; place-items: center; font: 600 14px/1 var(--font-sans); transition: transform 240ms cubic-bezier(.2,.8,.2,1); }
  .ea[data-landed] .av { transform: scale(1.08); } .nm { font-size: 12px; color: var(--mute); }
  @keyframes ea-fly { 0% { transform: translate3d(0, 0, 0) rotate(-8deg); opacity: 0; } 12% { opacity: 1; } 50% { transform: translate3d(110px, -46px, 80px) rotate(6deg) rotateY(18deg); } 88% { transform: translate3d(196px, -6px, 0) rotate(0) scale(.5); opacity: 1; } 100% { transform: translate3d(206px, -2px, 0) scale(.3); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .env { animation: none; transform: translate3d(170px, 0, 0) scale(.5); opacity: .9; } }
  :global(html[data-lite]) .env { animation: none; transform: translate3d(170px, 0, 0) scale(.5); opacity: .9; }
</style>
