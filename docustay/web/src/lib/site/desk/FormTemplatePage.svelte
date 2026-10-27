<script>
  import { onMount } from "svelte";
  import { probablySignedIn } from "$lib/starter.js";
  import DeskHead from "./DeskHead.svelte";
  import Sec from "./Sec.svelte";
  import Faq from "./Faq.svelte";
  import Closing from "./Closing.svelte";
  import FormCard from "./FormCard.svelte";
  import PageStack from "$lib/starters/PageStack.svelte";
  import CodeWindow from "../ui/CodeWindow.svelte";
  import { formWord } from "../pages/formTemplates.js";
  // One of the thirty short templates (registrations, applications, requests, sign-ins): an ordinary template, sent to the people you name. Every word about the template is its own; the sections and fields come from the product's own parser.
  let { f, cat, related } = $props();
  let inApp = $state(false);
  onMount(() => { inApp = probablySignedIn(); });
  const useHref = $derived(inApp ? `/create/flow?mode=document&slug=${f.slug}` : `/signup?starter=${f.slug}`);
  const filler = $derived(f.roles[0]), counter = $derived(f.roles[1] ?? null);
  const name = $derived(formWord(f.title).toLowerCase().replace(/ form$/, ""));
  // a template whose text touches medical or health matters says plainly what Docustay is not for (the same sentence as the Trust page)
  const health = $derived(/medical|health|injur|patient/i.test(JSON.stringify(f)));
  const faq = $derived([
    ["Who fills it in?", `The person you send it to. They are the ${filler.toLowerCase()} in this template: they type their own name and email, fill in each box and sign.${counter ? ` Then the ${counter.toLowerCase()} you choose on your team adds a decision and counter-signs.` : ""} {{F-SEND}}`],
    ["Can I send it to many people at once?", "Yes. Send to a list sends your own copy to each person on it, and each person signs their own copy. {{F-BULK}}"],
    ["Can I change the questions?", "Yes. In your workspace it is your own copy: add, remove or reword any field, then send it. The original is never changed. {{F-TEMPLATES}}"],
    ["Can people attach files?", `${f.fieldCount} fields make up the ${name} template. Where it has a file box, people may attach a PDF or a picture, and it is stored exactly as they upload it and never converted.`],
    ["Is this legal advice?", `No. The ${name} template is a starting point in plain words. Change what does not fit before you send it.`],
  ]);
