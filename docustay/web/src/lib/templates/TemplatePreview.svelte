<script>
  // THE ONE PREVIEW for every built-in template, document or form (V1 redo, 20 Oct 2026): a full-screen print view. Every page is a paper sheet you scroll, each field is marked in its person's colour,
  // and Send and Customize sit in the header. It opens in the app (no new tab), closes with Esc, the Close button or the browser's Back, and its address (?preview=<slug>) is a link you can share.
  // The pages are the pictures of the printed form, made at build time from the PDF the product itself prints for the template (the same path that makes the real document), and the field map beside them:
  // static files, so opening a Preview renders nothing and asks the database nothing.
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import Icon from "$lib/ui/Icon.svelte";
  let { s, onclose = () => {}, showSend = false, showCustomize = false, onuse = () => {}, oncustomize = () => {}, customize = null, using = null } = $props();
  let dlg = $state(null), meta = $state(null), failed = $state(false), fields = $state(true), scroller = $state(null);
  const HUES = [265, 205, 150, 25];
  const seatIndex = (role) => Math.max(0, (meta?.roles ?? []).findIndex((r) => r.key === role));
  const fieldsOn = (n) => (meta?.fields ?? []).filter((f) => f.page === n);
  onMount(() => {
    dlg?.showModal();
    scroller?.focus();
    fetch(`/starters/${encodeURIComponent(s.slug)}/meta.json`).then((r) => (r.ok ? r.json() : Promise.reject())).then((m) => (meta = m)).catch(() => (failed = true));
    return () => { try { dlg?.close(); } catch { /* already closed */ } };
  });
  const seats = $derived((meta?.roles ?? []).map((r) => r.label));
</script>
<dialog bind:this={dlg} class="pv" aria-labelledby="pv-title" oncancel={(e) => { e.preventDefault(); onclose(); }} onclose={() => onclose()} data-testid="template-preview" data-slug={s.slug}>
  <header class="pv-head">
    <div class="min-w-0">
      <h2 id="pv-title" class="truncate text-[17px] font-semibold">{s.title}</h2>
      <p class="truncate text-[12px] text-mute" data-testid="pv-facts">{#if meta}{t("{n, plural, one {# page} other {# pages}}", { n: meta.pages })} · {t("{n, plural, one {# field} other {# fields}}", { n: meta.fields.length })}{#if seats.length}{" · "}{seats.join(", ")}{/if}{:else if s.summary}{s.summary}{/if}</p>
    </div>
    <div class="pv-actions">
      <label class="pv-toggle"><input type="checkbox" bind:checked={fields} data-testid="pv-fields" />{t("Show fields")}</label>
      {#if showSend}<button type="button" class="btn primary" disabled={using !== null} onclick={() => onuse(s)} data-testid="pv-send">{t("Send")}</button>{/if}
      {#if showCustomize}{#if customize}{@render customize(s)}{:else}<button type="button" class="btn" disabled={using !== null} onclick={() => oncustomize(s)} data-testid="pv-customize">{t("Customize")}</button>{/if}{/if}
      <button type="button" class="btn quiet" onclick={() => onclose()} aria-label={t("Close")} data-testid="pv-close"><Icon name="x" size={18} /></button>
    </div>
  </header>
  <div class="pv-body" bind:this={scroller} tabindex="0" role="region" aria-label={t("Pages of {title}", { title: s.title })}>
    {#if failed}<p class="notice warn mx-auto mt-10 max-w-md" role="alert" data-testid="pv-failed">{t("This preview could not be loaded. Try again in a moment.")}</p>
    {:else if !meta}<div class="pv-sheet pv-skel" aria-busy="true" role="status"><span class="sr-only">{t("Loading…")}</span></div>
    {:else}
      {#if s.summary}<p class="pv-summary">{s.summary}</p>{/if}
      {#each Array.from({ length: meta.pages }, (_, i) => i + 1) as n (n)}
        <figure class="pv-sheet" data-page={n} aria-label={t("Page {page} of {total}", { page: n, total: meta.pages })}>
          <picture>
            <source type="image/webp" srcset="/starters/{s.slug}/p{n}-sm.webp 440w, /starters/{s.slug}/p{n}-lg.webp 1000w" sizes="(min-width: 900px) 760px, 94vw" />
            <img src="/starters/{s.slug}/p{n}-lg.jpg" width="1000" height="1294" loading={n <= 2 ? "eager" : "lazy"} decoding="async" alt={t("Page {page} of {total} of {title}", { page: n, total: meta.pages, title: s.title })} />
          </picture>
          {#if fields}
            <div class="pv-fields" aria-hidden="true">
              {#each fieldsOn(n) as f (f.id)}<span class="pv-f" class:sig={f.type === "signature" || f.type === "initials"} style="left:{f.x * 100}%; top:{f.y * 100}%; width:{f.w * 100}%; height:{f.h * 100}%; --h:{HUES[seatIndex(f.role) % 4]}" title={f.label}><span class="pv-fl">{f.label}</span></span>{/each}
            </div>
          {/if}
          <figcaption class="pv-cap">{t("Page {page} of {total}", { page: n, total: meta.pages })}</figcaption>
        </figure>
      {/each}
      {#if seats.length && fields}<ul class="pv-legend" aria-label={t("Who fills what")}>{#each meta.roles as r, i (r.key)}<li><i style="background: hsl({HUES[i % 4]} 70% 55%)"></i>{r.label}</li>{/each}</ul>{/if}
    {/if}
  </div>
</dialog>
<style>
  .pv { position: fixed; inset: 0; width: 100vw; max-width: none; height: 100dvh; max-height: none; margin: 0; padding: 0; border: 0; background: var(--plate, #f1f1f6); color: var(--ink); display: none; flex-direction: column; }
  .pv[open] { display: flex; }
  .pv::backdrop { background: rgb(0 0 0 / .4); }
  .pv-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1rem; padding: .7rem 1rem; background: var(--card); border-bottom: 1px solid var(--line); }
  .pv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .pv-toggle { display: inline-flex; align-items: center; gap: .4rem; font-size: 13px; color: var(--mute); margin-right: .25rem; }
  .pv-body { flex: 1; overflow-y: auto; padding: 1.25rem 1rem 3rem; outline: none; }
  .pv-summary { max-width: 760px; margin: 0 auto 1rem; font-size: 13px; color: var(--mute); }
  .pv-sheet { position: relative; width: min(100%, 760px); margin: 0 auto 1.25rem; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .12), 0 8px 24px rgb(0 0 0 / .1); }
  .pv-sheet img { display: block; width: 100%; height: auto; }
  .pv-skel { aspect-ratio: 1000 / 1294; background: linear-gradient(90deg, #fff, #f4f3fb, #fff); }
  .pv-cap { position: absolute; right: 0; bottom: -1.1rem; font-size: 11px; color: var(--mute); }
  .pv-fields { position: absolute; inset: 0; pointer-events: none; }
  .pv-f { position: absolute; border: 1.5px solid hsl(var(--h) 70% 50%); background: hsl(var(--h) 80% 55% / .14); border-radius: 2px; }
  .pv-f.sig { background: hsl(var(--h) 80% 55% / .22); }
  .pv-fl { position: absolute; left: 1px; top: 1px; max-width: calc(100% - 2px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; line-height: 1.25; padding: 0 3px; color: #fff; background: hsl(var(--h) 60% 42% / .92); border-radius: 2px; }
  .pv-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: .25rem 1rem; list-style: none; margin: 0 auto; padding: 0; font-size: 12px; color: var(--mute); }
  .pv-legend i { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; margin-right: .35rem; vertical-align: -1px; }
</style>
