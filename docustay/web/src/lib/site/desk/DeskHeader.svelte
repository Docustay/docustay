<script>
  import { page } from "$app/state";
  import { MENUS } from "../nav.js";
  import SiteIcon from "./SiteIcon.svelte";
  // The Desk header: 72 px, a hairline under it, logo = the Docustay mark (24 px) and "docustay". Product, Use cases, Developers, Pricing, Trust; Sign in and Get started on the right.
  let { loc = null, ui = {}, menus = {} } = $props();
  let open = $state(null), mobile = $state(false);
  const close = () => { open = null; mobile = false; };
  $effect(() => { page.url.pathname; close(); });
  const is = (href) => page.url.pathname === href || (href !== "/" && page.url.pathname.startsWith(href + "/"));
</script>
<svelte:window onkeydown={(e) => e.key === "Escape" && close()} onclick={(e) => { if (!e.target.closest?.("[data-menu]")) open = null; }} />
<header class="dh">
  <div class="dh-in">
    <a href="/" class="dh-logo" aria-label="Docustay home"><img src="/brand/docustay-wordmark-white.svg" alt="Docustay" width="129" height="26" /></a>
    {#if loc}
      <nav class="dh-nav" aria-label="Main"><a href="/{loc}/product">{menus.product}</a><a href="/pricing">{menus.pricing}</a><a href="/{loc}/trust">{menus.trust}</a></nav>
    {:else}
      <nav class="dh-nav" aria-label="Main">
        {#each MENUS as m}
          {#if m.items}
            <div class="relative" data-menu>
              <button class:cur={is(m.href)} aria-expanded={open === m.label} aria-haspopup="true" onclick={() => (open = open === m.label ? null : m.label)}>{m.label}<span class="car" aria-hidden="true">▾</span></button>
              {#if open === m.label}
                <div class="dh-panel {m.kind}" data-testid={m.kind === "dev" ? "developers-menu" : m.kind === "list" ? "product-menu" : undefined}>
                  {#if m.kind === "dev"}
                    <div><p class="ph">Build</p><ul>{#each m.panel.build as [t, h]}<li><a href={h}>{t}</a></li>{/each}</ul></div>
                    <div><p class="ph">Use with an agent</p><ul>{#each m.panel.agents as [t, h]}<li><a href={h}>{t}</a></li>{/each}</ul><p class="ph mt">Sign a PDF with…</p><ul>{#each m.panel.langs as [t, h]}<li><a href={h}>{t}</a></li>{/each}</ul></div>
                    <div class="cards">{#each m.panel.cards as [t, h, d]}<a href={h} class="card"><b>{t}</b><span>{d}</span></a>{/each}</div>
                  {:else if m.kind === "list"}
                    {#each m.cols as col}<div><p class="ph">{col.title}</p><ul>{#each col.items as [t, h, d]}<li><a href={h}><b>{t}</b><span>{d}</span></a></li>{/each}</ul></div>{/each}
                  {:else}
                    <div><ul>{#each m.items as [t, h]}<li><a href={h}>{t}</a></li>{/each}</ul></div>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}<a href={m.href} class:cur={is(m.href)} aria-current={is(m.href) ? "page" : undefined}>{m.label}</a>{/if}
        {/each}
      </nav>
    {/if}
    <div class="dh-right">
      <a href="/login" class="signin">{loc ? menus.signin : "Sign in"}</a>
      <a href="/signup" class="start">{loc ? menus.start : "Get started"}</a>
      <button class="burger" aria-label="Menu" aria-expanded={mobile} aria-controls="site-menu" onclick={() => (mobile = !mobile)}><SiteIcon name={mobile ? "plus" : "menu"} size={22} class={mobile ? "rot" : ""} /></button>
    </div>
  </div>
  {#if mobile}
    <nav id="site-menu" class="dh-mob" aria-label="Main">
      {#each MENUS as m}
        <p class="ph">{m.label}</p>
        <ul>{#each (m.items ?? [[m.label, m.href]]) as [t, h]}<li><a href={h} onclick={close}>{t}</a></li>{/each}</ul>
      {/each}
      <a href="/login" class="signin-m" onclick={close}>Sign in</a>
    </nav>
  {/if}
</header>
<style>
  .dh { position: sticky; top: 0; z-index: 40; background: rgb(11 11 12 / .86); backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); border-bottom: 1px solid #222224; }
  .dh-in { max-width: 1280px; margin: 0 auto; height: 72px; padding: 0 64px; display: flex; align-items: center; gap: 28px; }
  .dh-logo { display: inline-flex; align-items: center; min-height: 24px; text-decoration: none; } .dh-logo img { height: 26px; width: auto; display: block; } @media (max-width: 640px) { .dh-logo img { height: 22px; } }
  .dh-nav { display: flex; align-items: center; gap: 2px; }
  .dh-nav > a, .dh-nav button { font: 400 14px/1 var(--font-sans); color: #a8a39a; padding: 8px 12px; border-radius: 6px; text-decoration: none; background: none; border: 0; cursor: pointer; min-height: 40px; display: inline-flex; align-items: center; gap: 5px; }
  .dh-nav > a:hover, .dh-nav button:hover, .cur { color: #f4f2ec !important; } .car { font-size: 9px; opacity: .6; }
  .dh-panel { position: absolute; left: 0; top: calc(100% + 14px); z-index: 50; background: #131315; border: 1px solid #2a2a2c; border-radius: 10px; box-shadow: 0 30px 70px rgb(0 0 0 / .65); padding: 18px; display: grid; gap: 22px; grid-template-columns: repeat(2, minmax(220px, 1fr)); width: max-content; max-width: 94vw; }
  .dh-panel.plain { grid-template-columns: minmax(220px, 1fr); } .dh-panel.dev { grid-template-columns: 1fr 1fr 250px; width: min(760px, 94vw); left: -120px; }
  .ph { font: 500 11px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #8f8a80; margin: 0 0 10px 10px; } .ph.mt { margin-top: 18px; }
  .dh-panel ul { list-style: none; margin: 0; padding: 0; } .dh-panel li a { display: block; padding: 8px 10px; border-radius: 6px; color: #f4f2ec; text-decoration: none; font-size: 14.5px; } .dh-panel li a:hover { background: #1c1c1f; }
  .dh-panel li a b { display: block; font-weight: 500; } .dh-panel li a span { display: block; font-size: 12.5px; color: #8c877e; margin-top: 2px; }
  .cards { display: grid; gap: 10px; align-content: start; } .card { display: block; border: 1px solid #2a2a2c; border-radius: 8px; padding: 14px; text-decoration: none; color: #f4f2ec; background: #0f0f11; } .card:hover { border-color: #8585fd; } .card b { display: block; font-size: 14.5px; } .card span { display: block; font-size: 12.5px; color: #8c877e; margin-top: 4px; line-height: 1.4; }
  .dh-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .signin { font-size: 14px; color: #f4f2ec; text-decoration: none; padding: 8px 12px; border-radius: 6px; } .signin:hover { background: #1c1c1f; }
  .start { font: 600 14px/1 var(--font-sans); background: #faf8f3; color: #1b1b1b; padding: 11px 16px; border-radius: 8px; text-decoration: none; white-space: nowrap; transition: transform .15s; } .start:hover { transform: translateY(-2px); }
  .burger { display: none; background: none; border: 0; color: #f4f2ec; padding: 8px; cursor: pointer; } :global(.rot) { transform: rotate(45deg); }
  .dh-mob { max-height: calc(100vh - 72px); overflow-y: auto; padding: 8px 20px 28px; border-top: 1px solid #222224; background: #0b0b0c; } .dh-mob ul { list-style: none; margin: 0; padding: 0; } .dh-mob li a { display: block; padding: 11px 10px; color: #f4f2ec; text-decoration: none; font-size: 16px; } .dh-mob .ph { margin: 18px 0 4px 10px; } .signin-m { display: block; padding: 14px 10px; color: #f4f2ec; }
  @media (max-width: 1020px) { .dh-nav { display: none; } .burger { display: inline-flex; } .dh-in { padding: 0 20px; gap: 12px; } .signin { display: none; } }
  @media (min-width: 1021px) { .dh-mob { display: none; } }
</style>
