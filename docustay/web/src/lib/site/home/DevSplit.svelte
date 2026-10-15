<script>
  // "Your product, our signing": text pinned on the left, a code card on the right with three tabs, and a small webhook card overlapping its corner.
  import Doodle from "$lib/doodle/Doodle.svelte";
  import { shown } from "$lib/fx/index.js";
  let { curl } = $props();
  const js = `import { Docustay } from "@docustay2026/sdk";\nconst docustay = new Docustay(process.env.DOCUSTAY_KEY);\nawait docustay.sendDocument({\n  templateId: "TEMPLATE_ID",\n  parties: [{ seat: "signer_1", name: "Rosa Alvarez", email: "rosa@example.com" }],\n});`;
  const py = `from docustay import Docustay\nd = Docustay(os.environ["DOCUSTAY_KEY"])\nd.send_document(\n  template_id="TEMPLATE_ID",\n  parties=[{"seat": "signer_1", "name": "Rosa Alvarez", "email": "rosa@example.com"}],\n)`;
  const tabs = [["curl", curl], ["JavaScript", js], ["Python", py]];
  let tab = $state(0);
</script>
<div class="wrap-wide dev">
  <div class="txt">
    <p class="eyebrow">For developers</p>
    <h2 class="t-h1 mt-3">Your product, our signing.</h2>
    <p class="lede mt-4">One request sends a document. Embed the signing form on your own pages, so nobody leaves your site. Test mode keeps practice runs out of the real thing, and a signed webhook tells your system the moment it is done.</p>
    <ul class="pts"><li>REST API with scoped keys and safe retries</li><li>Signed webhooks, replayable from a log</li><li>An embeddable form, a JavaScript and a Python client, an MCP server</li></ul>
    <div class="mt-7 flex flex-wrap gap-3"><a class="btn on-film" href="/developers">Developers</a><a class="btn ghost-film" href="/docs">Read the docs</a></div>
    <Doodle name="arrow-curl" size="6rem" class="mt-8" />
  </div>
  <div class="code reveal" {@attach shown(0.2)}>
    <div class="tabs" role="tablist" aria-label="Language">{#each tabs as [t], i}<button role="tab" class="tab" class:on={tab === i} aria-selected={tab === i} onclick={() => (tab = i)}>{t}</button>{/each}</div>
    <pre data-lenis-prevent-wheel tabindex="0" aria-label="{tabs[tab][0]} example"><code>{tabs[tab][1]}</code></pre>
    <div class="hook"><Doodle name="check" size="2.2rem" animate={false} /><div><b>document.executed</b><span>Signed webhook · sealed copy ready</span></div></div>
  </div>
</div>
<style>
  .dev { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: clamp(1.5rem, 5vw, 5rem); align-items: center; }
  .pts { margin: 1.5rem 0 0; padding: 0; list-style: none; } .pts li { padding: .55rem 0 .55rem 1.6rem; position: relative; color: var(--black-mute); border-top: 1px solid var(--black-line); } .pts li:first-child { border-top: 0; }
  .pts li::before { content: ""; position: absolute; left: 0; top: 1.05rem; width: .7rem; height: .7rem; border-radius: 50%; background: var(--periwinkle); }
  .code { position: relative; background: #0c0b12; border: 1px solid var(--black-line); border-radius: var(--r-4); padding: 0; box-shadow: var(--sh-3); }
  .tabs { display: flex; gap: .25rem; padding: .6rem .6rem 0; border-bottom: 1px solid var(--black-line); }
  .tab { background: none; border: 0; color: var(--black-mute); padding: .6rem 1rem; border-radius: var(--r-1) var(--r-1) 0 0; font: inherit; cursor: pointer; } .tab.on { color: #fff; box-shadow: inset 0 -2px 0 var(--periwinkle); } .tab:hover { color: #fff; }
  pre { margin: 0; padding: 1.4rem 1.5rem 2.2rem; overflow-x: auto; color: #e9e4f7; font-size: .92rem; line-height: 1.7; min-height: 13rem; }
  .hook { position: absolute; right: -1rem; bottom: -1.6rem; display: flex; gap: .7rem; align-items: center; background: var(--card); color: var(--ink); padding: .8rem 1.1rem; border-radius: var(--r-3); box-shadow: var(--sh-3); }
  .hook b { display: block; font-size: .9rem; font-family: ui-monospace, monospace; } .hook span { display: block; font-size: .78rem; color: var(--mute); }
  @media (max-width: 899px) { .dev { grid-template-columns: 1fr; } .hook { right: .5rem; } }
</style>
