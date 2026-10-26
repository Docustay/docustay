<script>
  // The real-UI visuals (V3): small things built from real text and real numbers, never an image. Used as the hero of a page and as the preview in the mega menu (same component, `size`).
  // Nothing here animates. `id` picks the visual; `area` sets the one accent. Sizes: "menu" (340 x 300) and "hero" (the same layout, scaled up).
  import { AREA } from "../3d/palette.js"; import ExplodedScroll from "./ExplodedScroll.svelte";
  import { SEND_RESPONSE } from "../home-code.js";
  import facts from "../facts.gen.json";
  let { id, area = "home", size = "menu" } = $props();
  const ac = $derived(AREA[area]?.accent ?? AREA.home.accent);
  const soft = $derived(AREA[area]?.soft ?? AREA.home.soft);
  const ops = facts.operations ?? 77;
  const STEPS = ["Create", "Send", "Sign", "Pay", "Prove", "Automate"];
  const LANGS = ["JavaScript", "Python", "Go", "PHP", "C#"];
  const FLOW = [["Trigger", "A document from this template is signed"], ["Wait", "2 days"], ["Check", "Answer is yes"], ["Send", "Next document"]];
</script>
<div class="v {size}" style="--ac:{ac};--soft:{soft}" data-visual={id}>
  {#if id === "api-request"}
    <div class="vz-card vz-code"><p class="vz-cap">REQUEST</p><pre><b>POST</b> /api/v1/documents
Authorization: Bearer dsk_test_…
Idempotency-Key: 4d1e…

{`{ "template_id": "TEMPLATE_ID",
  "parties": [{ "seat": "signer_1",
    "name": "Pat Example",
    "email": "pat@example.com" }] }`}</pre></div>
    <div class="vz-card vz-code vz-ok"><p class="vz-cap"><i class="vz-ok-dot"></i>201 CREATED</p><pre>{SEND_RESPONSE.replace("// 201 Created\n", "")}</pre></div>
  {:else if id === "cli-terminal"}
    <div class="vz-term"><div class="vz-tb"><i></i><i></i><i></i><span>terminal</span></div><pre>$ npx docustay login
$ npx docustay send --test TEMPLATE_ID \
    --party signer_1="Pat Example &lt;pat@example.com&gt;"

<span class="vz-dim">{SEND_RESPONSE.replace("// 201 Created\n", "")}</span>
$ npx docustay listen
<span class="vz-dim">waiting for events…</span></pre></div>
  {:else if id === "commands-terminal"}
    <div class="vz-term"><div class="vz-tb"><i></i><i></i><i></i><span>docustay/</span></div><pre>$ cd docustay
$ ./init.sh
<span class="vz-dim">setup token printed</span>
$ docker compose up -d
<span class="vz-dim">open http://localhost:8080/setup</span></pre></div>
  {:else if id === "events-log"}
    <div class="vz-card vz-code"><p class="vz-cap">EVENT LOG</p><pre><span class="vz-dim">POST https://your.app/hooks/docustay</span>
documents.document.sent      <b class="vz-g">200 OK</b>
documents.document.opened    <b class="vz-g">200 OK</b>
documents.document.signed    <b class="vz-g">200 OK</b>
documents.document.executed  <b class="vz-g">200 OK</b></pre></div>
  {:else if id === "docs-thumb"}
    <div class="vz-card vz-docs"><div class="vz-side"><i class="vz-on"></i><i></i><i></i><i></i><i></i><i></i></div><div class="vz-art"><p class="vz-cap">QUICKSTART</p><h5>Send your first document</h5><i class="vz-l vz-w9"></i><i class="vz-l vz-w8"></i><i class="vz-l vz-w6"></i><pre>$ npm install ./sdk/js</pre><i class="vz-l vz-w9"></i><i class="vz-l vz-w7"></i></div></div>
  {:else if id === "changelog-list"}
    <div class="vz-card vz-list"><p class="vz-cap">CHANGELOG</p>{#each ["Fourteen languages", "Payments inside a document", "A new look and a board for your documents", "Developers"] as t, i}<div class="vz-row"><span class="vz-mono">OCT 2026</span><span>{t}</span></div>{/each}</div>
  {:else if id === "signpdf-langs"}
    <div class="vz-card"><div class="vz-signed"><p class="vz-cap">SIGNED</p><i class="vz-l vz-w9"></i><i class="vz-l vz-w8"></i><i class="vz-l vz-w6"></i><p class="vz-sig">Pat Lee</p></div><div class="vz-chips">{#each LANGS as l}<span>{l}</span>{/each}</div></div>
  {:else if id === "openapi-json"}
    <div class="vz-card vz-code"><p class="vz-cap">openapi.json</p><pre>{`{ "openapi": "3.1.0",
  "info": { "title": "Docustay API" },
  "paths": { … },`}
  <b>"operations": {ops}</b>
{`}`}</pre><p class="vz-big">{ops} operations</p></div>
  {:else if id === "track-steps"}
    <div class="vz-track">{#each STEPS as s, i}<div class="vz-st"><span class="vz-dot">{i + 1}</span><b>{s}</b></div>{/each}<i class="vz-rail"></i></div>
  {:else if id === "sentence-page"}
    <div class="vz-s2p"><div class="vz-card vz-bubble"><p class="vz-cap">YOU TYPE</p><p>A lease addendum for 12 Oak Street, $1,850 a month, starting 1 November.</p></div><span class="vz-arrow">→</span><div class="vz-paper"><p class="vz-cap">DOCUMENT</p><b>Lease addendum</b><i class="vz-l vz-w9"></i><i class="vz-l vz-w8"></i><i class="vz-l vz-w6"></i><span class="vz-fld">Landlord</span><span class="vz-fld">Tenant</span></div></div>
  {:else if id === "payment-card"}
    <div class="vz-pay"><div class="vz-card"><p class="vz-cap">PAYMENT FIELD</p><b class="vz-amt">$250.00</b><p class="vz-sm">Deposit, paid while signing</p><span class="vz-btn">Pay and continue</span></div><span class="vz-coin">$</span></div>
  {:else if id === "exploded"}
    <ExplodedScroll {area} fixed compact={size !== "hero"} />
  {:else if id === "node-flow"}
    <div class="vz-flow">{#each FLOW as [t, d], i}<div class="vz-node"><b>{t}</b><span>{d}</span></div>{#if i < FLOW.length - 1}<i class="vz-wire"></i>{/if}{/each}</div>
  {:else if id === "browser-embed"}
    <div class="vz-br"><div class="vz-tb"><i></i><i></i><i></i><span>yourproduct.com/onboarding</span></div><div class="vz-bd"><div class="vz-app"><i class="vz-l vz-w6"></i><i class="vz-l vz-w8"></i><i class="vz-l vz-w5"></i></div><div class="vz-sheet"><p class="vz-cap">SIGN</p><b>Welcome agreement</b><i class="vz-l vz-w9"></i><i class="vz-l vz-w7"></i><span class="vz-fld">Sign here</span></div></div></div>
  {:else if id === "browser-code"}
    <div class="vz-br"><div class="vz-tb"><i></i><i></i><i></i><span>your app</span></div><div class="vz-bd vz-col"><pre>{`<docustay-sign url="…">
</docustay-sign>
sign.addEventListener(
  "completed", done)`}</pre><div class="vz-sheet"><p class="vz-cap">SIGNING</p><span class="vz-fld">Sign here</span></div></div></div>
  {:else if id === "assistant-card"}
    <div class="vz-card vz-asst"><p class="vz-cap">ASSISTANT</p><p class="vz-me">Draft the NDA for Pat and put it in the queue.</p><p class="vz-bot">Drafted. It is waiting for a person to look at it.</p><span class="vz-pill">A person approves the send</span></div>
  {:else if id === "mcp-tools"}
    <div class="vz-card vz-list"><p class="vz-cap">MCP SERVER · 39 TOOLS</p>{#each ["list_documents", "get_document", "create_draft", "list_templates", "get_audit_log"] as t}<div class="vz-row"><span class="vz-mono">{t}</span></div>{/each}<p class="vz-sm">It cannot send or refund.</p></div>
  {:else if id === "whitelabel"}
    <div class="vz-card vz-wl"><div class="vz-logoslot">Your logo</div><b>Please sign your agreement</b><i class="vz-l vz-w9"></i><i class="vz-l vz-w7"></i><div class="vz-sw"><i style="background:#1f6feb"></i><i style="background:#0f9d58"></i><i style="background:#e0a23a"></i><i style="background:#c2410c"></i></div><span class="vz-btn">Finish and sign</span></div>
  {:else if id === "plays-fan"}
    <div class="vz-fan">{#each ["Onboarding", "Rental", "Waiver"] as t, i}<div class="vz-pc vz-c{i}"><p class="vz-cap">PLAYBOOK</p><b>{t}</b><i class="vz-l vz-w9"></i><i class="vz-l vz-w6"></i></div>{/each}</div>
  {:else if id === "dev-hub"}
    <div class="vz-card vz-code"><p class="vz-cap">SEND</p><pre><b>$</b> npx docustay send --test TEMPLATE_ID</pre></div><div class="vz-card vz-code vz-ok"><p class="vz-cap"><i class="vz-ok-dot"></i>201 CREATED</p><pre>{SEND_RESPONSE.replace("// 201 Created\n", "")}</pre></div>
  {:else if id === "quick-steps"}
    <div class="vz-card vz-list"><p class="vz-cap">QUICKSTART</p>{#each ["Make a test key", "Send a document", "Open the email, sign", "Read the signed copy"] as t, i}<div class="vz-row"><span class="vz-mono">{i + 1}</span><span>{t}</span></div>{/each}</div>
  {:else if id === "status-pulse"}
    <div class="vz-card vz-pulse"><p class="vz-cap">STATUS</p><svg viewBox="0 0 300 80" aria-hidden="true"><path d="M0 40 H90 L105 12 L125 68 L140 40 H300" fill="none" stroke="var(--ac)" stroke-width="3" stroke-linejoin="round" /></svg><p class="vz-sm">Live from the status page</p></div>
  {:else if id === "timeline"}
    <div class="vz-card vz-list vz-tl"><p class="vz-cap">CHANGELOG</p>{#each ["Fourteen languages", "Payments inside a document", "A new look", "Developers", "Security"] as t}<div class="vz-row"><i class="vz-dot2"></i><span>{t}</span></div>{/each}</div>
  {:else if id === "req-table"}
    <div class="vz-card"><p class="vz-cap">REQUIREMENTS</p><table><tbody><tr><th>Containers</th><td>6</td></tr><tr><th>Memory to run</th><td>about 1 GiB</td></tr><tr><th>Memory to build</th><td>more than 3.8 GB</td></tr><tr><th>Database</th><td>PostgreSQL 16</td></tr><tr><th>Needs</th><td>Docker and Compose</td></tr></tbody></table></div>
  {:else if id === "all-templates-grid"}
    <div class="vz-grid">{#each ["nda", "lease", "offer-letter", "contractor"] as n}<img src={`/screens/doc-${n}.png`} alt="" width="120" height="156" loading="lazy" />{/each}<p class="vz-big">More than 50</p></div>
  {:else if id === "docs-stack"}
    <div class="vz-grid">{#each ["nda", "lease", "offer-letter", "contractor"] as n, i}<img class="vz-st{i}" src={`/screens/doc-${n}.png`} alt="" width="120" height="156" loading="lazy" />{/each}</div>
  {:else if id === "test-toggle"}
    <div class="vz-card"><p class="vz-cap">TEST MODE</p><div class="vz-tog"><i></i><span>On</span></div><p class="vz-sm">Nothing reaches a real inbox. Documents are marked TEST.</p></div>
  {/if}
</div>
<style>
  .v { --tx: var(--tx-1, #f4f3fb); display: grid; gap: 12px; width: 340px; min-height: 280px; align-content: center; font-family: var(--f-ui, system-ui); color: var(--tx); } .v.hero { transform-origin: top left; }
  .vz-paper .vz-cap, .vz-signed .vz-cap, .vz-sheet .vz-cap, .vz-pc .vz-cap, .vz-pc .vz-fld, .vz-sheet .vz-fld { color: color-mix(in srgb, var(--ac) 42%, #15141c); }
  .vz-card { border: 1px solid var(--hairline); background: #ffffff; border-radius: 14px; padding: 14px 16px; box-shadow: 0 18px 40px -22px rgb(60 40 140 / 0.3); }
  .vz-cap { margin: 0 0 8px; font: 600 10.5px/1 var(--f-mono, monospace); letter-spacing: .1em; color: var(--ac); text-transform: uppercase; }
  pre { margin: 0; font: 400 11.5px/1.55 var(--f-mono, monospace); color: var(--tx-1); white-space: pre-wrap; overflow: hidden; } pre b { color: var(--ac); font-weight: 600; } .vz-dim { color: var(--tx-2); } .vz-g { color: #1c7448; font-weight: 500; }
  .vz-ok { border-color: color-mix(in srgb, var(--ac) 40%, transparent); } .vz-ok-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #5fd49a; margin-right: 7px; }
  .vz-term, .vz-br { border: 1px solid var(--hairline); border-radius: 12px; background: #ffffff; overflow: hidden; box-shadow: 0 18px 40px -22px rgb(60 40 140 / 0.3); } .vz-term pre { padding: 14px 16px; }
  .vz-tb { display: flex; align-items: center; gap: 6px; padding: 9px 12px; background: #ffffff; border-bottom: 1px solid var(--hairline); } .vz-tb i { width: 9px; height: 9px; border-radius: 50%; background: #3a3a4c; } .vz-tb span { margin-left: 8px; font: 500 11px var(--f-mono, monospace); color: var(--tx-2); }
  .vz-l { display: block; height: 6px; border-radius: 3px; background: #ece9f6; margin: 7px 0; } .vz-w9 { width: 90%; } .vz-w8 { width: 80%; } .vz-w7 { width: 70%; } .vz-w6 { width: 60%; } .vz-w5 { width: 50%; }
  .vz-docs { display: grid; grid-template-columns: 70px 1fr; gap: 14px; padding: 0; overflow: hidden; } .vz-docs .vz-side { background: #ffffff; padding: 14px 10px; } .vz-docs .vz-side i { display: block; height: 7px; border-radius: 3px; background: #ece9f6; margin: 10px 0; } .vz-docs .vz-side i.vz-on { background: var(--ac); } .vz-docs .vz-art { padding: 14px 14px 14px 0; } .vz-docs h5 { margin: 0 0 6px; font: 600 14px var(--f-ui); }
  .vz-list .vz-row { display: flex; gap: 12px; align-items: baseline; padding: 7px 0; border-top: 1px solid var(--hairline); font-size: 12.5px; color: var(--tx-1); } .vz-mono { font: 500 11px var(--f-mono, monospace); color: var(--ac); min-width: 62px; }
  .vz-signed { background: #fbfaf6; border-radius: 8px; padding: 14px; color: #17161f; } .vz-signed .vz-l { background: #d8d4c8; } .vz-sig { margin: 14px 0 0; font: italic 26px 'Instrument Serif', Georgia, serif; color: color-mix(in srgb, var(--ac) 42%, #15141c); } .vz-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; } .vz-chips span { padding: 4px 10px; border: 1px solid color-mix(in srgb, var(--ac) 50%, transparent); border-radius: 999px; font: 500 11px var(--f-mono, monospace); color: var(--tx-1); }
  .vz-big { margin: 10px 0 0; font: 600 26px/1 var(--f-ui); color: var(--ac); } .vz-sm { margin: 8px 0 0; font-size: 12px; color: var(--tx-2); }
  .vz-track { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px 10px; padding: 20px 6px; } .vz-track .vz-st { display: grid; gap: 8px; justify-items: center; position: relative; z-index: 1; } .vz-dot { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: #ffffff; border: 2px solid var(--ac); font: 600 13px var(--f-mono, monospace); } .vz-st b { font: 500 13px var(--f-ui); } .vz-rail { position: absolute; left: 12%; right: 12%; top: 37px; height: 2px; background: color-mix(in srgb, var(--ac) 40%, transparent); } .vz-rail ~ * { display: none; }
  .vz-s2p { display: grid; grid-template-columns: 1fr 24px 1fr; gap: 6px; align-items: center; } .vz-bubble p:last-child { margin: 0; font-size: 12.5px; line-height: 1.5; } .vz-arrow { color: var(--ac); font-size: 22px; text-align: center; }
  .vz-paper { background: #fbfaf6; color: #17161f; border-radius: 8px; padding: 12px; box-shadow: 0 14px 30px -18px rgb(60 40 140 / 0.3); } .vz-paper b { font: 650 14px var(--f-ui); } .vz-paper .vz-l { background: #d8d4c8; } .vz-fld { display: inline-block; margin: 6px 6px 0 0; padding: 4px 8px; border: 1.5px dashed var(--ac); border-radius: 4px; font: 500 10px var(--f-mono, monospace); color: color-mix(in srgb, var(--ac) 42%, #15141c); }
  .vz-pay { position: relative; } .vz-amt { display: block; font: 650 34px/1 var(--f-ui); margin: 4px 0; } .vz-btn { display: inline-block; margin-top: 12px; padding: 9px 16px; border-radius: 999px; background: var(--ac); color: #fff; font: 600 12.5px var(--f-ui); } .vz-coin { position: absolute; right: -6px; top: -18px; width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 35% 30%, #fff, var(--ac) 60%, #6a5bd0); color: #1a1240; font: 700 26px var(--f-ui); box-shadow: 0 10px 22px -8px rgb(60 40 140 / 0.3); }
  .vz-flow { display: grid; justify-items: center; gap: 0; } .vz-node { width: 230px; border: 1px solid var(--hairline); background: #ffffff; border-radius: 12px; padding: 10px 14px; box-shadow: 0 14px 30px -20px #000; } .vz-node b { display: block; font: 600 11px var(--f-mono, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--ac); } .vz-node span { font-size: 12.5px; color: var(--tx-2); } .vz-wire { width: 2px; height: 14px; background: color-mix(in srgb, var(--ac) 60%, transparent); }
  .vz-br .vz-bd { display: grid; grid-template-columns: 1fr 1.3fr; gap: 12px; padding: 14px; min-height: 170px; } .vz-br .vz-bd.vz-col { grid-template-columns: 1fr; } .vz-br .vz-app { background: #ffffff; border-radius: 8px; padding: 12px; } .vz-br .vz-sheet { background: #fbfaf6; color: #17161f; border-radius: 8px; padding: 12px; box-shadow: 0 10px 24px -14px #000; } .vz-br .vz-sheet .vz-l { background: #d8d4c8; } .vz-br .vz-sheet b { font: 650 13px var(--f-ui); }
  .vz-asst p { margin: 0 0 8px; font-size: 12.5px; line-height: 1.5; } .vz-asst .vz-me { background: #ece9f6; border-radius: 10px; padding: 8px 10px; } .vz-asst .vz-bot { color: var(--tx-1); } .vz-pill { display: inline-block; padding: 5px 12px; border-radius: 999px; background: color-mix(in srgb, var(--ac) 22%, transparent); border: 1px solid var(--ac); font: 500 11.5px var(--f-ui); }
  .vz-wl { text-align: center; } .vz-logoslot { width: 120px; margin: 0 auto 10px; padding: 8px; border: 1.5px dashed #5a5a72; border-radius: 8px; font: 500 11px var(--f-mono, monospace); color: var(--tx-2); } .vz-wl b { display: block; font: 650 15px var(--f-ui); margin-bottom: 6px; } .vz-sw { display: flex; justify-content: center; gap: 8px; margin: 12px 0 2px; } .vz-sw i { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgb(255 255 255 / .6); }
  .vz-fan { position: relative; height: 230px; } .vz-pc { position: absolute; top: 20px; left: 50%; width: 150px; margin-left: -75px; background: #fbfaf6; color: #17161f; border-radius: 10px; padding: 12px; box-shadow: 0 16px 30px -18px #000; transform-origin: 50% 120%; } .vz-pc .vz-l { background: #d8d4c8; } .vz-pc b { font: 650 14px var(--f-ui); } .vz-c0 { transform: rotate(-16deg) translateX(-34px); } .vz-c1 { transform: rotate(0); z-index: 2; } .vz-c2 { transform: rotate(16deg) translateX(34px); }
  .vz-pulse svg { width: 100%; height: 70px; display: block; } table { width: 100%; border-collapse: collapse; } th { text-align: left; font: 500 12px var(--f-ui); color: var(--tx-2); padding: 8px 0; border-top: 1px solid var(--hairline); } td { text-align: right; font: 600 13px var(--f-mono, monospace); padding: 8px 0; border-top: 1px solid var(--hairline); }
  .vz-tl .vz-dot2 { width: 9px; height: 9px; border-radius: 50%; background: var(--ac); flex: none; transform: translateY(2px); }
  .vz-grid { position: relative; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; } .vz-grid img { width: 100%; height: auto; border-radius: 6px; box-shadow: 0 12px 24px -14px #000; } .vz-grid .vz-big { position: absolute; right: 0; bottom: -6px; left: 0; text-align: center; margin: 0; text-shadow: 0 2px 12px #000; background: linear-gradient(transparent, #ffffff); padding-top: 22px; }
  .vz-tog { display: flex; align-items: center; gap: 12px; margin: 6px 0; } .vz-tog i { position: relative; width: 52px; height: 28px; border-radius: 999px; background: var(--ac); } .vz-tog i::after { content: ""; position: absolute; right: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; } .vz-tog span { font: 600 14px var(--f-ui); }
</style>
