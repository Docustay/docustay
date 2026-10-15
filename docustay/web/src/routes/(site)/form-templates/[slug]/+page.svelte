<script>
  import { onMount } from "svelte";
  import { probablySignedIn } from "$lib/starter.js";
  import DeskHead from "$lib/site/desk/DeskHead.svelte";
  import Sec from "$lib/site/desk/Sec.svelte";
  import Faq from "$lib/site/desk/Faq.svelte";
  import Closing from "$lib/site/desk/Closing.svelte";
  import FormCard from "$lib/site/desk/FormCard.svelte";
  import FormPreview from "$lib/site/desk/FormPreview.svelte";
  // One form template page: who it is for, every section and field (from the product's own parser), the default Publish options, then questions. Every word about the form is its own.
  let { data } = $props();
  const f = $derived(data.f);
  let inApp = $state(false);
  onMount(() => { inApp = probablySignedIn(); });
  const useHref = $derived(inApp ? `/create/flow?mode=form&slug=${f.slug}` : `/signup?starter=${f.slug}`);
  const filler = $derived(f.roles[0]), counter = $derived(f.roles[1] ?? null);
  const faq = $derived([
    ["Who fills it in?", `Anyone with the link. They are the ${filler.toLowerCase()} in this form, type their own name and email, fill in each box and sign.${counter ? ` Then the ${counter.toLowerCase()} you choose on your team adds a decision and counter-signs.` : ""}`],
    ["Can I change the questions?", "Yes. In your workspace it is your own copy: add, remove or reword any field, then publish it. The original is never changed."],
    ["Can people attach files?", "Where the form has a file box, people may attach a PDF or a picture. It is stored exactly as they upload it and never converted."],
    ["Is this legal advice?", "No. It is a starting point in plain words. Change what does not fit before you publish it."],
  ]);
</script>
<DeskHead title={`${f.title} form template, free`} description={data.meta} crumbs={[["Docustay", "/"], ["Form templates", "/form-templates"], [f.title, "/form-templates/" + f.slug]]} />
<section class="d-wrap tp" data-page="/form-templates/{f.slug}" data-voice="V1" data-template="T5">
  <nav class="d-crumbs" aria-label="Breadcrumb"><a href="/">Docustay</a><span>/</span><a href="/form-templates">Form templates</a><span>/</span><span>{f.title}</span></nav>
  <p class="d-eyebrow" style="margin-top:22px">FORM TEMPLATE · {data.cat}</p>
  <h1 class="d-h1 sm">{f.title}</h1>
  <p class="d-sub">{f.summary}</p>
  <div class="d-actions"><a class="d-btn main" href={useHref} data-testid="use-form-template">{inApp ? "Use this form in your workspace" : "Use this form, free"}</a></div>
  <div class="tp-grid">
    <div class="sheet" data-testid="form-template-fields">
      <p class="intro">{f.intro}</p>
      {#each f.sections as s}<h2>{s.heading}</h2><ul>{#each s.fields as x}<li><span class="l">{x.label}</span><span class="t">{x.type}{x.required ? "" : ", optional"}{x.role !== filler ? ` · ${x.role}` : ""}</span>{#if x.options}<span class="o">{x.options.join(" · ")}</span>{/if}{#if x.help}<span class="h">{x.help}</span>{/if}</li>{/each}</ul>{/each}
    </div>
    <aside aria-label="About this form template">
      <dl class="facts"><dt>Purpose</dt><dd>{f.purpose}</dd><dt>Made for</dt><dd>{f.who}</dd><dt>Fills it in</dt><dd>Anyone with the link ({filler})</dd>{#if counter}<dt>Counter-signs</dt><dd>{counter}, on your team</dd>{/if}<dt>Fields</dt><dd>{f.fieldCount} ({f.required} required){#if f.counterFields} · plus {f.counterFields} for the team member{/if}</dd><dt>Time to fill in</dt><dd>About {f.minutes} minutes</dd><dt>Cost</dt><dd>Free to use; each response counts as one document</dd></dl>
    </aside>
  </div>
</section>
<Sec eyebrow="What people see" title="The form, the way the person with the link fills it in." tight><div class="pv"><FormPreview {f} /></div></Sec>
{#if f.consent.length}<Sec eyebrow="What people agree to" title="The wording beside each box." tight><ul class="chk">{#each f.consent as c}<li>{c}</li>{/each}</ul></Sec>{/if}
<Sec eyebrow="When you publish" title="It starts with these settings." tight><ul class="chk" data-testid="form-template-publish">{#each data.publish as l}<li>{l}</li>{/each}</ul><p class="d-fine" style="margin-top:18px">Change any of them on the Publish step before the link goes live.</p></Sec>
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
{#if data.related.length}<Sec eyebrow="More like this" title="More {data.cat.toLowerCase()} forms." tight><div class="d-grid d-g3">{#each data.related as r}<FormCard t={r} level={3} />{/each}</div></Sec>{/if}
<Closing title={`Publish your ${f.title.toLowerCase()} form today.`} label="Use this form, free" href={useHref} keep={[["All form templates", "/form-templates"], ["Document templates", "/document-templates"], ["Pricing", "/pricing"]]} />
<style>
  .tp { padding-top: 56px; } .tp-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 34px; margin-top: 40px; align-items: start; }
  .sheet { background: #faf8f3; color: #1b1b1b; border-radius: 6px; padding: 28px; } .sheet .intro { margin: 0 0 8px; color: #4a4740; line-height: 1.55; } .sheet h2 { font: 600 15px/1.3 var(--font-sans); margin: 22px 0 8px; } .sheet ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .sheet li { display: grid; gap: 2px; border-bottom: 1px solid #e6e1d6; padding-bottom: 8px; } .sheet .l { font-weight: 600; font-size: 14.5px; } .sheet .t { font: 500 12px/1.4 var(--font-mono); color: #5a564e; } .sheet .o, .sheet .h { font-size: 13px; color: #5a564e; line-height: 1.45; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 12px 22px; margin: 0; padding: 24px; border: 1px solid #2a2a2c; background: #131315; border-radius: 6px; position: sticky; top: 96px; } .facts dt { font: 500 11px/1.8 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #a8a39a; } .facts dd { margin: 0; color: #f4f2ec; font-size: 15px; line-height: 1.5; }
  .chk { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; max-width: 70ch; } .chk li { padding-left: 24px; position: relative; color: #e6e2d8; line-height: 1.55; } .chk li::before { content: ""; position: absolute; left: 0; top: .55em; width: 9px; height: 9px; border: 1.5px solid var(--d-accent, #8b7cf6); }
  .pv { max-width: 640px; }
  @media (max-width: 900px) { .tp-grid { grid-template-columns: 1fr; } .facts { position: static; } .sheet { padding: 20px; } }
</style>
