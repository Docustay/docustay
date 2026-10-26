<script>
  // A document shown as a stack of paper sheets you can turn through (Part 31 follow-up). The sheets are the real printed pages (static/starters/<slug>/p<n>-*.webp, built from the PDF the product itself prints),
  // with each field's rectangle drawn over its page from the template's real field map. Own CSS 3D, transform and opacity only: no layout shift, 3 KB, no library (StPageFlip is a two-page book viewer, ~28 KB gzip).
  // Keyboard: the stage takes focus; Left/Right turn. Touch: swipe or drag the top sheet. prefers-reduced-motion: a crossfade, no 3D turn. "Open full size" uses a native <dialog> (Escape leaves it).
  import { t } from "$lib/i18n/index.svelte.js";
  let { slug, title, pages, fields = [], seats = [], showFields = true, sizes = "(min-width: 1024px) 560px, 92vw", eager = 1 } = $props();
  let cur = $state(0), busy = false, stage = $state(null), full = $state(null), overlay = $state(true), drag = $state(null);
  const n = $derived(pages);
  const src = (i, size, ext) => `/starters/${slug}/p${i + 1}-${size}.${ext}`;
  const ANGLE = [0, 1.7, -2.1, 2.6, -1.9];
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const near = (i) => i >= cur - 1 && i <= cur + 2;
  const seatIndex = (role) => Math.max(0, seats.findIndex((s) => s.role === role));
  const SEAT_HUES = [265, 205, 150, 25];
  const sheetEls = [];
  const rest = (i, dragging) => {
    const d = i - cur;
    if (dragging && d === 0 && n > 1) return `transform: translate3d(${Math.min(0, dragging.x) * 0.1}px, 0, 0) rotateY(${Math.max(-60, Math.min(0, dragging.x * 0.35))}deg); z-index: 50;`;
    if (d < 0) return "transform: translate3d(-4%, 0, 0) rotateY(-100deg); opacity: 0; pointer-events: none;";
    const k = Math.min(d, 4);
    return `transform: translate3d(${k * 7}px, ${k * 6}px, 0) rotate(${ANGLE[k]}deg); opacity: ${d > 3 ? 0 : 1}; z-index: ${50 - d};`;
  };
  async function go(dir) {
    if (busy) return;
    const to = cur + dir; if (to < 0 || to >= n) return;
    busy = true;
    const el = sheetEls[dir > 0 ? cur : to];
    if (dir < 0) cur = to;               // coming back: the previous sheet is the one that moves, so it becomes the top first
    if (el) {
      const shade = el.querySelector(".shade");
      if (reduced()) {
        await el.animate([{ opacity: dir > 0 ? 1 : 0 }, { opacity: dir > 0 ? 0 : 1 }], { duration: 220, easing: "ease", fill: "both" }).finished.catch(() => {});
      } else {
        const turn = [{ transform: "translate3d(0,0,0) rotateY(0deg)", opacity: 1 }, { transform: "translate3d(-2%,0,0) rotateY(-62deg)", opacity: 1, offset: 0.55 }, { transform: "translate3d(-4%,0,0) rotateY(-100deg)", opacity: 0 }];
        const opts = { duration: 620, easing: "cubic-bezier(.45,.05,.25,1)", fill: "both", direction: dir > 0 ? "normal" : "reverse" };
        shade?.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.55 }, { opacity: 0.9 }], opts);
        await el.animate(turn, opts).finished.catch(() => {});
      }
      if (dir > 0) cur = to;
      el.getAnimations().forEach((a) => a.cancel()); shade?.getAnimations().forEach((a) => a.cancel());
    } else if (dir > 0) cur = to;
    busy = false;
  }
  function key(e) { if (e.key === "ArrowRight") { e.preventDefault(); go(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); } }
  let startX = 0;
  function down(e) { if (e.pointerType === "mouse" && e.button !== 0) return; startX = e.clientX; drag = { x: 0 }; stage?.setPointerCapture?.(e.pointerId); }
  function move(e) { if (!drag) return; drag = { x: e.clientX - startX }; }
  function up() { if (!drag) return; const dx = drag.x; drag = null; if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1); }
  const open = (i = cur) => { cur = Math.min(Math.max(i, 0), n - 1); full?.showModal(); };
  const fieldsOn = (i) => fields.filter((f) => f.page === i + 1);
  const fieldClass = (f) => `fld fld-${f.type}`;
</script>

