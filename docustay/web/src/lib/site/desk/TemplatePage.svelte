<script>
  import { onMount } from "svelte";
  import { probablySignedIn } from "$lib/starter.js";
  import PageStack from "$lib/starters/PageStack.svelte";
  import DeskHead from "./DeskHead.svelte";
  import Sec from "./Sec.svelte";
  import Faq from "./Faq.svelte";
  import Closing from "./Closing.svelte";
  import StackMini from "./StackMini.svelte";
  import { feat } from "./feat.js";
  // One template page (T5): the paper stack is the hero, a facts panel beside it, then when to use it, what to check, three questions. Everything said about the template is its own; the numbers come from the starter data.
  let { t, m, use, related } = $props();
  let inApp = $state(false);
  onMount(() => { inApp = probablySignedIn(); });
  const useHref = $derived(inApp ? `/create/flow?mode=document&slug=${m.old}` : `/signup?starter=${m.old}`);
  const required = $derived(t.fields.filter((f) => f.required).length);
  const roles = $derived(t.seats.map((s) => s.role));
  const faq = $derived([
    ["Who fills in which part?", `${roles.join(" and ")} ${roles.length > 1 ? "each fill in and sign their own boxes" : "fills in and signs"}. The preview draws every box where it will sit on the page. {{F-SEND}}`],
    ["Can I change the wording?", "Yes. In your workspace it is your own copy. Change the text or the fields and save. The original is never changed. {{F-TEMPLATES}}"],
    ["Is this legal advice?", "No. It is a starting point in plain words. Change what does not fit before you send it. It makes no promise that it is enough for any place or any purpose."],
  ]);
  const phone = ["The signing page works on any phone, with no app and no account. {{F-SIGN}}", "Swipe through the pages in the preview above. The use button stays pinned to the bottom of the screen."];
  const keeps = ["One PDF with every signature, sealed so a later change shows. {{F-SEAL}}", "A certificate of completion on the last page. {{F-CERT}}", "The audit trail of every step, exportable as a CSV. {{F-AUDIT}}"];
  const closingTitle = $derived.by(() => { const base = m.title.replace(/ template$/i, ""); return `Send your ${/^[A-Z]{2,}/.test(base) ? base : base.charAt(0).toLowerCase() + base.slice(1)} today.`; });
  const crumbs = $derived([["Templates", "/document-templates"], [m.title, "/templates/" + m.slug]]);
</script>
<DeskHead title={m.seo} description={m.meta} crumbs={[["Docustay", "/"], ...crumbs]} />
<section class="d-wrap tp" data-page="/templates/{m.slug}" data-voice="V1" data-template="T5">
  <nav class="d-crumbs" aria-label="Breadcrumb"><a href="/">Docustay</a><span>/</span><a href="/document-templates">Templates</a><span>/</span><span>{m.title}</span></nav>
  <p class="d-eyebrow" style="margin-top:22px">TEMPLATE · {t.pages} {t.pages === 1 ? "PAGE" : "PAGES"}</p>
  <h1 class="d-h1 sm">{m.title}</h1>
  <p class="d-sub">{t.summary}</p>
  <div class="d-actions"><a class="d-btn main" href={useHref} data-testid="use-template" data-feature="F-TEMPLATES">{inApp ? "Use this template in your workspace" : "Use this template, free"}</a><a class="d-btn alt" href="/product/scribe" data-feature="F-SCRIBE">Change it with Scribe</a></div>
  <div class="tp-grid">
    <div class="tp-stack d-paper-card"><PageStack slug={m.old} title={t.title} pages={t.pages} fields={t.fields} seats={t.seats} />
      <p class="note">The tinted boxes are the fields people fill in, drawn where they sit on the page.</p></div>
    <aside aria-label="About this template">
      <dl class="facts" data-testid="template-details" data-feature="F-TEMPLATES"><dt>Pages</dt><dd>{t.pages}</dd><dt>Time to fill in</dt><dd>About {t.minutes} minutes</dd><dt>Who signs</dt><dd>{roles.join(", ")}</dd><dt>Fields</dt><dd>{t.fields.length} ({required} required)</dd><dt>Languages</dt><dd data-feature="F-LANG14">14 for the signer</dd><dt>Cost</dt><dd data-feature="F-FREEPLAN">Free to use; sending counts toward your 15 documents a month</dd><dt>Field colours</dt><dd class="swatch"><span class="sw a"></span>{roles[0]}{#if roles[1]}<span class="sw b"></span>{roles[1]}{/if}</dd><dt>Made for</dt><dd>{t.who}</dd></dl>
    </aside>
  </div>
</section>
<Sec eyebrow="When to use it" title="Use it when it fits." tight><div class="d-prose">{#each m.when as p}<p>{p}</p>{/each}</div></Sec>
<Sec eyebrow="Before you send" title="Three things to check." tight><ul class="chk">{#each m.check as c}<li>{c}</li>{/each}</ul><p class="d-fine" style="margin-top:18px">{t.note ?? "A starting point in plain words, not legal advice. Change anything that does not fit before you send it."}</p></Sec>
<Sec eyebrow="On a phone" title="Made to be signed on a phone." tight><ul class="chk">{#each phone as l}{@const x = feat(l)}<li data-feature={x.ids}>{x.text}</li>{/each}</ul></Sec>
<Sec eyebrow="What you keep" title="A sealed copy and its record." tight><ul class="chk">{#each keeps as l}{@const x = feat(l)}<li data-feature={x.ids}>{x.text}</li>{/each}</ul></Sec>
<Sec eyebrow="Read the words" title="The text of this document." tight><details class="txt" data-testid="template-text"><summary>Read the text of this document</summary><div lang="en">{t.text}</div></details></Sec>
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
{#if related.length}<Sec eyebrow="More like this" title="More for {use}." tight><div class="d-grid d-g3">{#each related as r}<StackMini t={r} />{/each}</div></Sec>{/if}
<Closing title={closingTitle} label="Use this template, free" href={useHref} keep={[["All templates", "/document-templates"], [use, "/use-cases/" + m.use], ["Scribe", "/product/scribe"]]} />
<style>
  .tp { padding-top: 56px; } .tp-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 34px; margin-top: 40px; align-items: start; } .tp-stack { padding: 22px; } .tp-stack :global(.count) { color: #4a4740; } .swatch { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; } .sw.a { background: #b9a9ff; } .sw.b { background: #a9d4ff; } .tp-stack .note { font-size: 13px; color: #6f6b63; margin: 12px 0 0; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 12px 22px; margin: 0; padding: 24px; border: 1px solid #2a2a2c; background: #131315; border-radius: 6px; position: sticky; top: 96px; } .facts dt { font: 500 11px/1.8 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #a8a39a; } .facts dd { margin: 0; color: #f4f2ec; font-size: 15px; line-height: 1.5; }
  .chk { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; max-width: 70ch; } .chk li { padding-left: 24px; position: relative; color: #e6e2d8; line-height: 1.55; } .chk li::before { content: ""; position: absolute; left: 0; top: .55em; width: 9px; height: 9px; border: 1.5px solid #8585fd; }
  .txt { border: 1px solid #2a2a2c; border-radius: 6px; padding: 16px 20px; background: #131315; } .txt summary { cursor: pointer; font-weight: 600; } .txt div { white-space: pre-wrap; margin-top: 14px; color: #c9c5bb; line-height: 1.65; font-size: 14.5px; max-height: 60vh; overflow: auto; }
  @media (max-width: 900px) { .tp-grid { grid-template-columns: 1fr; } .facts { position: static; } }
</style>
