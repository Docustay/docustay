<script>
  import { onMount } from "svelte";
  import Logo from "$lib/Logo.svelte";
  import { t, startLang } from "$lib/i18n/index.svelte.js";
  import Stage from "$lib/entry/Stage.svelte";
  import Consent from "$lib/site/Consent.svelte";
  import { entry } from "$lib/entry/mood.svelte.js";
  import { authConfig } from "$lib/auth.js";
  import { canonicalAuthAddress } from "$lib/canonicalHost.js";
  let { children } = $props();
  let hosted = $state(false);   // R13-D115: an own install has no analytics, so no consent banner; shown only once the server says this is the hosted service
  onMount(async () => { const there = canonicalAuthAddress(window.location); if (there) { window.location.replace(there); return; }   // passkeys only work on the host they were made on: one sign-in address
    startLang(); try { hosted = (await authConfig()).selfHost !== true; } catch { hosted = false; } });
</script>
<Stage mood={entry.mood} />
{#if hosted}<Consent />{/if}
<div class="auth" data-auth-stage>
  <header class="mark"><span class="pill"><Logo play /></span></header>
  <main class="card" data-testid="auth-card">{@render children()}</main>
  <footer class="foot">
    <p><a href="/legal/terms">{t("Terms")}</a> · <a href="/legal/privacy">{t("Privacy")}</a></p>
  </footer>
</div>
<style>
  .auth { position: relative; z-index: 1; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2.5rem 1rem; gap: 0; }
  .pill { display: inline-flex; align-items: center; gap: .75rem; background: color-mix(in srgb, var(--card, #fff) 96%, transparent); border-radius: .85rem; padding: .45rem 1rem; box-shadow: 0 8px 30px rgb(0 0 0 / .35); }
  .mark { margin-bottom: 1.4rem; animation: auth-rise 520ms cubic-bezier(.2,.8,.2,1) both; }
  .card { width: 100%; max-width: 28rem; border-radius: 1.15rem; background: color-mix(in srgb, var(--card, #fff) 97%, transparent); color: var(--ink, #14112b); padding: 1.9rem 2.1rem 2.1rem; box-shadow: 0 1px 0 rgb(255 255 255 / .12) inset, 0 40px 90px rgb(0 0 0 / .55), 0 0 0 1px rgb(143 138 248 / .25); transform-origin: 50% 100%; animation: auth-in 640ms cubic-bezier(.2,.8,.2,1) 80ms both; }
  .card :global(h1), .card :global(.btn) { overflow-wrap: anywhere; }
  /* R13-D485: the links under the sign-in and sign-up forms were 17 to 18 px tall; each is a 24 px target now */
  .card :global(p a) { display: inline-block; min-height: 24px; padding-block: 3px; box-sizing: border-box; }
  .foot { margin-top: 1.4rem; display: flex; flex-direction: column; align-items: center; gap: .75rem; font-size: .75rem; color: rgb(255 255 255 / .72); }
  .foot a { color: inherit; text-decoration: none; display: inline-flex; align-items: center; min-height: 24px; padding: 0 .25rem; } .foot a:hover { color: #fff; text-decoration: underline; }
  /* two equal halves: the card centred in the left half, the sheets (Stage) centred in the right half, at every width */
  @media (min-width: 1100px) { .auth { width: 50vw; padding-inline: 2rem; } }
  @media (max-width: 480px) { .card { padding: 1.5rem 1.25rem 1.6rem; } .auth { justify-content: flex-start; padding-top: 1.75rem; } }
  @keyframes auth-in { from { opacity: 0; transform: perspective(1200px) rotateX(9deg) translateY(26px); } to { opacity: 1; transform: none; } }
  @keyframes auth-rise { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .card, .mark { animation: none; } }
  :global(html[data-lite]) .card, :global(html[data-lite]) .mark { animation: none; }
</style>