<section class="viewer" aria-label={t("Pages of {title}", { title })}>
  <div class="stage-wrap">
    <div class="stage" bind:this={stage} tabindex="0" role="group" aria-roledescription={t("page viewer")} aria-label={t("{title}, page {page} of {total}. Use the left and right arrow keys to turn pages.", { title, page: cur + 1, total: n })}
      onkeydown={key} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} data-testid="page-stack">
      <ol class="sheets">
        {#each Array(n) as _, i}
          <li class="sheet" class:top={i === cur} style={rest(i, drag)} bind:this={sheetEls[i]} aria-label={t("Page {page} of {total}", { page: i + 1, total: n })} data-page={i + 1}>
            {#if near(i)}
              <picture>
                <source type="image/webp" srcset="{src(i, 'sm', 'webp')} 440w, {src(i, 'lg', 'webp')} 1000w" {sizes} />
                <img src={src(i, "lg", "jpg")} srcset="{src(i, 'sm', 'jpg')} 440w, {src(i, 'lg', 'jpg')} 1000w" {sizes} width="1000" height="1294" loading={i < eager ? "eager" : "lazy"} fetchpriority={i === 0 ? "high" : "auto"} decoding="async" draggable="false"
                  alt={t("Page {page} of {total} of the {title} template", { page: i + 1, total: n, title })} />
              </picture>
            {/if}
            {#if showFields && overlay && i === cur}
              <div class="fields" aria-hidden="true">
                {#each fieldsOn(i) as f}<span class={fieldClass(f)} style="left:{f.x * 100}%; top:{f.y * 100}%; width:{f.w * 100}%; height:{f.h * 100}%; --h:{SEAT_HUES[seatIndex(f.role) % 4]}" title={f.label}><span class="fl">{f.label}</span></span>{/each}
              </div>
            {/if}
            <span class="shade" aria-hidden="true"></span>
          </li>
        {/each}
      </ol>
    </div>
  </div>

  <div class="bar">
    {#if n > 1}<button class="nb" type="button" onclick={() => go(-1)} disabled={cur === 0} aria-label={t("Previous page")} data-testid="stack-prev"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>{/if}
    <p class="count" aria-live="polite" data-testid="stack-count">{t("Page {page} of {total}", { page: cur + 1, total: n })}</p>
    {#if n > 1}<button class="nb next" type="button" onclick={() => go(1)} disabled={cur === n - 1} aria-label={t("Next page")} data-testid="stack-next"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>{/if}
    <span class="grow"></span>
    {#if showFields}<label class="tog"><input type="checkbox" bind:checked={overlay} /> {t("Show fields")}</label>{/if}
    <button class="btn quiet !min-h-0 !px-3 !py-1.5 text-sm" type="button" onclick={() => open()} data-testid="stack-full">{t("Open full size")}</button>
  </div>

  {#if n > 1}
    <ul class="thumbs" aria-label={t("Pages")}>
      {#each Array(n) as _, i}
        <li><button type="button" class="th" class:on={i === cur} onclick={() => { if (!busy) cur = i; }} aria-label={t("Go to page {page}", { page: i + 1 })} aria-current={i === cur ? "page" : undefined}>
          <picture><source type="image/webp" srcset={src(i, "sm", "webp")} /><img src={src(i, "sm", "jpg")} width="440" height="569" loading="lazy" decoding="async" alt="" draggable="false" /></picture></button></li>
      {/each}
    </ul>
  {/if}

  <dialog bind:this={full} class="full" aria-label={t("{title}, full size", { title })} onclick={(e) => { if (e.target === full) full.close(); }}>
    <div class="fbar"><span class="count">{t("Page {page} of {total}", { page: cur + 1, total: n })}</span>
      {#if n > 1}<button class="nb" type="button" onclick={() => (cur = Math.max(0, cur - 1))} disabled={cur === 0} aria-label={t("Previous page")}>‹</button><button class="nb" type="button" onclick={() => (cur = Math.min(n - 1, cur + 1))} disabled={cur === n - 1} aria-label={t("Next page")}>›</button>{/if}
      <span class="grow"></span><button class="btn quiet !min-h-0 !px-3 !py-1.5 text-sm" type="button" onclick={() => full.close()}>{t("Close")}</button></div>
    <div class="fimg">
      <picture><source type="image/webp" srcset={src(cur, "lg", "webp")} /><img src={src(cur, "lg", "jpg")} width="1000" height="1294" alt={t("Page {page} of {total} of the {title} template", { page: cur + 1, total: n, title })} /></picture>
      {#if showFields && overlay}<div class="fields" aria-hidden="true">{#each fieldsOn(cur) as f}<span class={fieldClass(f)} style="left:{f.x * 100}%; top:{f.y * 100}%; width:{f.w * 100}%; height:{f.h * 100}%; --h:{SEAT_HUES[seatIndex(f.role) % 4]}"><span class="fl">{f.label}</span></span>{/each}</div>{/if}
    </div>
  </dialog>
</section>

<style>
  .viewer { --paper-w: min(100%, 34rem); min-width: 0; }
  .stage-wrap { display: flex; justify-content: center; padding: 1.6rem 1.4rem 2rem; background: radial-gradient(120% 90% at 50% 0%, var(--lilac-soft), transparent 70%), var(--tint); border: 1px solid var(--line); border-radius: var(--r-3); }
  .stage { position: relative; width: var(--paper-w); aspect-ratio: 8.5 / 11; perspective: 1700px; outline-offset: 6px; touch-action: pan-y; cursor: grab; user-select: none; -webkit-user-select: none; }
  .stage:active { cursor: grabbing; }
  .sheets { list-style: none; margin: 0; padding: 0; position: absolute; inset: 0; transform-style: preserve-3d; }
  .sheet { position: absolute; inset: 0; background: #fff; border-radius: 3px; box-shadow: 0 1px 2px rgb(20 15 40 / .18), 0 10px 26px rgb(20 15 40 / .16); transform-origin: left center; will-change: transform, opacity; backface-visibility: hidden; container-type: inline-size; overflow: hidden; }
  .sheet img { display: block; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
  .shade { position: absolute; inset: 0; opacity: 0; pointer-events: none; background: linear-gradient(90deg, rgb(20 15 40 / .55), rgb(20 15 40 / 0) 70%); }
  .fields { position: absolute; inset: 0; pointer-events: none; }
  .fld { position: absolute; box-sizing: border-box; background: hsl(var(--h) 80% 60% / .16); border-bottom: 1.5px solid hsl(var(--h) 60% 42%); border-radius: 2px 2px 0 0; overflow: hidden; }
  .fld-checkbox { border: 1.5px solid hsl(var(--h) 60% 42%); border-radius: 2px; }
  .fl { position: absolute; left: 3px; top: 1px; font: 600 clamp(5px, 1.35cqw, 9px)/1.1 var(--font-sans, Inter, system-ui); color: hsl(var(--h) 55% 30%); white-space: nowrap; letter-spacing: .01em; }
  .fld-signature .fl, .fld-initials .fl { font-style: italic; }
  .bar { display: flex; align-items: center; gap: .55rem; margin-top: .8rem; flex-wrap: wrap; }
  .count { margin: 0; font-size: .9rem; color: var(--mute); min-width: 6.5rem; text-align: center; }
  .grow { flex: 1; }
  .nb { display: inline-grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: 999px; border: 1.5px solid var(--ink-line); background: var(--card); color: var(--ink); cursor: pointer; font-size: 1.4rem; line-height: 1; transition: transform .15s, background .15s; }
  .nb.next { background: var(--violet); border-color: var(--violet); color: #fff; }
  .nb:hover:not(:disabled) { transform: translateY(-1px); } .nb:disabled { opacity: .4; cursor: default; }
  .nb:focus-visible, .th:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
  .tog { font-size: .85rem; color: #6f6b63; display: inline-flex; align-items: center; gap: .35rem; cursor: pointer; }
  .thumbs { list-style: none; display: flex; gap: .5rem; padding: 0; margin: .9rem 0 0; overflow-x: auto; }
  .th { display: block; width: 3.4rem; padding: 0; border: 2px solid transparent; border-radius: 4px; background: #fff; cursor: pointer; box-shadow: var(--sh-1); }
  .th.on { border-color: var(--brand); } .th img { display: block; width: 100%; height: auto; border-radius: 2px; }
  .full { width: min(96vw, 60rem); max-height: 94vh; padding: 0; border: 0; border-radius: var(--r-2); background: var(--card); color: var(--ink); }
  .full::backdrop { background: rgb(12 10 20 / .6); }
  .fbar { display: flex; align-items: center; gap: .5rem; padding: .6rem .8rem; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--card); z-index: 2; }
  .fimg { position: relative; width: 100%; max-height: calc(94vh - 3.6rem); overflow: auto; background: var(--tint); }
  .fimg picture { display: block; } .fimg img { display: block; width: 100%; height: auto; }
  @media (prefers-reduced-motion: reduce) { .nb { transition: none; } }
  @media (max-width: 600px) { .stage-wrap { padding: 1rem .8rem 1.4rem; } .tog { display: none; } }
</style>
