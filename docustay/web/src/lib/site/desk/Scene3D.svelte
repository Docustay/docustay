<script>
  import { onMount } from "svelte";
  // Three small 3D scenes in the Desk look (three.js, MIT), each one a picture of something the product does:
  //   stack  a document is signed and sealed        route  a document passes through its signers        chain  one changed letter breaks every hash after it
  // Rules: three.js is not downloaded until the scene is near the screen; the loop stops when it leaves the screen; with reduced motion, or no WebGL, a still picture is shown instead; the scene is decoration (aria-hidden) and the words beside it say the same thing.
  let { kind = "stack", label = "" } = $props();
  let host = $state(null), still = $state(true), failed = $state(false);
  // Wait until the page has finished loading and the browser is idle, so the 3D library never competes with the first paint or the page's own scripts.
  const settled = () => new Promise((go) => { const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 1500)); if (document.readyState === "complete") setTimeout(idle, 600); else addEventListener("load", () => setTimeout(idle, 600), { once: true }); });
  onMount(() => {
    if (!host) return; let stop = () => {}, started = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || started) { if (started) api?.visible(e.isIntersecting); return; }
      started = true;
      await settled();
      try { const m = await import("./scene3d-run.js"); api = await m.run(host, kind, { reduced }); still = false; stop = api.dispose; } catch { failed = true; }
    }, { rootMargin: "120px" });
    let api = null; io.observe(host);
    return () => { io.disconnect(); stop(); };
  });
</script>
<div class="s3" bind:this={host} aria-hidden="true" data-scene={kind} data-ready={!still && !failed}>
  {#if still || failed}
    <div class="poster k-{kind}" data-poster>
      {#if kind === "stack"}<i class="p p1"></i><i class="p p2"></i><i class="p p3"></i><b class="seal"></b>{:else if kind === "route"}<i class="n n1"></i><i class="n n2"></i><i class="n n3"></i><i class="ln"></i><b class="env"></b>{:else}{#each [0, 1, 2, 3, 4] as i}<i class="bl" style="--i:{i}"></i>{/each}{/if}
    </div>
  {/if}
</div>
<style>
  .s3 { position: relative; width: 100%; aspect-ratio: 16 / 10; min-height: 260px; max-height: 460px; } .s3 :global(canvas) { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; }
  .poster { position: absolute; inset: 0; display: grid; place-items: center; }
  .k-stack .p { position: absolute; width: 150px; height: 200px; background: #faf8f3; border-radius: 3px; box-shadow: 0 24px 50px rgb(0 0 0 / .5); } .k-stack .p1 { transform: translate(-40px, 10px) rotate(-8deg); } .k-stack .p2 { transform: translate(0, 0) rotate(-2deg); } .k-stack .p3 { transform: translate(40px, -10px) rotate(5deg); }
  .k-stack .seal { position: absolute; width: 74px; height: 74px; border-radius: 50%; border: 3px solid #8585fd; right: 30%; bottom: 28%; opacity: .9; background: #5a3ac1 url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%2217.9 -5.1 283.5 283.5%22 role=%22img%22 aria-label=%22Docustay%22%3E%3Ctitle%3EDocustay%3C/title%3E%3Cpath fill=%22%23f3f2fa%22 d=%22M267 139.2V168.1C266.6 165.7 266.2 161.4 266 157.7C265.8 151.8 265.4 151.4 264.4 156.1C263.7 159 263.4 159.8 261.6 164.8C252.4 188.5 229.7 210.4 203.8 220.4C202.9 220.7 201.4 221.3 200.6 221.6C193.9 224.3 181.5 227.4 174.6 228.2C173.4 228.4 171.7 228.6 170.9 228.8C168.7 229.2 53.1 229.4 52.6 229C52.3 228.7 52.2 224.7 52.2 203.7C52.2 178.8 52.2 178.8 52.8 178.2C53.3 177.6 55 176.2 61.2 170.9C62.4 169.9 63.9 168.7 64.5 168.1C65.1 167.6 66 166.8 66.5 166.4C67 166 69.8 163.6 72.6 161.1C79.3 155.4 89.7 146.4 96.1 140.9C98.9 138.5 102 135.8 103.1 134.8C104.2 133.9 107.2 131.4 109.8 129.3C112.3 127.2 115.2 124.7 116.2 123.8C116.6 123.5 116.8 123.2 117.1 123C118.7 121.6 119.6 120.8 120.4 120.8C121.6 120.8 122.8 122.4 125.8 126C127.3 127.7 129.7 130.6 131.3 132.4C134.4 136.1 135 136.9 135 137.8C135 138.4 133.6 140.7 131.5 143.8C130.8 144.6 129 147.4 127.3 149.9C125.6 152.4 123.4 155.6 122.4 157.1C121.3 158.6 120 160.7 119.3 161.6C118.7 162.6 116.9 165.3 115.4 167.6C111.1 174 110 176 110.1 176.4C110.2 176.7 112.9 176.8 127.1 176.8H143.9L144.9 176C145.4 175.6 148.6 172.8 152 169.8C155.4 166.7 160.3 162.3 162.9 159.9C180.8 143.8 182.9 142.1 183.2 140.1C183.2 139.7 183.2 139.4 183.2 138.9C183.4 134.6 183 134 172 124.8C169.5 122.6 165.3 119.1 162.7 116.9C160.2 114.7 156.8 111.8 155.2 110.5C153.7 109.2 151.1 107 149.5 105.5C145.6 102 145.4 101.9 143.4 101.4C141.9 101 138 101 97.2 101C60 101 52.7 101 52.5 100.7C52.4 100.5 52.3 87.9 52.3 72.7V72.7C52.3 46.1 52.3 45.1 52.7 44.7C52.7 44.6 52.8 44.6 52.8 44.6C53.5 44 161 43.8 167.8 44.5C179.6 45.5 194.7 49.2 203.6 53.2C203.9 53.4 205 53.8 206 54.3C230.1 64.5 252.2 86.2 260.7 108C264.8 118.6 266.4 125.4 266.6 134.4C266.7 137.1 266.8 138.7 267 139.2Z%22/%3E%3C/svg%3E%0A") center / 56% no-repeat; }
  .k-route .n { position: absolute; width: 54px; height: 54px; border-radius: 50%; border: 1.5px solid rgb(244 242 236 / .8); } .k-route .n1 { left: 16%; top: 55%; } .k-route .n2 { left: 46%; top: 30%; } .k-route .n3 { right: 16%; top: 55%; border-color: #8585fd; }
  .k-route .ln { position: absolute; left: 20%; right: 20%; top: 50%; border-top: 1.5px dashed rgb(244 242 236 / .4); } .k-route .env { position: absolute; left: 30%; top: 40%; width: 46px; height: 60px; background: #faf8f3; border-radius: 3px; }
  .k-chain .bl { position: absolute; width: 11%; aspect-ratio: 1; border: 1.5px solid rgb(244 242 236 / .8); left: calc(8% + var(--i) * 18%); top: 42%; } .k-chain .bl:nth-child(n + 3) { border-color: #8585fd; }
</style>
