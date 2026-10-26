<script>
  import { cardTable } from "../../ui/cardTable.js";
  import Sec from "./Sec.svelte";
  import Figure from "./Figure.svelte";
  import Flow from "./Flow.svelte";
  import Cols3 from "./Cols3.svelte";
  import Limits from "./Limits.svelte";
  import Spec from "./Spec.svelte";
  import Faq from "./Faq.svelte";
  import CodeWin from "./CodeWin.svelte";
  import Sheet from "./Sheet.svelte";
  import Anatomy3D from "./Anatomy3D.svelte";
  import SealCoin from "./SealCoin.svelte";
  import HashChain from "./HashChain.svelte";
  import Ledger from "./Ledger.svelte";
  import Tree from "./Tree.svelte";
  import SiteIcon from "./SiteIcon.svelte";
  import StackMini from "./StackMini.svelte";
  import Screen from "./Screen.svelte";
  import Story from "./Story.svelte";
  import Scene3D from "./Scene3D.svelte";
  import Console from "./Console.svelte";
  import DocFields from "./DocFields.svelte";
  import { feat } from "./feat.js";
  // Renders a page's blocks in order. Every block type is a figure or a layout from the Desk kit; the page data says which and with what words. A capability sentence ends with {{F-ID}}.
  let { blocks, templates = [] } = $props();
  const T = (slug) => templates.find((t) => t.slug === slug);
