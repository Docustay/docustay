<script>
  // The language choice for the signed-in app and the sign-in screens: a plain select with each language in its own name. The choice is remembered in this browser.
  import { i18n, setLang, APP_LANGS, t } from "./index.svelte.js";
  import { LANG_NAMES } from "$lib/site/l10n-langs.js";
  import Pick from "$lib/ui/Pick.svelte";
  import SuggestTranslation from "./SuggestTranslation.svelte";
  let { class: cls = "" } = $props();
</script>
<Pick options={APP_LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} value={i18n.lang} label={t("Language")} onchange={(v) => setLang(v)} testid="lang-picker" class="filter-pill {cls}" />
{#if i18n.lang !== "en"}<SuggestTranslation surface="language_menu" class="ml-2" />{/if}
