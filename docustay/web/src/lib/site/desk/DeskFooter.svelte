<script>
  import { FOOTER } from "../nav.js";
  import { SITE_LANGS, LANG_NAMES } from "../l10n-langs.js";
  // Seven columns (Product, Use cases, Developers, Sign a PDF with…, Free tools, Trust and legal, Company). No Compare column. The status pill, the language picker and the cookie link stay.
  let { loc = null, ui = {}, status = "checking", showLang = false, altHref = (l) => "/", L10N = {} } = $props();
</script>
<footer class="df">
  {#if loc}
    <div class="df-in df-loc"><a href="/">{L10N[loc].footer.more}</a><a href="/legal/terms">{L10N[loc].footer.terms}</a><a href="/legal/privacy-policy">{L10N[loc].footer.privacy}</a><a href="/contact">{L10N[loc].footer.contact}</a></div>
  {:else}
    <div class="df-in df-cols">
      {#each FOOTER as [h, links]}
        <div><p class="mh">{h}</p><ul>{#each links as [t, l]}<li><a href={l}>{t}</a></li>{/each}</ul></div>
      {/each}
    </div>
  {/if}
  <div class="df-in df-base">
    <a href="/" class="df-mark" aria-label="Docustay home"><img src="/brand/docustay-wordmark-white.svg" alt="Docustay" width="109" height="22" /></a>
    <a href="/status" class="pill" data-testid="status-pill"><span class="dot" class:bad={status !== "ok"}></span>{status === "ok" ? "All systems operational" : status === "checking" ? "Checking status" : "Status: see details"}</a>
    <span>{ui.operator ?? "Docustay is a product of GLRS LLC."}</span><span>© 2026</span>
    <span class="r">
      {#if showLang}<label class="sr-only" for="langpick">{ui.langLabel}</label><select id="langpick" value={loc ?? "en"} onchange={(e) => (location.href = altHref(e.currentTarget.value))}>{#each SITE_LANGS as l}<option value={l}>{LANG_NAMES[l]}</option>{/each}</select>{/if}
      <button type="button" onclick={() => window.dispatchEvent(new Event("docustay:cookie-settings"))} data-testid="cookie-settings">Cookie settings</button>
    </span>
  </div>
</footer>
<style>
  .df { margin-top: 110px; border-top: 1px solid #222224; background: #0b0b0c; }
  .df-in { max-width: 1280px; margin: 0 auto; padding: 0 64px; }
  .df-cols { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 28px; padding-top: 56px; padding-bottom: 48px; }
  .df-loc { display: flex; flex-wrap: wrap; gap: 8px 24px; padding-top: 36px; padding-bottom: 28px; } .df-loc a { color: #a8a39a; text-decoration: underline; }
  .mh { font: 500 11px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: #8f8a80; margin: 0 0 14px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; } li a { font-size: 13px; color: #8c877e; text-decoration: none; } li a:hover { color: #f4f2ec; }
  .df-base { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 22px; padding-top: 22px; padding-bottom: 30px; border-top: 1px solid #222224; font-size: 13px; color: #8c877e; }
  .pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #2a2a2c; border-radius: 999px; padding: 5px 12px; color: #a8a39a; text-decoration: none; } .dot { width: 7px; height: 7px; border-radius: 99px; background: #7bd88f; } .dot.bad { background: #e5b13a; }
  .r { margin-left: auto; display: flex; align-items: center; gap: 14px; } .r button { min-height: 24px; background: none; border: 0; color: #a8a39a; text-decoration: underline; cursor: pointer; font: inherit; } select { background: #131315; color: #f4f2ec; border: 1px solid #2a2a2c; border-radius: 6px; padding: 5px 8px; font-size: 13px; }
  @media (max-width: 1100px) { .df-cols { grid-template-columns: repeat(3, 1fr); } } @media (max-width: 700px) { .df-in { padding: 0 20px; } .df-cols { grid-template-columns: repeat(2, 1fr); } .r { margin-left: 0; } }
  .df-mark { display: inline-flex; align-items: center; min-height: 24px; text-decoration: none; } .df-mark img { height: 22px; width: auto; display: block; }
</style>