</script>
{#each blocks as b}
  {#if b.t === "cols"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight={b.tight ?? true}><Cols3 cols={b.cols.map((c) => { const f = feat(c.p); return { h: c.h, p: f.text, feature: f.ids }; })} /></Sec>
  {:else if b.t === "flow"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><Figure caption={b.caption} note={b.note ?? ""}><Flow nodes={b.nodes} vertical={b.vertical} dims={b.dims ?? true} keep={b.keep} />{#if b.foot}<p class="fig-note" style="margin-top:22px">{b.foot}</p>{/if}</Figure></Sec>
  {:else if b.t === "flows"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><div class="d-grid d-g2">{#each b.items as f}<Figure caption={f.caption} note={f.note ?? ""}><Flow nodes={f.nodes} vertical={f.vertical ?? true} dims={false} />{#if f.foot}<p class="fig-note" style="margin-top:18px">{f.foot}</p>{/if}</Figure>{/each}</div></Sec>
  {:else if b.t === "people"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><div class={b.pairs ? "d-grid d-g2" : ""}>{#each (b.pairs ?? [b]) as f}<Figure caption={f.caption} note={f.note ?? ""}><ol class="ppl" aria-label={f.caption}>{#each f.people as pe, i}<li class={pe.red ? "red" : ""}><span class="av" aria-hidden="true">{pe.name.slice(0, 1)}</span><b>{pe.name}</b><i>{pe.state}</i></li>{#if i < f.people.length - 1}<li class="ln" aria-hidden="true"></li>{/if}{/each}</ol>{#if f.foot}<p class="fig-note" style="margin-top:20px">{f.foot}</p>{/if}</Figure>{/each}</div></Sec>
  {:else if b.t === "timeline"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><Figure caption={b.caption}><ol class="tl" style="--n:{b.items.length}">{#each b.items as it}<li class={it.red ? "red" : ""}><i></i><b>{it.d}</b><span>{it.l}</span></li>{/each}</ol></Figure></Sec>
  {:else if b.t === "twofig"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><div class="d-grid d-g2">{#each [b.a, b.b] as f}<Figure caption={f.caption}><ul class="kv">{#each f.rows as [k, v]}{@const x = feat(v)}<li data-feature={x.ids}><b>{k}</b><span>{x.text}</span></li>{/each}</ul>{#if f.note}<p class="fig-note" style="margin-top:14px">{f.note}</p>{/if}</Figure>{/each}</div></Sec>
  {:else if b.t === "split"}
    <Sec id={b.id} tight>
      <div class="d-split" class:rev={b.rev}>
        <div><p class="d-eyebrow">{b.eyebrow}</p><h2 class="d-h2">{b.h2}</h2><p class="d-sub">{feat(b.sub).text}</p>{#if b.points}<ul class="pts">{#each b.points as p}{@const x = feat(p)}<li data-feature={x.ids}>{x.text}</li>{/each}</ul>{/if}{#if b.actions}<div class="d-actions">{#each b.actions as [l, h, k]}<a class="d-btn {k ?? 'alt'}" href={h}>{l}</a>{/each}</div>{/if}</div>
        <div class="sp-art">{#if b.sheets}<div class="sheets">{#each b.sheets as s}<Sheet {s} />{/each}</div>{:else if b.code}<CodeWin tabs={b.code.tabs} response={b.code.response} />{:else if b.fig}<Figure caption={b.fig.caption}><Flow nodes={b.fig.nodes} vertical dims={false} /></Figure>{/if}</div>
      </div>
    </Sec>
  {:else if b.t === "code"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><CodeWin tabs={b.tabs} response={b.response} responseLabel={b.responseLabel} />{#if b.after}{@const x = feat(b.after)}<p class="after" data-feature={x.ids}>{x.text}</p>{/if}</Sec>
  {:else if b.t === "limits"}
    <Sec id={b.id} eyebrow={b.eyebrow ?? "Limits"} title={b.h2} tight><Limits items={b.items} /></Sec>
  {:else if b.t === "spec"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><Spec rows={b.rows} /></Sec>
  {:else if b.t === "prose"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} tight><div class="d-prose">{#each b.paras ?? [] as p}{@const x = feat(p)}<p data-feature={x.ids}>{x.text}</p>{/each}{#if b.list}<ul>{#each b.list as l}{@const x = feat(l)}<li data-feature={x.ids}>{x.text}</li>{/each}</ul>{/if}</div></Sec>
  {:else if b.t === "cards"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><div class="d-grid {b.cols === 4 ? 'd-g4' : b.cols === 2 ? 'd-g2' : 'd-g3'}">{#each b.items as c}{@const x = feat(c.p)}<div class="d-paper-card" data-feature={x.ids}>{#if c.icon}<SiteIcon name={c.icon} size={26} />{/if}{#if c.n}<p class="cn">{c.n}</p>{/if}<h3 class="d-h3" style="margin-top:12px;color:#1b1b1b">{c.h}</h3><p class="cp">{x.text}</p>{#if c.href}<a class="cl" href={c.href}>{c.link ?? "Read more"} →</a>{/if}</div>{/each}</div></Sec>
  {:else if b.t === "tiles"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><div class="d-grid d-g3">{#each b.items as c}<a class="tile" href={c.href} data-feature={c.feature}>{#if c.icon}<SiteIcon name={c.icon} size={24} />{/if}<b>{c.h}</b><span>{c.p}</span></a>{/each}</div></Sec>
  {:else if b.t === "steps"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><div class="d-grid d-g3">{#each b.items as c, i}{@const x = feat(c.p)}<div class="d-paper-card" style="transform:rotate({[-1.2, .8, -.6][i % 3]}deg)" data-feature={x.ids}><p class="cn">{i + 1} / {b.items.length}</p><h3 class="d-h3" style="margin-top:10px;color:#1b1b1b">{c.h}</h3><p class="cp">{x.text}</p></div>{/each}</div></Sec>
  {:else if b.t === "templates"}
    <Sec id={b.id} eyebrow={b.eyebrow ?? "Templates"} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><div class="d-grid d-g3">{#each b.slugs as s}{#if T(s)}<StackMini t={T(s)} />{/if}{/each}</div></Sec>
  {:else if b.t === "anatomy"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><Figure caption={b.caption ?? "FIG. · THE ANATOMY OF A SIGNED DOCUMENT"}><Anatomy3D /></Figure></Sec>
  {:else if b.t === "hashchain"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><Figure caption="FIG. · CHANGE ONE LETTER" note="LIVE SHA-256 IN YOUR BROWSER"><HashChain /></Figure></Sec>
  {:else if b.t === "ledger"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><Figure caption="LIVE EVENTS" note="SAMPLE EVENTS FOR ILLUSTRATION"><Ledger /></Figure></Sec>
  {:else if b.t === "tree"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight><Figure caption="FIG. 01 · WHICH LICENCE FITS"><Tree selfPro={b.selfPro} commercial={b.commercial} /></Figure></Sec>
  {:else if b.t === "coin"}
    <Sec id={b.id} tight><SealCoin /></Sec>
  {:else if b.t === "screen" || b.t === "scene"}
    <Sec id={b.id} tight>
      <div class="d-split" class:rev={b.rev}>
        <div><p class="d-eyebrow">{b.eyebrow}</p><h2 class="d-h2">{b.h2}</h2><p class="d-sub" data-feature={feat(b.sub).ids}>{feat(b.sub).text}</p>
          {#if b.notes}<dl class="nts">{#each b.notes as [h, p]}{@const x = feat(p)}<div data-feature={x.ids}><dt>{h}</dt><dd>{x.text}</dd></div>{/each}</dl>{/if}
          {#if b.actions}<div class="d-actions" style="margin-top:22px">{#each b.actions as [l, h, k]}<a class="d-btn {k ?? 'alt'}" href={h}>{l}</a>{/each}</div>{/if}</div>
        <div class="sp-art"><Figure caption={b.caption} note={b.note ?? (b.t === "scene" ? "ILLUSTRATION" : "SAMPLE DATA")}>{#if b.t === "screen"}<Screen kind={b.kind} form={b.form} pay={b.pay} />{:else}<Scene3D kind={b.kind} />{/if}</Figure></div>
      </div>
    </Sec>
  {:else if b.t === "story"}
    <Story {b} />
  {:else if b.t === "console"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight>
      <div class="d-split" class:rev={b.rev}><div>{#if b.notes}<dl class="nts">{#each b.notes as [h, p]}{@const x = feat(p)}<div data-feature={x.ids}><dt>{h}</dt><dd>{x.text}</dd></div>{/each}</dl>{/if}</div><Console lines={b.lines} title={b.title ?? "terminal"} /></div>
    </Sec>
  {:else if b.t === "matrix"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight>
      <Figure caption={b.caption ?? "FIG. · REFERENCE"}><div class="mx" tabindex="0" role="region" aria-label={b.h2}><table use:cardTable><thead><tr>{#each b.head as h}<th scope="col">{h}</th>{/each}</tr></thead><tbody>{#each b.rows as r}<tr>{#each r as c, i}{@const x = feat(String(c))}{#if i === 0}<th scope="row" data-feature={x.ids}>{x.text}</th>{:else}<td data-feature={x.ids}>{x.text}</td>{/if}{/each}</tr>{/each}</tbody></table></div>{#if b.foot}<p class="fig-note" style="margin-top:12px">{feat(b.foot).text}</p>{/if}</Figure>
    </Sec>
  {:else if b.t === "strip"}
    <Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight>
      <ul class="strip">{#each b.items as [big, label, sub]}{@const x = feat(sub ?? "")}<li data-feature={x.ids}><b>{big}</b><span>{label}</span>{#if sub}<small>{x.text}</small>{/if}</li>{/each}</ul>
    </Sec>
  {:else if b.t === "docfields"}
    <Sec id={b.id} tight>
      <div class="d-split" class:rev={b.rev}>
        <div><p class="d-eyebrow">{b.eyebrow}</p><h2 class="d-h2">{b.h2}</h2><p class="d-sub" data-feature={feat(b.sub).ids}>{feat(b.sub).text}</p>
          {#if b.notes}<dl class="nts">{#each b.notes as [h, p]}{@const x = feat(p)}<div data-feature={x.ids}><dt>{h}</dt><dd>{x.text}</dd></div>{/each}</dl>{/if}
          {#if T(b.slug)}<div class="d-actions" style="margin-top:22px"><a class="d-btn alt" href="/templates/{b.slug}">Open this template</a></div>{/if}</div>
        <div class="sp-art">{#if T(b.slug)}<Figure caption={b.caption ?? "FIG. · THE REAL FIRST PAGE, WITH ITS FIELDS"} note="FROM THE TEMPLATE ITSELF"><DocFields starter={T(b.slug).starter} title={T(b.slug).title} fields={T(b.slug).fields} /></Figure>{/if}</div>
      </div>
    </Sec>
  {:else if b.t === "faq"}
    <Sec id={b.id} eyebrow={b.eyebrow ?? "Questions"} title={b.h2 ?? "Quick answers."} tight><Faq items={b.items} /></Sec>
  {/if}
{/each}
<style>
  .ppl { list-style: none; margin: 0; padding: 18px 8px 4px; display: flex; align-items: center; gap: 0; flex-wrap: wrap; justify-content: center; } .ppl li:not(.ln) { display: grid; justify-items: center; gap: 6px; min-width: 96px; } .ppl .ln { width: 44px; border-top: 1.2px dashed rgb(76 74 94 / .5); margin: 0 4px 26px; }
  .ppl .av { width: 54px; height: 54px; border-radius: 50%; border: 1.2px solid rgb(244 242 236 / .78); display: grid; place-items: center; font: 600 20px/1 var(--font-sans); background: rgb(22 22 29 / 0.03); } .ppl b { font: 600 17px/1.2 var(--font-sans); } .ppl i { font: 500 10px/1.4 var(--font-mono); letter-spacing: .08em; color: var(--tx-3); font-style: normal; text-transform: uppercase; }
  .ppl li.red .av { border-color: rgb(90 58 193 / 0.5); background: rgb(90 58 193 / 0.05); } .ppl li.red b { color: var(--v-700); }
  .tl { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 0; position: relative; } .tl li { position: relative; padding: 34px 12px 0 0; } .tl li::before { content: ""; position: absolute; left: 0; right: 0; top: 9px; border-top: 1.2px dashed rgb(76 74 94 / .5); } .tl i { position: absolute; left: 0; top: 3px; width: 13px; height: 13px; border: 1.2px solid #f4f2ec; background: #ffffff; } .tl li.red i { background: #8585fd; border-color: rgb(90 58 193 / 0.5); } .tl b { display: block; font: 600 18px/1.2 var(--font-sans); } .tl span { display: block; font: 500 11px/1.5 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tx-3); margin-top: 4px; } .tl li.red b { color: var(--v-700); }
  @media (max-width: 700px) { .tl { grid-template-columns: minmax(0, 1fr); gap: 14px; } .tl li { padding: 0 0 0 26px; } .tl li::before { top: 0; bottom: -14px; left: 6px; right: auto; border-top: 0; border-left: 1.2px dashed rgb(76 74 94 / .5); } .tl i { top: 3px; } }
  .kv { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; } .kv li { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 14px; padding: 11px 0; border-top: 1px solid var(--hairline); font-size: 15px; line-height: 1.5; } .kv li:first-child { border-top: 0; } .kv b { font: 500 11px/1.6 var(--font-mono); letter-spacing: .1em; color: var(--tx-3); text-transform: uppercase; } .kv span { overflow-wrap: anywhere; min-width: 0; color: var(--tx-1); } @media (max-width: 600px) { .kv li { grid-template-columns: minmax(0, 1fr); gap: 3px; } }
  .rev .sp-art { order: -1; } @media (max-width: 900px) { .rev .sp-art { order: 0; } }
  .pts { margin: 20px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; } .pts li { padding-left: 22px; position: relative; color: var(--tx-3); line-height: 1.55; } .pts li::before { content: ""; position: absolute; left: 0; top: .6em; width: 8px; height: 8px; background: #8585fd; }
  .sheets { display: grid; gap: 18px; justify-items: center; } .sp-art :global(.paper) { max-width: 360px; width: 100%; }
  .cn { font: 500 11px/1 var(--font-mono); letter-spacing: .12em; color: #6f6b63; margin: 14px 0 0; } .cp { color: #4a4740; line-height: 1.6; margin: 10px 0 0; font-size: 15.5px; } .cl { display: inline-block; margin-top: 14px; color: #1b1b1b; font-weight: 600; font-size: 14px; text-decoration: underline; text-underline-offset: 3px; }
  .tile { display: grid; gap: 8px; align-content: start; border: 1px solid var(--hairline); background: #ffffff; padding: 20px; border-radius: 6px; text-decoration: none; color: var(--tx-1); transition: border-color .15s, transform .15s; } .tile:hover { border-color: rgb(90 58 193 / 0.5); transform: translateY(-3px); } .tile b { font: 600 18px/1.2 var(--font-sans); letter-spacing: -.02em; } .tile span { color: var(--tx-3); font-size: 14.5px; line-height: 1.5; }
  .after { margin: 16px 0 0; color: var(--tx-3); font-size: 14.5px; line-height: 1.6; max-width: 70ch; }
  .nts { margin: 22px 0 0; display: grid; gap: 0; } .nts > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 14px; padding: 12px 0; border-top: 1px solid var(--hairline); } .nts dt { font: 600 14px/1.45 var(--font-sans); color: var(--tx-1); } .nts dd { margin: 0; color: var(--tx-3); line-height: 1.55; font-size: 15px; }
  .mx { overflow-x: auto; } .mx table { width: 100%; border-collapse: collapse; font-size: 14px; } .mx th, .mx td { text-align: left; padding: 11px 14px 11px 0; border-top: 1px solid var(--hairline); vertical-align: top; line-height: 1.5; } .mx thead th { font: 500 11px var(--font-mono); letter-spacing: .12em; color: var(--tx-3); border-top: 0; text-transform: uppercase; } .mx tbody th { font: 500 13px var(--font-mono); color: var(--tx-1); white-space: nowrap; } .mx td { color: var(--tx-3); }
  .strip { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); border: 1px solid var(--hairline); border-radius: 6px; } .strip li { padding: 22px 22px 20px; display: grid; gap: 4px; border-left: 1px solid var(--hairline); } .strip li:first-child { border-left: 0; } .strip b { font: 600 clamp(28px, 4vw, 40px)/1.05 var(--font-sans); letter-spacing: -.03em; } .strip span { color: var(--tx-2); font-size: 14.5px; } .strip small { color: var(--tx-3); font-size: 12.5px; line-height: 1.45; }
  @media (max-width: 700px) { .nts > div { grid-template-columns: minmax(0, 1fr); gap: 4px; } .strip li { border-left: 0; border-top: 1px solid var(--hairline); } .strip li:first-child { border-top: 0; } }
  @media (max-width: 640px) { .mx { overflow-x: visible; } .mx table, .mx tbody { display: block; } .mx thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } .mx tr { display: block; padding: 10px 0; border-top: 1px solid var(--hairline); } .mx th, .mx td { border-top: 0; padding: 3px 0; } .mx tbody th { display: block; white-space: normal; } .mx td { display: flex; gap: 12px; justify-content: space-between; overflow-wrap: anywhere; } .mx td::before { content: attr(data-label); flex: none; max-width: 40%; font: 500 11px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); } }
</style>
