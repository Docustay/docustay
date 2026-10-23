<script>
  // A built-in template as a tile (combined style): its first page on a backplate (a thumbnail is the only box), the title, a one-line description. Preview, Send and Customize show on hover and on focus
  // (always on a touch screen). Used by New document and Templates; `ids` keeps each screen's own data-testid values.
  import { t } from "$lib/i18n/index.svelte.js";
  import Thumbnail from "$lib/ui/Thumbnail.svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import TemplatePreview from "./TemplatePreview.svelte";
  // The Preview is ONE in-app print view for every template (TemplatePreview.svelte), opened by a link to this same page with ?preview=<slug>: it can be shared, Back closes it, and nothing leaves the app.
  let { s, mode = "document", using = null, onuse = () => {}, oncustomize = () => {}, width = 100, hasPicture = true, ids = {}, note = "", customize = null, class: cls = "" } = $props();
  const linkFor = (on) => { const u = new URL(page.url); if (on) u.searchParams.set("preview", s.slug); else u.searchParams.delete("preview"); return `${u.pathname}${u.search}`; };
  const previewHref = $derived(linkFor(true));
  const isOpen = $derived(page.url.searchParams.get("preview") === s.slug);
  const show = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); goto(previewHref, { noScroll: true, keepFocus: true }); };
  const hide = () => goto(linkFor(false), { noScroll: true, keepFocus: true, replaceState: true });
  let broken = $state(false);
</script>
<li class="tpl group relative min-w-0 {cls}" data-slug={s.slug} data-library-slug={s.slug} data-testid={ids.row}>
  <div class="plate-wrap">
  <a href={previewHref} onclick={show} tabindex="-1" aria-hidden="true" class="block no-underline" data-testid={ids.picture ?? "tile-picture"}>
    {#if !broken}<span class="grid place-items-center rounded py-3.5" style="background: var(--plate)"><img src={`/starters/${s.slug}/p1-sm.webp`} alt="" loading="lazy" width={width} height={Math.round(width * 76 / 60)} class="block border border-line-strong bg-white object-cover object-top" style="width:{width}px;height:{Math.round(width * 76 / 60)}px" onerror={() => (broken = true)} /></span>
    {:else}<Thumbnail {width} backplate class="w-full" />{/if}
  </a>
  <div class="tile-actions flex flex-wrap justify-center gap-1.5">
    <a class="btn" href={previewHref} onclick={show} data-testid={ids.preview ?? "tile-preview"} data-slug={s.slug}>{t("Preview")}</a>
    {#if mode !== "template"}<button class="btn primary" disabled={using !== null} onclick={() => onuse(s)} data-testid={ids.use ?? "tile-use"} data-slug={s.slug}>{t("Send")}</button>{/if}
    {#if mode !== "document"}{#if customize}{@render customize(s)}{:else}<button class="btn {mode === 'template' ? 'primary' : ''}" disabled={using !== null} onclick={() => oncustomize(s)} data-testid={ids.customize ?? "tile-customize"} data-slug={s.slug}>{t("Customize")}</button>{/if}{/if}
  </div>
  </div>
  <p class="mt-2 truncate text-[13px] font-medium text-ink">{s.title}</p>
  <p class="line-clamp-2 min-h-[2.4em] text-[12px] leading-[1.2em] text-mute">{s.summary}</p>
  {#if note}<p class="mt-0.5 text-[12px] text-brand" data-testid={ids.note}>{note}</p>{/if}
  {#if mode === "form"}<p class="mt-1 text-[12px] text-mute" data-testid={ids.facts ?? "tile-facts"}>{t("{n} fields", { n: s.fieldCount })}{s.counterSign ? ` · ${s.counterFields ? t("plus {n} for the team member", { n: s.counterFields }) : t("a team member counter-signs")}` : ""}</p>{/if}
  {#if isOpen}<TemplatePreview {s} onclose={hide} showSend={mode !== "template"} showCustomize={mode !== "document"} {onuse} {oncustomize} {customize} {using} />{/if}
</li>
<style>
  .plate-wrap { position: relative; }
  /* on a mouse the three actions float over the bottom of the picture on hover or focus; on a touch screen they sit under the text */
  .tile-actions { position: absolute; left: 4px; right: 4px; bottom: 6px; visibility: hidden; padding: 4px; border-radius: 6px; background: color-mix(in srgb, var(--card) 92%, transparent); }
  .tpl:hover .tile-actions, .tpl:focus-within .tile-actions { visibility: visible; }
  @media (hover: none) { .tile-actions { position: static; visibility: visible; margin-top: .5rem; padding: 0; background: none; justify-content: flex-start; } }
</style>
