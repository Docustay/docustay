<script>
  // The glass header (V2 board 20): a bar floating 14 px from the top, 1,180 px wide, 56 px tall. Four mega menus (Developers, Features, Templates, Self-host): link columns on the left, two live cards on the right.
  // Hover intent 120 ms; 160 ms fade and an 8 px rise; Escape and a click outside close; arrow keys move through the links; reduced motion shows each card's still poster. Cards load their WebGL only when the menu opens and only the first scene card of a menu runs live.
  // Phone: one full-screen sheet where each tab expands in place and the cards are not shown; every target at least 44 px.
  import { page } from "$app/state";
  import { MENUS, MOBILE_MENUS } from "../nav.js";
  import Logo from "../ui/Logo.svelte";
  import MenuPreview from "../visuals/MenuPreview.svelte";
  let open = $state(null), mobile = $state(false), scrolled = $state(false), timer = null, cur = $state(null);   // cur: the link the preview shows
  const close = () => { open = null; mobile = false; };
  $effect(() => { page.url.pathname; close(); });
  $effect(() => { if (typeof document === "undefined") return; document.documentElement.classList.toggle("sheet-open", mobile); if (mobile) window.dispatchEvent(new Event("docustay:sheet")); });
  const track = (menu) => { try { window.umami?.track?.("menu_open", { tab: menu }); } catch { /* analytics is optional */ } };
  const enter = (l) => { clearTimeout(timer); timer = setTimeout(() => { if (open !== l) { track(l); cur = MENUS.find((m) => m.label === l)?.cols?.[0]?.items?.[0] ?? null; } open = l; }, open ? 0 : 120); };
  const leave = () => { clearTimeout(timer); timer = setTimeout(() => (open = null), 160); };
  const is = (href) => page.url.pathname === href || (href !== "/" && page.url.pathname.startsWith(href + "/"));
  const onscroll = () => { scrolled = window.scrollY > 40; };
  // arrow keys move through the links of the open menu
  function keys(e) {
    if (e.key === "Escape") { const was = open; close(); if (was) document.querySelector(`[data-menu="${was}"] > button`)?.focus(); return; }
    if (!open || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const links = [...document.querySelectorAll(`[data-menu="${open}"] .panel a, [data-menu="${open}"] > button`)]; const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); const step = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1; links[(i + step + links.length) % links.length]?.focus();
  }
