<script>
  // "Powered by Stripe". A quiet text badge. Stripe publishes an official badge and wordmark under its brand guidelines (stripe.com/newsroom/brand-assets); until that asset is dropped into
  // static/brand/powered-by-stripe.svg this is plain text, which carries the same words and never imitates the wordmark.
  import { t } from "$lib/i18n/index.svelte.js";
</script>
<span class="psb" data-testid="powered-by-stripe">{t("Powered by Stripe")}</span>
<style>
  .psb { display: inline-flex; align-items: center; font-size: 12px; font-weight: 500; letter-spacing: .02em; color: var(--mute); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; background: var(--card); }
</style>
