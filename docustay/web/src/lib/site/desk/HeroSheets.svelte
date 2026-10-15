<script>
  import Paper from "./Paper.svelte";
  import Stamp from "./Stamp.svelte";
  // The Home hero: three paper sheets in a 580 px stage. The contract (-5°, floats 7 s) with a red dashed "Sign here" and a grey dashed "Date"; the certificate (+4°, floats 8 s) with the SIGNED stamp; the email card (-2°).
</script>
<div class="stage" aria-hidden="true">
  <div class="s1"><Paper tilt={-5} float={7} class="p1">
    <div class="pm">Services agreement</div><div class="pt" style="margin-top:6px">Services Agreement</div>
    <div class="pl" style="width:92%"></div><div class="pl"></div><div class="pl" style="width:84%"></div><div class="pl" style="width:70%"></div>
    <div class="row"><div class="fld red">Sign here</div><div class="fld">Date</div></div>
  </Paper></div>
  <div class="s2"><Paper tilt={4} float={8} class="p2">
    <div class="pm">Certificate of completion</div>
    <div class="pl" style="width:70%;margin-top:14px"></div><div class="pl" style="width:88%"></div><div class="pl" style="width:60%"></div>
    <div class="hash">sha-256 · 9f2c…41ab</div><div class="st"><Stamp text="SIGNED" /></div>
  </Paper></div>
  <div class="s3"><Paper tilt={-2} class="p3">
    <div class="pm">From Docustay</div><div class="pt" style="margin-top:6px">Your agreement is ready to sign</div>
    <div class="pl" style="width:80%"></div><div class="btn">Review and sign</div>
  </Paper></div>
</div>
<style>
  .stage { position: relative; height: 520px; width: 100%; max-width: 580px; margin-left: auto; }
  .s1 { position: absolute; left: 4%; top: 6%; width: 52%; z-index: 2; } .s2 { position: absolute; right: 2%; top: 20%; width: 50%; z-index: 3; } .s3 { position: absolute; left: 20%; bottom: 0; width: 56%; z-index: 4; }
  :global(.p1), :global(.p2), :global(.p3) { padding: 22px; } :global(.p1) { min-height: 270px; } :global(.p2) { min-height: 240px; }
  .row { display: flex; gap: 10px; margin-top: 26px; } .row .fld { flex: 1; }
  .hash { margin-top: 24px; font: 500 10px/1 var(--font-mono); color: #6f6b63; letter-spacing: .06em; } .st { position: absolute; right: 18px; bottom: 22px; }
  .btn { margin-top: 14px; display: inline-block; background: #1b1b1b; color: #faf8f3; font: 600 12px/1 var(--font-sans); padding: 10px 14px; border-radius: 6px; }
  @media (max-width: 900px) { .stage { height: 440px; margin: 28px auto 0; } .s1 { left: 0; } }
</style>
