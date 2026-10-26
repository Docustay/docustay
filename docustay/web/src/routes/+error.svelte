<script>
  // The 404 and error page: on the cream ground like the rest of the website (16 Oct 2026), with the signature-in-light object (B4), the real site search (it opens the docs search) and the pages people most often want.
  import "$lib/site/tokens.css";
  import { page } from "$app/state";
  import Logo from "$lib/site/ui/Logo.svelte";
  import Backdrop from "$lib/site/ui/Backdrop.svelte";
  import HeroObject from "$lib/site/ui/HeroObject.svelte";
  const missing = $derived(page.status === 404);
  const links = [["Home", "/", "What Docustay is, and the first thing to try."], ["Documentation", "/docs", "The quickstart, the API reference and the guides."], ["Developers", "/developers", "The API, webhooks, test mode and the MCP server."], ["Pricing", "/pricing", "Free, Pro and self-hosting, with every number on one page."], ["Templates", "/free-templates", "More than 50 ready-made documents and forms."], ["Contact", "/contact", "Tell us what you were looking for."]];
</script>
<svelte:head><title>{missing ? "Page not found" : "Something went wrong"} · Docustay</title><meta name="robots" content="noindex" /></svelte:head>
<main class="nf" data-testid="error-page">
  <Backdrop kind="C6" />
  <div class="in">
    <a href="/" aria-label="Docustay home" class="lg"><Logo height={26} /></a>
    <div class="obj"><HeroObject kind="B4" /></div>
    <p class="code">{page.status}</p>
    <h1>{missing ? "That page isn’t here." : "Something went wrong."}</h1>
    <p class="sub">{missing ? "The address may be mistyped, or the page has moved. Search the documentation, or pick one of these." : "Try again in a moment. If it keeps happening, tell us and we will look."}</p>
    <form class="srch" action="/docs" method="get" role="search"><label class="sr-only" for="nf-q">Search the documentation</label><input id="nf-q" name="q" type="search" placeholder="Search the documentation" autocomplete="off" /><button type="submit">Search</button></form>
    <ul class="links">{#each links as [h, href, d]}<li><a {href}><b>{h}</b><span>{d}</span></a></li>{/each}</ul>
  </div>
</main>
<style>
  .nf { position: relative; min-height: 100vh; background: var(--ink-0, #ffffff); color: var(--tx-1, var(--tx-1)); font-family: var(--f-ui); overflow: hidden; }
  .in { position: relative; z-index: 1; max-width: 920px; margin: 0 auto; padding: 56px 24px 96px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .lg { display: inline-block; } .obj { margin: 26px 0 -26px; transform: scale(.7); }
  .code { margin: 0; font: 13px var(--f-mono); letter-spacing: .1em; color: var(--v-300, var(--v-700)); }
  h1 { margin: 10px 0 0; font: 400 clamp(2.6rem, 6vw, 4.2rem)/1.05 var(--f-display); letter-spacing: -.02em; background: var(--grad-title); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { max-width: 560px; margin: 18px 0 0; color: var(--tx-2, var(--tx-2)); font-size: 18px; line-height: 1.55; }
  .srch { margin-top: 28px; display: flex; gap: 10px; width: min(560px, 100%); } .srch input { flex: 1; min-width: 0; height: 48px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--ln-2); background: rgb(22 22 29 / 0.03); color: inherit; font: 16px var(--f-ui); } .srch input:focus-visible, .srch button:focus-visible, .links a:focus-visible { outline: 2px solid var(--v-700); outline-offset: 2px; } .srch button { height: 48px; padding: 0 24px; border-radius: 999px; border: 0; background: var(--grad-btn); color: #fff; font: 500 15px var(--f-ui); cursor: pointer; }
  .links { list-style: none; margin: 44px 0 0; padding: 0; width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; text-align: left; } .links a { display: grid; gap: 6px; padding: 18px 20px; border-radius: 16px; border: 1px solid var(--ln-2); background: #ffffff; color: inherit; text-decoration: none; height: 100%; box-sizing: border-box; } .links a:hover { border-color: var(--ln-v); } .links b { font-weight: 500; } .links span { color: var(--tx-2, var(--tx-2)); font-size: 14.5px; line-height: 1.5; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (max-width: 760px) { .links { grid-template-columns: 1fr 1fr; } } @media (max-width: 480px) { .links { grid-template-columns: 1fr; } .srch { flex-direction: column; } }
</style>
