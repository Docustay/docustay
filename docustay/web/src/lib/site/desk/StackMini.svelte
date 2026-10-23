<script>
  // A mini paper stack for a gallery card or a use-case row: the top sheet (the real first page) plus two offset sheets, the page count on the top sheet, a slight fan on hover on desktop.
  let { t, href = `/templates/${t.slug}`, level = 3 } = $props();
</script>
<a class="mini" {href} data-testid="template-card">
  <div class="thumb"><span class="s3"></span><span class="s2"></span>
    <picture><source type="image/webp" srcset="/starters/{t.starter}/p1-sm.webp" /><img src="/starters/{t.starter}/p1-sm.jpg" width="440" height="569" alt="First page of the {t.title} template" loading="lazy" decoding="async" /></picture>
    <span class="pg">{t.pages} {t.pages === 1 ? "PAGE" : "PAGES"}</span><span class="tag">TEMPLATE</span></div>
  <svelte:element this={"h" + level} class="mt">{t.title}</svelte:element><p>{t.line}</p><span class="go">Preview and use →</span>
</a>
<style>
  .mini { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: var(--tx-1); border: 1px solid var(--hairline); background: #ffffff; border-radius: 6px; padding: 22px 22px 20px; transition: border-color .15s; height: 100%; } .mini:hover { border-color: rgb(90 58 193 / 0.5); }
  .thumb { position: relative; width: 58%; margin: 6px auto 20px; aspect-ratio: 8.5 / 11; } .thumb picture, .thumb img { display: block; width: 100%; height: 100%; } .thumb img { position: relative; z-index: 3; background: #faf8f3; border-radius: 3px; box-shadow: 0 16px 30px rgb(60 40 140 / 0.225); }
  .s2, .s3 { position: absolute; inset: 0; background: #faf8f3; border-radius: 3px; box-shadow: 0 2px 8px rgb(60 40 140 / 0.18); transition: transform .25s ease; } .s2 { z-index: 2; transform: translate(7px, 6px) rotate(2deg); } .s3 { z-index: 1; transform: translate(13px, 11px) rotate(4deg); }
  @media (hover: hover) { .mini:hover .s2 { transform: translate(14px, 8px) rotate(5deg); } .mini:hover .s3 { transform: translate(26px, 13px) rotate(10deg); } }
  .pg { position: absolute; z-index: 4; right: 6px; bottom: 6px; background: #1b1b1b; color: #f4f2ec; font: 600 10px/1 var(--font-mono); letter-spacing: .08em; padding: 5px 7px; border-radius: 3px; } .tag { position: absolute; z-index: 4; left: -10px; top: 12px; background: #5a3ac1; color: #f4f2ec; font: 700 9px/1 var(--font-mono); letter-spacing: .12em; padding: 5px 7px; transform: rotate(-90deg) translateX(-100%); transform-origin: left top; }
  .mt { margin: 0; font: 600 18px/1.2 var(--font-sans); letter-spacing: -.02em; } p { margin: 0; color: var(--tx-3); font-size: 14.5px; line-height: 1.5; flex: 1; } .go { font: 500 12.5px/1 var(--font-mono); color: var(--tx-1); margin-top: 8px; }
  @media (prefers-reduced-motion: reduce) { .s2, .s3 { transition: none; } }
</style>
