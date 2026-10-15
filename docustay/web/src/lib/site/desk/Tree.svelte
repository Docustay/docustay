<script>
  // The licence decision tree: one question, two branches, the answers. The commercial branch is the red node. Prices come from plans.js through the page.
  let { selfPro = "", commercial = "" } = $props();
</script>
<div class="tr" data-tree>
  <div class="q">HOW WILL YOU USE DOCUSTAY?</div>
  <div class="br">
    <div class="side"><div class="nd">Run it for your own business</div><span class="ln"></span>
      <div class="leaf"><b>Community</b><i>AGPL-3.0 · free</i></div><div class="leaf"><b>Self-host Pro</b><i>{selfPro}</i></div></div>
    <div class="side"><div class="nd">Ship it inside a product, white-label it, resell it, or keep a private fork</div><span class="ln"></span>
      <div class="leaf red"><b>Commercial licence</b><i>{commercial}</i></div></div>
  </div>
</div>
<style>
  .tr { display: grid; gap: 22px; justify-items: center; } .q { border: 1.2px solid rgb(244 242 236 / .78); padding: 14px 22px; font: 500 12px/1 var(--font-mono); letter-spacing: .12em; }
  .br { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; width: 100%; } .side { display: grid; gap: 14px; justify-items: stretch; align-content: start; } .nd { border: 1.2px solid rgb(244 242 236 / .78); background: rgb(244 242 236 / .03); padding: 16px; font: 600 18px/1.25 var(--font-sans); letter-spacing: -.02em; }
  .ln { justify-self: center; height: 20px; border-left: 1.2px dashed rgb(244 242 236 / .6); } .leaf { border: 1.2px solid rgb(244 242 236 / .5); padding: 14px 16px; } .leaf.red { border-color: #8585fd; background: rgb(133 133 253 / .1); } .leaf b { display: block; font: 600 17px/1.2 var(--font-sans); } .leaf i { display: block; font: 400 11px/1.4 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: #a8a39a; margin-top: 5px; font-style: normal; }
  @media (max-width: 700px) { .br { grid-template-columns: 1fr; } }
</style>