</script>
<svelte:window onkeydown={keys} onclick={(e) => { if (!e.target.closest?.("[data-menu]")) open = null; }} {onscroll} />
<header class="dh" class:scrolled class:is-sheet={mobile}>
  <div class="bar">
    <a href="/" class="logo" aria-label="Docustay home"><Logo height={26} class="hdr" /></a>
    {#snippet item(m)}
              {#if m.cols}
          <div class="mi" data-menu={m.label} onmouseenter={() => enter(m.label)} onmouseleave={leave} onfocusin={() => enter(m.label)}>
            <button type="button" class:cur={is(m.href)} aria-expanded={open === m.label} aria-haspopup="true" data-umami-event="cta_click" data-umami-event-location={"header_" + m.label.toLowerCase().replace("-", "")} onclick={() => { if (open !== m.label) cur = m.cols?.[0]?.items?.[0] ?? null; open = open === m.label ? null : m.label; }}>{m.label}<svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg></button>
            {#if open === m.label}
              <div class="panel" data-testid="{m.label.toLowerCase()}-menu">
                {#each m.cols as c}<div class="col"><p class="ph">{c.title}</p>{#each c.items as it}<a href={it[1]} onmouseenter={() => (cur = it)} onfocus={() => (cur = it)}>{it[0]}</a>{/each}</div>{/each}
                <div class="pv">{#if cur}<MenuPreview href={cur[1]} name={cur[0]} />{/if}</div>
              </div>
            {/if}
          </div>
        {:else}<a href={m.href} class="top" class:cur={is(m.href)} aria-current={is(m.href) ? "page" : undefined}>{m.label}</a>{/if}
    {/snippet}
    <nav class="nav l" aria-label="Main">{#each MENUS.filter((m) => m.side !== "right") as m}{@render item(m)}{/each}</nav>
    <nav class="nav r" aria-label="Developers and self-hosting">{#each MENUS.filter((m) => m.side === "right") as m}{@render item(m)}{/each}</nav>
    <div class="right">
      <a href="/login" class="signin">Sign in</a>
      <a href="/signup" class="start" data-testid="header-signup" data-umami-event="cta_click" data-umami-event-location="header" data-umami-event-target="signup">Sign up</a>
      <a href="/demo" class="demo" data-testid="try-demo" data-umami-event="cta_click" data-umami-event-location="header" data-umami-event-target="demo"><span class="full">Try the demo</span><span class="short">Demo</span></a>
      <button type="button" class="burger" aria-label={mobile ? "Close menu" : "Menu"} aria-expanded={mobile} aria-controls="site-menu" onclick={() => (mobile = !mobile)}><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">{#if mobile}<path d="M5 5l12 12M17 5L5 17" />{:else}<path d="M3 7h16M3 15h16" />{/if}</svg></button>
    </div>
  </div>
</header>
{#if mobile}
  <div id="site-menu" class="sheetw" role="dialog" aria-label="Menu">
    <div class="sheet">
      <a href="/demo" class="demo big" onclick={close} data-umami-event="cta_click" data-umami-event-location="header" data-umami-event-target="demo">Try the demo</a>
      <nav aria-label="Main">
        {#each MOBILE_MENUS as m}
          {#if m.cols}<details><summary>{m.label}<svg aria-hidden="true" width="12" height="12" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg></summary><div class="acc">{#each m.cols as c}<p class="ph">{c.title}</p>{#each c.items as [t, h]}<a href={h} onclick={close}>{t}</a>{/each}{/each}</div></details>
          {:else}<a href={m.href} class="flat" onclick={close}>{m.label}</a>{/if}
        {/each}
      </nav>
      <div class="foot"><a href="/login" onclick={close}>Sign in</a><a href="/signup" class="outline" onclick={close}>Sign up</a></div>
    </div>
  </div>
{/if}
<style>
  .dh { position: fixed; z-index: 40; top: 14px; left: 0; right: 0; display: flex; justify-content: center; padding: 0 var(--gutter); pointer-events: none; }
  .bar { pointer-events: auto; position: relative; width: 100%; max-width: 1180px; height: 56px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 22px; border-radius: 16px; border: 1px solid var(--hairline); background: rgb(255 255 255 / .82); box-shadow: 0 1px 2px rgb(22 22 29 / .04); transition: background var(--d-base), border-color var(--d-base), box-shadow var(--d-base); }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) { .bar { backdrop-filter: blur(var(--glass-indigo-blur)); -webkit-backdrop-filter: blur(var(--glass-indigo-blur)); } }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .bar { background: var(--glass-solid); } }
  .scrolled .bar { background: rgb(255 255 255 / .96); border-color: var(--hairline); box-shadow: var(--sh-card); }
  .logo { display: flex; align-items: center; margin-right: 10px; min-height: 44px; }
  .nav { display: flex; align-items: center; gap: 2px; } .nav.l { margin: 0 auto 0 0; }
  .nav .top, .nav button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border-radius: 10px; background: none; border: 0; color: var(--tx-2); font: 400 15px/1 var(--f-ui); text-decoration: none; cursor: pointer; }
  .nav .top:hover, .nav button:hover, .nav .cur, .nav [aria-expanded="true"] { color: var(--tx-1); background: var(--violet-tint); } .nav svg { color: var(--tx-3); }
  .mi { position: static; }
  .panel { position: absolute; z-index: 50; left: 50%; top: calc(100% + 12px); width: 880px; max-width: 94vw; display: grid; grid-template-columns: 1fr 1fr 340px; gap: 8px 22px; padding: 22px; border-radius: 20px; border: 1px solid var(--hairline); background: #fff; box-shadow: var(--sh-2); transform: translateX(-50%); animation: rise 160ms var(--e-out) both; }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
  .pv { grid-row: 1 / span 1; min-height: 300px; } .col { display: flex; flex-direction: column; gap: 2px; } .col a { display: block; padding: 8px 10px; border-radius: 10px; color: var(--tx-1); font-size: 14.5px; text-decoration: none; } .col a:hover { background: var(--violet-tint); color: var(--v-700); }
  .ph { font: 500 11px/1 var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--tx-3); margin: 2px 0 8px 10px; }
  .right { display: flex; align-items: center; gap: 8px; margin-left: auto; font-size: 14px; } .nav.r + .right { margin-left: 8px; }
  .signin { padding: 10px 12px; color: var(--tx-2); text-decoration: none; border-radius: 10px; } .signin:hover { color: var(--tx-1); }
  .start { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--ln-2); color: var(--tx-1); text-decoration: none; white-space: nowrap; } .start:hover { border-color: var(--v-500); background: var(--violet-tint); }
  .demo { display: inline-flex; align-items: center; min-height: 40px; padding: 0 18px; border-radius: 999px; background: var(--grad-btn); color: #fff; font-weight: 500; text-decoration: none; white-space: nowrap; box-shadow: var(--sh-btn); transition: transform var(--d-fast) var(--e-out), filter var(--d-fast); } .demo:hover { transform: translateY(-2px); filter: brightness(1.08); } .demo:active { transform: scale(.97); }
  .demo .short { display: none; } .burger { display: none; min-width: 44px; min-height: 44px; place-items: center; background: none; border: 0; color: var(--tx-1); cursor: pointer; border-radius: 10px; }
  .nav :focus-visible, .right :focus-visible, .logo:focus-visible { outline: 2px solid var(--v-700); outline-offset: 2px; }
  .sheetw { position: fixed; inset: 0; z-index: 39; padding-top: 84px; background: rgb(247 246 252)  /* R13-D156 (main): solid, so the page text cannot show through behind the menu */; overflow-y: auto; }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) { .sheetw { backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); } }
  .sheet { max-width: 520px; margin: 0 auto; padding: 8px 20px 40px; display: grid; gap: 18px; } .big { justify-content: center; min-height: 52px; font-size: 16px; }
  .sheet nav { display: grid; } .sheet summary, .sheet .flat { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 0 4px; border-bottom: 1px solid var(--ln-1); color: var(--tx-1); font: 500 18px var(--f-ui); text-decoration: none; list-style: none; cursor: pointer; } .sheet summary::-webkit-details-marker { display: none; } details[open] summary svg { transform: rotate(180deg); }
  .acc { display: grid; padding: 4px 0 10px 12px; } .acc a { display: flex; align-items: center; min-height: 44px; color: var(--tx-2); text-decoration: none; font-size: 16px; }
  .foot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .foot a { display: flex; align-items: center; justify-content: center; min-height: 48px; border-radius: 999px; color: var(--tx-1); text-decoration: none; } .foot .outline { border: 1px solid var(--ln-2); }
  :global(html.sheet-open) { overflow: hidden; }
  @media (max-width: 1060px) { .nav, .signin, .right .start { display: none; } .burger { display: inline-grid; } .bar { padding: 0 8px 0 16px; } .demo .full { display: none; } .demo .short { display: inline; } }
  @media (prefers-reduced-motion: reduce) { .bar, .demo { transition: none; } .panel { animation: none; } .demo:hover { transform: none; } }
</style>