</script>
<DeskHead title={`${formWord(f.title)} template, free`} description={`A free ${name} template. ${f.summary.replace(/\.$/, "")}. Send it to the people you name; each person fills it in, signs, and you keep the sealed copy.`.slice(0, 300)} crumbs={[["Docustay", "/"], ["Templates", "/free-templates"], [f.title, "/templates/" + f.slug]]} />
<div class="phw">
<section class="d-wrap tp" data-page="/templates/{f.slug}" data-voice="V1" data-template="T5">
  <nav class="d-crumbs" aria-label="Breadcrumb"><a href="/">Docustay</a><span>/</span><a href="/free-templates">Templates</a><span>/</span><span>{f.title}</span></nav>
  <p class="d-eyebrow" style="margin-top:22px">TEMPLATE · {cat}</p>
  <h1 class="d-h1 sm">{f.title}</h1>
  <p class="d-sub">{f.summary}</p>
  {#if health}<p class="d-fine" data-testid="phi-note" style="margin-top:10px">Docustay is not for protected health information yet. Do not collect it with this template.</p>{/if}
  <div class="d-actions"><a class="d-btn main" href={useHref} data-testid="use-template" data-feature="F-TEMPLATES">{inApp ? "Use this template in your workspace" : "Use this template, free"}</a><a class="d-btn alt" href="/features/scribe" data-feature="F-SCRIBE">Change it with Scribe</a></div>
  <div class="tp-grid">
    <div class="sheet" data-testid="template-fields">
      <p class="intro">{f.intro}</p>
      {#each f.sections as s}<h2>{s.heading}</h2><ul>{#each s.fields as x}<li><span class="l">{x.label}</span><span class="t">{x.type}{x.required ? "" : ", optional"}{x.role !== filler ? ` · ${x.role}` : ""}</span>{#if x.options}<span class="o">{x.options.join(" · ")}</span>{/if}{#if x.help}<span class="h">{x.help}</span>{/if}</li>{/each}</ul>{/each}
    </div>
    <aside aria-label="About this template">
      <dl class="facts" data-testid="template-details" data-feature="F-TEMPLATES"><dt>Purpose</dt><dd>{f.purpose}</dd><dt>Made for</dt><dd>{f.who}</dd><dt>Who signs</dt><dd>{filler}, the person you send it to</dd>{#if counter}<dt>Counter-signs</dt><dd>{counter}, on your team</dd>{/if}<dt>Fields</dt><dd>{f.fieldCount} ({f.required} required){#if f.counterFields} · plus {f.counterFields} for the team member{/if}</dd><dt>Time to fill in</dt><dd>About {f.minutes} minutes</dd><dt>Cost</dt><dd data-feature="F-FREEPLAN">Free to use; a document counts when it is sent</dd></dl>
    {#if f.consent.length}<div class="side2"><p class="d-eyebrow">What people agree to</p><h3 class="d-h3">The wording beside each box.</h3><ul class="chk">{#each f.consent as c}<li>{c}</li>{/each}</ul></div>{/if}
    </aside>
  </div>
</section></div>
<Sec eyebrow="What people see" title="The template, the way the person you send it to fills it in." tight><div class="pvgrid"><div class="pv d-paper-card"><PageStack slug={f.slug} title={f.title} pages={f.pages} fields={f.pageFields} seats={f.seats} eager={2} /></div><div class="pvside"><p class="d-eyebrow">In this template</p><h3 class="d-h3">What is on the page.</h3><ul class="chk">{#each f.sections as sc}<li>{sc.heading}: {sc.fields.length} {sc.fields.length === 1 ? "field" : "fields"}</li>{/each}</ul><p class="d-fine" style="margin-top:18px">It is your own copy in your workspace. Change any of it before you send.</p></div></div></Sec>
<Sec eyebrow="Send it from code" title="Send the {name} template from your own code." tight><p class="d-sub" style="max-width:62ch" data-feature="F-API">Make your own copy once, then send it to the person you name. A test key sends only to you.</p><div class="cwrap"><CodeWindow tabs={[{ label: "CLI", code: `npx docustay templates customize ${f.slug} --name "${f.title}"\n# prints the new template's id; then send it as a test:\nnpx docustay send --test $DOCUSTAY_TEMPLATE_ID --party 'signer=Name <email>'` }, { label: "cURL", code: `curl -X POST "$DOCUSTAY_URL/api/v1/documents/send" \\\n  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"templateId":"$DOCUSTAY_TEMPLATE_ID","parties":[{"seat":"signer","name":"Name","email":"name@example.com"}]}'` }]} title="send-{f.slug}" page="template" label="Language" /></div></Sec>
<Sec eyebrow="What you keep" title="A sealed copy and its record." tight><div class="keep"><p class="d-sub" style="max-width:56ch" data-feature="F-SEAL">Each person who signs gets the sealed PDF with a certificate of completion, and so do you. Search them in your workspace and read each one by its own record.</p></div></Sec>
<Sec eyebrow="Questions" title="Quick answers." tight><Faq items={faq} /></Sec>
{#if related.length}<Sec eyebrow="More like this" title="More {cat.toLowerCase()} templates." tight><div class="d-grid d-g3">{#each related as r}<FormCard t={r} level={3} />{/each}</div></Sec>{/if}
<Closing title={`Send your ${name} today.`} label="Use this template, free" href={useHref} keep={[["All templates", "/free-templates"], ["Scribe", "/features/scribe"], ["Pricing", "/pricing"]]} />
<style>
  .phw { position: relative; isolation: isolate; } .phw > :global(.bd) { z-index: -1; -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent); mask-image: linear-gradient(to bottom, #000 55%, transparent); }
  .keep { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 36px; align-items: center; } @media (max-width: 900px) { .keep { grid-template-columns: minmax(0, 1fr); } }
  .tp.d-wrap { padding-top: 110px; } .tp-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 34px; margin-top: 40px; align-items: start; }
  .sheet { background: #faf8f3; color: #1b1b1b; border-radius: 6px; padding: 28px; } .sheet .intro { margin: 0 0 8px; color: #4a4740; line-height: 1.55; } .sheet h2 { font: 600 15px/1.3 var(--font-sans); margin: 22px 0 8px; } .sheet ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .sheet li { display: grid; gap: 2px; border-bottom: 1px solid #e6e1d6; padding-bottom: 8px; } .sheet .l { font-weight: 600; font-size: 14.5px; } .sheet .t { font: 500 12px/1.4 var(--font-mono); color: #5a564e; } .sheet .o, .sheet .h { font-size: 13px; color: #5a564e; line-height: 1.45; }
  .facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px 22px; margin: 0; padding: 24px; border: 1px solid var(--hairline); background: #ffffff; border-radius: 6px; position: sticky; top: 96px; } .facts dt { font: 500 11px/1.8 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--tx-3); } .facts dd { margin: 0; color: var(--tx-1); font-size: 15px; line-height: 1.5; }
  .chk { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; max-width: 70ch; } .chk li { padding-left: 24px; position: relative; color: var(--tx-1); line-height: 1.55; } .chk li::before { content: ""; position: absolute; left: 0; top: .55em; width: 9px; height: 9px; border: 1.5px solid var(--d-accent, rgb(90 58 193 / 0.5)); }
  aside { display: grid; gap: 18px; align-content: start; position: sticky; top: 96px; } aside .facts { position: static; } .side2 { padding: 24px; border: 1px solid var(--ln-2); border-radius: 18px; background: #ffffff; display: grid; gap: 12px; }
  .pvgrid { display: grid; grid-template-columns: minmax(0, 640px) minmax(0, 1fr); gap: 40px; align-items: start; } .pvside { position: sticky; top: 96px; padding: 24px; border: 1px solid var(--ln-2); border-radius: 18px; background: #ffffff; display: grid; gap: 14px; } .pv { max-width: 640px; } @media (max-width: 1000px) { .pvgrid { grid-template-columns: minmax(0, 1fr); } .pvside { position: static; } } @media (max-width: 900px) { aside { position: static; } } .cwrap { max-width: 860px; margin-top: 22px; }
  @media (min-width: 1100px) { .sheet ul { grid-template-columns: repeat(2, minmax(0, 1fr)); gap-column: 18px; column-gap: 22px; } }
  @media (max-width: 900px) { .tp-grid { grid-template-columns: minmax(0, 1fr); } .facts { position: static; } .sheet { padding: 20px; } }
</style>
