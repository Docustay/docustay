<script>
  // BILLING (Run 9 boards B1, B3, B4, Pay4): the Pro card — a thick card with a visible edge that leans towards the pointer. The words on it are real text. Reduced motion, touch or a
  // slow device: flat.
  import { tilt } from "../fx/three-d.js";
  let { children, compact = false, testid = "pro-card-3d" } = $props();
</script>
<div class="pc" class:compact data-testid={testid} {@attach tilt(5)}><div class="face">{@render children?.()}</div></div>
<style>
  .pc { position: relative; border-radius: var(--rad-l, 18px); transform-style: preserve-3d; }
  .face { position: relative; border-radius: inherit; padding: 28px; color: #fff; background: linear-gradient(150deg, #8f8af8 0%, #6b4fd0 32%, #5a3ac1 70%, #4a3299 100%); box-shadow: 0 30px 70px rgb(90 58 193 / .35); overflow: hidden; }
  .compact .face { padding: 20px 22px; }
  .face::before { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: 26px; background: linear-gradient(90deg, rgb(0 0 0 / 0), rgb(30 18 80 / .35)); }
  .face::after { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at var(--lx, 20%) var(--ly, 10%), rgb(255 255 255 / .28), transparent 45%); pointer-events: none; }
</style>
