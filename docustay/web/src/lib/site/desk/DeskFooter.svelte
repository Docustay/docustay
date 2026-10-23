<script>
  // Board 5: the giant faded wordmark (white file at 11% opacity), a glass footer panel with the link columns, the status pill and the cookie link. The closing line itself is `Closing.svelte`, one per page.
  import { FOOTER } from "../nav.js";
  import Logo from "../ui/Logo.svelte";
  import Backdrop from "../ui/Backdrop.svelte";
  import StatusPill from "../ui/StatusPill.svelte";
  let { status = $bindable("checking") } = $props();
</script>
<footer class="df">
  <Backdrop kind="C1" bloom={false} grain={false} />
  <div class="giant" aria-hidden="true"><img src="/brand/docustay-wordmark-black.svg" alt="" width="1252" height="253" loading="lazy" decoding="async" /></div>
  <div class="panel">
    <div class="cols">
      <div class="brand"><a href="/" aria-label="Docustay home"><Logo height={28} /></a><p>Open-source e-signature, in an app and an API. AGPL-3.0.</p></div>
      {#each FOOTER as [h, links]}
        <div><p class="mh">{h}</p><ul>{#each links as [t, l]}<li><a href={l}>{t}</a></li>{/each}</ul></div>
      {/each}
    </div>
    <div class="base"><span>© 2026 Docustay</span><StatusPill bind:status /><button type="button" onclick={() => window.dispatchEvent(new Event("docustay:cookie-settings"))} data-testid="cookie-settings">Cookie settings</button></div>
  </div>
</footer>
<style>
  .df { position: relative; margin-top: 40px; padding: 0 var(--gutter) 40px; overflow: hidden; }
  .giant { position: absolute; left: 50%; top: 10px; width: min(1240px, 94%); transform: translateX(-50%); opacity: .05; pointer-events: none; -webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent 95%); mask-image: linear-gradient(to bottom, #000 30%, transparent 95%); } .giant img { width: 100%; height: auto; display: block; }
  .panel { position: relative; z-index: 1; max-width: 1180px; margin: 150px auto 0; padding: 44px 36px 24px; border-radius: 24px; border: 1px solid var(--hairline); background: #fff; box-shadow: var(--sh-card); }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) { .panel { backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); } }
  .cols { display: grid; grid-template-columns: 1.4fr repeat(4, minmax(0, 1fr)); gap: 26px 18px; } .brand p { margin: 16px 0 0; font-size: 14.5px; line-height: 1.55; color: var(--tx-3); max-width: 200px; }
  .mh { font: 500 11px/1 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tx-3); margin: 0 0 14px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; } li a { display: inline-flex; align-items: center; min-height: 28px; font-size: 13.5px; color: var(--tx-2); text-decoration: none; } li a:hover { color: var(--tx-1); text-decoration: underline; text-underline-offset: 3px; }
  .base { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; margin-top: 34px; padding-top: 20px; border-top: 1px solid var(--ln-1); font-size: 13.5px; color: var(--tx-3); }
  .base button { min-height: 32px; padding: 4px 2px; background: none; border: 0; color: var(--tx-2); text-decoration: underline; cursor: pointer; font: inherit; }
  @media (max-width: 900px) { .cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } .brand { grid-column: 1 / -1; } }
  @media (max-width: 700px) { .panel { margin-top: 90px; padding: 28px 22px 18px; } .cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } .df { padding-bottom: 90px; } }
</style>
