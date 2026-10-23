<script>
  // The API reference (frame: Docs, API reference): every operation as a section with its method pill, endpoint pill, parameter rows and answers; a sticky 400px column on the right shows the request in eight languages and the Response for the operation in view.
  import { onMount } from "svelte";
  import MethodPill from "$lib/site/MethodPill.svelte";
  import ParamRow from "$lib/site/ParamRow.svelte";
  import CodePanel from "$lib/site/CodePanel.svelte";
  import CopyPage from "$lib/site/CopyPage.svelte";
  import { inline } from "$lib/docs/inline.js";
  import { page } from "$app/state";
  let { data } = $props();
  const all = $derived(data.groups.flatMap((g) => g.items));
  let active = $state(null), cache = $state({}), open = $state({});
  const first = () => data.groups[0]?.items[0]?.id;
  const ensure = async (id) => { if (!id || cache[id]) return; try { cache[id] = await (await fetch(`/docs/api-reference/ops/${id}.json`)).json(); } catch { /* the words are still there */ } };
  $effect(() => { const id = active ?? first(); ensure(id); });
  onMount(() => {
    active = (location.hash || "").slice(1) || first();
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) active = v.target.id; }, { rootMargin: "-80px 0px -60% 0px" });
    document.querySelectorAll("[data-op]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
  const cur = $derived(cache[active ?? first()]);
</script>
<svelte:head><title>API reference · Docs · Docustay</title><meta name="description" content="Every operation of the Docustay API: parameters, request bodies, answers and examples in eight languages. Generated from the OpenAPI file." /></svelte:head>
<div class="mb-8 flex flex-wrap items-start justify-between gap-4"><div><p class="font-mono text-[12px] uppercase tracking-wider text-faint">API Reference</p><h1 class="mt-2 text-[34px] font-semibold leading-tight tracking-tight">API reference</h1><p class="mt-2 max-w-2xl text-[16px] text-mute">Generated from the OpenAPI 3.1 file{data.version ? ` (version ${data.version})` : ""}. Every request needs <code>Authorization: Bearer $DOCUSTAY_API_KEY</code>; writes take an <code>Idempotency-Key</code>. <a data-sveltekit-reload class="underline" href="/api/openapi.json">Download openapi.json</a>.</p></div><CopyPage markdown="" url="https://docustay.app/docs/api-reference" /></div>
<div class="grid gap-10 xl:grid-cols-[minmax(0,1fr)_400px]">
  <div class="min-w-0">
    {#each data.groups as g}
      <h2 class="mb-4 mt-10 text-[22px] font-semibold tracking-tight first:mt-0" id="tag-{g.tag.toLowerCase()}">{g.tag}</h2>
      {#each g.items as o (o.id)}
        <section id={o.id} data-op class="scroll-mt-24 border-t border-line py-8" data-testid="api-op">
          <h3 class="text-[20px] font-semibold">{o.summary || o.path}</h3>
          <div class="mt-3 flex flex-wrap items-center gap-2"><MethodPill method={o.method} /><code class="rounded-full border border-line bg-[var(--sidebar)] px-3 py-1 font-mono text-[13px]">{o.path}</code></div>
          {#if o.description}<p class="mt-4 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-text-2">{@html inline(o.description)}</p>{/if}
          {#if o.params.length}<h4 class="mt-6 font-mono text-[11px] uppercase tracking-wider text-faint">Parameters</h4><div class="mt-1">{#each o.params as p}<ParamRow name={p.name} type="{p.type} · {p.in}" required={p.required}>{@html inline(p.description)}</ParamRow>{/each}</div>{/if}
          {#if o.body.length}<h4 class="mt-6 font-mono text-[11px] uppercase tracking-wider text-faint">Request body (JSON)</h4><div class="mt-1">{#each o.body as p}<ParamRow name={p.name} type={p.type} required={p.required}>{@html inline(p.description)}</ParamRow>{/each}</div>{/if}
          <h4 class="mt-6 font-mono text-[11px] uppercase tracking-wider text-faint">Answers</h4>
          <ul class="mt-2 grid gap-1.5 text-[14px]">{#each o.responses as r}<li class="flex gap-3"><code class="w-10 shrink-0 font-mono {r.code.startsWith('2') ? 'text-ok' : 'text-mute'}">{r.code}</code><span class="text-text-2">{@html inline(r.description)}</span></li>{/each}</ul>
          <details class="mt-5 xl:hidden" ontoggle={(e) => { if (e.currentTarget.open) { open[o.id] = true; ensure(o.id); } }}><summary class="cursor-pointer text-[14px] font-medium">Show the request</summary>{#if open[o.id] && cache[o.id]}<div class="mt-3"><CodePanel languages={cache[o.id].languages} response={cache[o.id].response} title="{o.method} {o.path}" /></div>{/if}</details>
        </section>
      {/each}
    {/each}
  </div>
  <div class="hidden xl:block"><div class="sticky top-24" data-testid="api-panel">
    {#if cur}<CodePanel languages={cur.languages} response={cur.response} title={(() => { const o = all.find((x) => x.id === (active ?? first())); return o ? `${o.method} ${o.path}` : "Request"; })()} />{:else}<p class="rounded-[14px] border border-line p-4 text-[13.5px] text-mute">Loading the examples…</p>{/if}
  </div></div>
</div>
<style>
  :global([data-op] p code, [data-op] li code, [data-op] span code) { font-family: var(--font-mono); font-size: .88em; background: var(--tint); padding: 1px 5px; border-radius: 5px; }
  /* the eight language tabs scroll inside the 400px column instead of running past the card (they are drawn by the shared Tabs component) */
  :global([data-testid="code-panel"] .justify-between > :first-child) { min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  :global([data-testid="code-panel"] [role="tablist"]) { flex-wrap: nowrap; }
</style>
