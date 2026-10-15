<script>
  import Sheet from "./Sheet.svelte";
  import CodeWin from "./CodeWin.svelte";
  import Flow from "./Flow.svelte";
  import Figure from "./Figure.svelte";
  import Anatomy3D from "./Anatomy3D.svelte";
  import SealCoin from "./SealCoin.svelte";
  import Ledger from "./Ledger.svelte";
  import Paper from "./Paper.svelte";
  import SiteIcon from "./SiteIcon.svelte";
  // The art on the right of a page's first screen: papers (1 to 3 sheets, offset and tilted), a code window, a terminal transcript, a flow, a ledger, the exploded anatomy, or nothing.
  let { art } = $props();
</script>
{#if art?.kind === "papers"}
  <div class="pap n{art.sheets.length}" aria-hidden={art.decor === false ? undefined : "true"}>{#each art.sheets as s, i}<div class="sh s{i}"><Sheet {s} /></div>{/each}</div>
{:else if art?.kind === "code"}<CodeWin tabs={art.tabs} response={art.response} responseLabel={art.responseLabel} label={art.label} />
{:else if art?.kind === "terminal"}
  <div class="term" role="img" aria-label={art.label}><div class="bar"><span></span><span></span><span></span></div><pre><code>{#each art.lines as l}<span class={l.red ? "red" : l.dim ? "dim" : ""}>{l.t}{"\n"}</span>{/each}</code></pre></div>
{:else if art?.kind === "flow"}<Figure caption={art.caption}><Flow nodes={art.nodes} vertical={art.vertical} dims={false} /></Figure>
{:else if art?.kind === "ledger"}<Figure caption="LIVE EVENTS · SAMPLE DATA FOR ILLUSTRATION"><Ledger /></Figure>
{:else if art?.kind === "chat"}
  <div class="chatw"><Paper tilt={-2} float={7}><div class="cm"><p class="pm">YOU</p><p class="ask">{art.ask}</p><ul class="steps">{#each art.steps as st}<li><SiteIcon name="check" size={16} /><span>{st}</span></li>{/each}</ul><div class="cb"><span class="b1">{art.primary}</span><span class="b2">{art.secondary}</span></div></div></Paper></div>
{:else if art?.kind === "anatomy"}<Anatomy3D />
{:else if art?.kind === "coin"}<SealCoin />
{/if}
<style>
  .chatw { max-width: 440px; margin: 0 auto; } .cm { padding: 24px; color: #1b1b1b; } .cm .pm { margin: 0 0 6px; } .ask { margin: 0 0 18px; font: 600 17px/1.35 var(--font-sans); letter-spacing: -.02em; } .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; } .steps li { display: flex; gap: 10px; align-items: center; font-size: 14.5px; color: #1b1b1b; } .steps :global(svg) { color: #5a3ac1; flex: none; }
  .cb { display: flex; gap: 10px; margin-top: 20px; } .b1 { background: #1b1b1b; color: #faf8f3; font: 600 13px/1 var(--font-sans); padding: 11px 15px; border-radius: 6px; } .b2 { border: 1px solid #1b1b1b; color: #1b1b1b; font: 600 13px/1 var(--font-sans); padding: 10px 14px; border-radius: 6px; }
  .pap { position: relative; min-height: 420px; width: 100%; max-width: 520px; margin-left: auto; } .sh { position: absolute; width: 58%; }
  .n1 .s0 { position: relative; width: 70%; margin: 0 auto; }
  .n2 .s0 { left: 2%; top: 4%; z-index: 1; } .n2 .s1 { right: 2%; top: 22%; width: 54%; z-index: 2; }
  .n3 .s0 { left: 0; top: 2%; } .n3 .s1 { right: 0; top: 18%; z-index: 2; } .n3 .s2 { left: 18%; bottom: 0; z-index: 3; }
  .term { background: #0f0f11; border: 1px solid #2a2a2c; border-radius: 8px; overflow: hidden; } .bar { display: flex; gap: 6px; padding: 10px 14px; background: #131315; border-bottom: 1px solid #2a2a2c; } .bar span { width: 9px; height: 9px; border-radius: 50%; background: #2a2a2c; }
  .term pre { margin: 0; padding: 18px 20px; font: 400 13px/1.8 var(--font-mono); color: #e6e2d8; overflow-x: auto; white-space: pre-wrap; } .term .dim { color: #8f8a80; } .term .red { color: #8585fd; }
  @media (max-width: 900px) { .pap { min-height: 380px; margin: 20px auto 0; } .sh { width: 62%; } }
</style>
