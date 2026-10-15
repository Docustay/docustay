<script>
  // After Publish (Run 7): the form's link and a ready-to-paste embed snippet. The embed works only on the websites listed in the form's settings (the server's frame rules say so).
  import { t } from "$lib/i18n/index.svelte.js";
  import CopyField from "$lib/ui/CopyField.svelte";
  let { link = "", sites = [] } = $props();
  const snippet = $derived(link ? `<iframe src="${link}?embed=1" title="Form" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>` : "");
</script>
<div class="grid gap-3" data-testid="form-share">
  <CopyField label={t("The link")} value={link} unroll copiedLabel={t("Link copied")} testid="form-share-link" />
  <CopyField label={t("Embed it on your website")} value={snippet} />
  <p class="text-xs text-mute" data-testid="form-share-sites">{sites?.length ? t("It can be shown on: {sites}", { sites: sites.join(", ") }) : t("Add your website under “Websites that may show the form” to embed it. Without one, only the link works.")}</p>
</div>
