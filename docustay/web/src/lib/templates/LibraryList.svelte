<script>
  // Run 9 Part 4R (the maintainer, 12 Oct 2026) — THE BUILT-IN TEMPLATES on the Templates page (Docustay v1: one list; the thirty former form templates are ordinary templates).
  // A built-in is a read-only master. Send uses it straight away, with no copy, so it never counts toward the monthly new templates;
  // Customize makes the workspace's own editable copy, which is a new template (Free: 5 a month; a member's waits for approval). A pack that is switched on puts its templates first.
  import { handleRefusal } from "$lib/pro/planPrompt.svelte.js";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import { TEMPLATE_CATEGORIES, FORM_TEMPLATE_CATEGORIES } from "$lib/flow/flowDefinition.js";
  import NewTemplateLock from "$lib/pro/NewTemplateLock.svelte";
  import TemplateTile from "./TemplateTile.svelte";
  let { q = "", highlight = null, onloaded = () => {} } = $props();
  let rows = $state(null), shown = $state(true), problem = $state(null), busy = $state(null), note = $state(null), first = $state(new Set());
  const CATS = [...TEMPLATE_CATEGORIES, ...FORM_TEMPLATE_CATEGORIES.filter((c) => !TEMPLATE_CATEGORIES.some((d) => d.id === c.id))];
  const catOf = (s) => TEMPLATE_CATEGORIES.find((c) => c.slugs.includes(s.slug))?.id ?? (FORM_TEMPLATE_CATEGORIES.some((c) => c.id === s.use) ? s.use : "business");
  let cat = $state("all");
  const words = $derived(q.trim().toLowerCase());
  const list = $derived((rows ?? []).filter((s) => (cat === "all" || catOf(s) === cat) && (!words || `${s.title} ${s.summary}`.toLowerCase().includes(words)))
    .sort((a, b) => Number(first.has(b.slug)) - Number(first.has(a.slug))));
  async function load() {
    rows = null; problem = null;
    /* R10-61: the list and the packs that put some templates first arrive together, so the rows are drawn once, in their final order (they used to be drawn, then re-sorted: a layout shift of 0.2-0.4) */
    const [r, p] = await Promise.all([api("/api/documents/library"), api("/api/documents/plays")]); const d = r.json?.data ?? r.json;
    if (!r.ok) { problem = r.error ?? t("The built-in templates could not be loaded."); rows = []; return; }
    const pd = p.json?.data ?? p.json;
    if (p.ok) first = new Set((pd?.playbooks ?? []).filter((b) => b.enabled).flatMap((b) => b.templates ?? []).filter((x) => x.startsWith("builtin:")).map((x) => x.slice(8)));
    shown = d.shown !== false; rows = d.templates ?? []; onloaded(shown ? rows.length : 0);
  }
  $effect(() => { cat = "all"; load(); });
  $effect(() => { if (highlight && rows?.length) setTimeout(() => document.querySelector(`[data-library-slug="${CSS.escape(highlight)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50); });
  async function act(s, how) {
    busy = s.slug; note = null;
    const r = await api(how === "customize" ? "/api/documents/library/customize" : "/api/documents/library/use", { method: "POST", body: { slug: s.slug } });
    busy = null; const d = r.json?.data ?? r.json;
    if (!r.ok) { if (await handleRefusal(r, { action: "create_template" })) return; note = r.error ?? t("That template could not be used."); return; }
    if (how === "customize") await goto(`/create/flow?mode=template&template=${encodeURIComponent(d.templateId)}`);
    else await goto(`/documents/${d.instanceId}/edit?from=template`);
  }
</script>
<section aria-labelledby="lib-h" data-testid="lib-document">
  <h2 id="lib-h" class="sr-only">{t("Built-in templates")}</h2>
  {#if !shown}<p class="mt-3 border-t border-dashed border-line pt-6 text-center text-mute" data-testid="lib-hidden">{t("This workspace has hidden the built-in templates. An owner or admin can show them again in Settings → Templates.")}</p>
  {:else}
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" role="group" aria-label={t("Categories")}>
      <button class="min-h-7 min-w-6 text-mute hover:text-ink aria-pressed:font-semibold aria-pressed:text-ink" aria-pressed={cat === "all"} onclick={() => (cat = "all")} data-testid="lib-cat-all">{t("All")}</button>
      {#each CATS as c (c.id)}<button class="min-h-7 min-w-6 text-mute hover:text-ink aria-pressed:font-semibold aria-pressed:text-ink" aria-pressed={cat === c.id} onclick={() => (cat = c.id)} data-testid={`lib-cat-${c.id}`}>{tl(c.label)}</button>{/each}
    </div>
    {#if problem}<p class="notice warn mt-3" role="alert">{problem}</p>
    {:else if rows === null}<div class="pg-gallery mt-4" style="--tile: 168px" aria-busy="true" role="status" data-testid="lib-loading">{#each [0, 1, 2, 3, 4] as i (i)}<div class="skel h-40 rounded"></div>{/each}<span class="sr-only">{t("Loading…")}</span></div>
    {:else if !list.length}<div class="mt-4 text-[13px] text-mute" data-testid="lib-empty">{t("No built-in template matches that search.")} <button class="text-link underline" onclick={() => (cat = "all")}>{t("Clear filters")}</button></div>
    {:else}
      <ul class="pg-gallery mt-4" style="--tile: 168px; --tile-gap-y: 1.5rem" data-testid="lib-table">{#each list as s (s.slug)}
        <TemplateTile {s} mode="library" using={busy} width={112} hasPicture={TEMPLATE_CATEGORIES.some((c) => c.slugs.includes(s.slug))} note={first.has(s.slug) ? t("In a pack") : ""} class={highlight === s.slug ? "rounded bg-tint" : ""}
          ids={{ row: "lib-row", preview: "lib-preview", use: "lib-use", note: "lib-in-pack", picture: "lib-picture" }} onuse={(x) => act(x, "use")}>
          {#snippet customize(x)}<NewTemplateLock testid="prolock-customize">{#snippet children(locked)}<button class="btn" disabled={locked || busy !== null} onclick={() => act(x, "customize")} data-testid="lib-customize" data-slug={x.slug}>{t("Customize")}</button>{/snippet}</NewTemplateLock>{/snippet}
        </TemplateTile>{/each}</ul>
    {/if}
    {#if note}<p class="notice warn mt-3 text-sm" role="alert" data-testid="lib-note">{note}</p>{/if}
  {/if}
</section>
