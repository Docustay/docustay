<script>
  // Run 9 Part 4R (the maintainer, 12 Oct 2026) — THE BUILT-IN TEMPLATES on the Templates page, in the same two tabs as the workspace's own: Document templates and Form templates.
  // A built-in is a read-only master. Send (a document) or Publish (a form) uses it straight away, with no copy, so it never counts toward the monthly new templates;
  // Customize makes the workspace's own editable copy, which is a new template (Free: 5 a month; a member's waits for approval). A pack that is switched on puts its templates first.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import { TEMPLATE_CATEGORIES, FORM_TEMPLATE_CATEGORIES } from "$lib/flow/flowDefinition.js";
  import NewTemplateLock from "$lib/pro/NewTemplateLock.svelte";
  import FlowIcon from "$lib/flow/FlowIcon.svelte";
  let { kind = "document", q = "", highlight = null } = $props();
  let rows = $state(null), shown = $state(true), problem = $state(null), busy = $state(null), note = $state(null), first = $state(new Set());
  const CATS = $derived(kind === "form" ? FORM_TEMPLATE_CATEGORIES : TEMPLATE_CATEGORIES);
  const catOf = (s) => (kind === "form" ? s.use : TEMPLATE_CATEGORIES.find((c) => c.slugs.includes(s.slug))?.id ?? "business");
  let cat = $state("all");
  const words = $derived(q.trim().toLowerCase());
  const list = $derived((rows ?? []).filter((s) => (cat === "all" || catOf(s) === cat) && (!words || `${s.title} ${s.summary}`.toLowerCase().includes(words)))
    .sort((a, b) => Number(first.has(b.slug)) - Number(first.has(a.slug))));
  async function load() {
    rows = null; problem = null;
    /* R10-61: the list and the packs that put some templates first arrive together, so the rows are drawn once, in their final order (they used to be drawn, then re-sorted: a layout shift of 0.2-0.4) */
    const [r, p] = await Promise.all([api(`/api/documents/library?kind=${kind}`), api("/api/documents/plays")]); const d = r.json?.data ?? r.json;
    if (!r.ok) { problem = r.error ?? t("The built-in templates could not be loaded."); rows = []; return; }
    const pd = p.json?.data ?? p.json;
    if (p.ok) first = new Set((pd?.playbooks ?? []).filter((b) => b.enabled).flatMap((b) => b.templates ?? []).filter((x) => x.startsWith("builtin:")).map((x) => x.slice(8)));
    shown = d.shown !== false; rows = d.templates ?? [];
  }
  $effect(() => { kind; cat = "all"; load(); });
  $effect(() => { if (highlight && rows?.length) setTimeout(() => document.querySelector(`[data-library-slug="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50); });
  async function act(s, how) {
    busy = s.slug; note = null;
    const r = await api(how === "customize" ? "/api/documents/library/customize" : "/api/documents/library/use", { method: "POST", body: { slug: s.slug } });
    busy = null; const d = r.json?.data ?? r.json;
    if (!r.ok) { note = r.error ?? t("That template could not be used."); return; }
    if (how === "customize") await goto(`/create/flow?mode=${kind === "form" ? "form" : "template"}&template=${encodeURIComponent(d.templateId)}`);
    else if (d.kind === "form") await goto(`/forms?new=${encodeURIComponent(d.templateId)}`);
    else await goto(`/documents/${d.instanceId}/edit?from=template`);
  }
</script>
<section class="mt-8" aria-labelledby="lib-h" data-testid={`lib-${kind}`}>
  <div class="flex flex-wrap items-baseline gap-3"><h2 id="lib-h" class="text-lg font-semibold">{kind === "form" ? t("Built-in form templates") : t("Built-in document templates")}</h2>
    <p class="text-sm text-mute">{kind === "form" ? t("Publish one as it is, or customize your own copy.") : t("Send one as it is, or customize your own copy.")}</p></div>
  {#if !shown}<p class="mt-3 rounded-lg border border-dashed border-line p-6 text-center text-mute" data-testid="lib-hidden">{t("This workspace has hidden the built-in templates. An owner or admin can show them again in Settings → Templates.")}</p>
  {:else}
    <div class="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("Categories")}>
      <button class="chip !min-h-9 {cat === 'all' ? '!bg-tint font-semibold' : ''}" aria-pressed={cat === "all"} onclick={() => (cat = "all")} data-testid="lib-cat-all">{t("All")}</button>
      {#each CATS as c (c.id)}<button class="chip !min-h-9 {cat === c.id ? '!bg-tint font-semibold' : ''}" aria-pressed={cat === c.id} onclick={() => (cat = c.id)} data-testid={`lib-cat-${c.id}`}>{tl(c.label)}</button>{/each}
    </div>
    {#if problem}<p class="notice warn mt-3" role="alert">{problem}</p>
    {:else if rows === null}<div class="mt-3 grid gap-2" aria-busy="true" role="status" data-testid="lib-loading">{#each [0, 1, 2] as i (i)}<div class="skel h-10 rounded-xl"></div>{/each}<span class="sr-only">{t("Loading…")}</span></div>
    {:else if !list.length}<div class="mt-3 rounded-lg border border-dashed border-line p-6 text-center text-mute" data-testid="lib-empty">{t("No built-in template matches that search.")} <button class="text-brand underline" onclick={() => (cat = "all")}>{t("Clear filters")}</button></div>
    {:else}
      <div class="mt-3 overflow-x-auto rounded-xl border border-line"><table class="w-full min-w-[560px] text-left text-[14px]" data-testid="lib-table">
        <thead class="bg-tint text-xs uppercase tracking-wide text-mute"><tr><th class="h-9 px-4">{t("Template")}</th><th class="px-4">{kind === "form" ? t("Who fills it in") : t("Who signs")}</th><th class="px-4"><span class="sr-only">{t("Actions")}</span></th></tr></thead>
        <tbody>{#each list as s (s.slug)}
          <tr class="h-10 border-t border-line {highlight === s.slug ? 'bg-tint' : ''}" data-testid="lib-row" data-library-slug={s.slug}>
            <td class="px-4 py-2"><span class="font-medium">{s.title}</span>{#if first.has(s.slug)}<span class="chip ml-2 !text-xs" data-testid="lib-in-pack">{t("In a pack")}</span>{/if}<span class="mt-0.5 block text-xs text-mute">{s.summary}</span></td>
            <td class="px-4 py-2 text-mute">{(s.seats ?? []).join(", ")}</td>
            <td class="whitespace-nowrap px-4 py-2 text-right">
              <a class="btn !py-1.5" href={kind === "form" ? `/form-templates/${s.slug}` : `/starters/${s.slug}/p1-lg.webp`} target="_blank" rel="noopener" data-testid="lib-preview"><FlowIcon name="eye" size={16} /> {t("Preview")}</a>
              <button class="btn primary !py-1.5" disabled={busy !== null} onclick={() => act(s, "use")} data-testid="lib-use" data-slug={s.slug}>{kind === "form" ? t("Publish") : t("Send")}</button>
              <NewTemplateLock testid="prolock-customize">{#snippet children(locked)}<button class="btn !py-1.5" disabled={locked || busy !== null} onclick={() => act(s, "customize")} data-testid="lib-customize" data-slug={s.slug}>{t("Customize")}</button>{/snippet}</NewTemplateLock>
            </td></tr>{/each}</tbody></table></div>
    {/if}
    {#if note}<p class="notice warn mt-3 text-sm" role="alert" data-testid="lib-note">{note}</p>{/if}
  {/if}
</section>
