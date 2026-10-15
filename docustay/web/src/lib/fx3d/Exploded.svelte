<script>
  // MOTION 6 · A DOCUMENT, TAKEN APART (Run 9 board): page, fields, signature and seal lift apart in layers, then click back together. For the certificate and the Trust page. Plays once when
  // it comes into view (about 2.6 s). Reduced motion or a slow device: the assembled document, still. Decorative: the words beside it carry the meaning.
  import { shown } from "../fx/index.js";
  let { signer = "J. Lee", seal = "SEALED", testid = "fx-exploded" } = $props();
</script>
<div class="ex" aria-hidden="true" data-testid={testid} {@attach shown(0.4)}>
  <div class="stage">
    <div class="l page"><i></i><i></i><i></i><i class="s"></i></div>
    <div class="l fields"><b></b><b class="w"></b></div>
    <div class="l sig"><span>{signer}</span></div>
    <div class="l seal"><span>{seal}</span></div>
  </div>
</div>
<style>
  .ex { width: 260px; height: 210px; perspective: 900px; display: grid; place-items: center; }
  .stage { position: relative; width: 150px; height: 190px; transform-style: preserve-3d; transform: rotateX(56deg) rotateZ(-34deg); }
  .l { position: absolute; inset: 0; border-radius: 6px; }
  .page { background: #fff; box-shadow: 0 18px 40px rgb(40 25 100 / .18); padding: 18px 16px; display: grid; gap: 8px; align-content: start; }
  .page i { display: block; height: 4px; border-radius: 2px; background: #e6e3f6; } .page i.s { width: 60%; }
  .fields { padding: 70px 14px 0; display: grid; gap: 10px; align-content: start; } .fields b { display: block; height: 16px; border: 1.5px dashed #7f7bf6; border-radius: 4px; background: rgb(127 123 246 / .08); } .fields b.w { width: 70%; }
  .sig { display: grid; align-items: end; padding: 0 18px 34px; } .sig span { font: italic 600 15px/1 var(--font-serif, Georgia, serif); color: #5a3ac1; border-bottom: 1px solid #5a3ac1; padding-bottom: 3px; }
  .seal { display: grid; justify-items: end; align-items: start; padding: 10px; } .seal span { font: 700 8px/1 var(--font-mono, monospace); letter-spacing: .14em; color: #5a3ac1; border: 1.5px solid #5a3ac1; border-radius: 999px; padding: 9px 6px; background: #fff; }
  :global(html.js) .ex:not([data-shown]) .l { opacity: .001; }
  .ex:global([data-shown]) .fields { animation: ex-a 2.6s cubic-bezier(.2,.8,.2,1) both; } .ex:global([data-shown]) .sig { animation: ex-b 2.6s cubic-bezier(.2,.8,.2,1) both; } .ex:global([data-shown]) .seal { animation: ex-c 2.6s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes ex-a { 0%, 100% { transform: translateZ(1px); } 35%, 62% { transform: translateZ(34px); } }
  @keyframes ex-b { 0%, 100% { transform: translateZ(2px); } 35%, 62% { transform: translateZ(64px); } }
  @keyframes ex-c { 0%, 100% { transform: translateZ(3px); } 35%, 62% { transform: translateZ(96px); } }
  @media (prefers-reduced-motion: reduce) { .ex .l { animation: none !important; opacity: 1 !important; } }
  :global(html[data-lite]) .ex .l { animation: none !important; opacity: 1 !important; }
</style>
