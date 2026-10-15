<script>
  // EVERY DOOR TO A NEW TEMPLATE (Run 8 verify): the Templates header and its empty state, Forms' "New form template" and "Make a form template", the create page in template or form mode, and
  // "Also keep this as a template" on send all wear this one lock — the shared ProLock on `unlimited_templates`, with the same tip. It locks only once this month's new templates are used
  // (plan.svelte.js `entitled`). test/r8_pro_lock_inventory.test.mjs fails when a door to a new template is added without it. The server refuses anyway; this only says so up front.
  import ProLock from "./ProLock.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { plan } from "./plan.svelte.js";
  import { DEFAULT_PLANS } from "$lib/site/plans.js";
  let { testid = "prolock-new-template", class: cls = "", children: door } = $props();
</script>
<ProLock item="unlimited_templates" tip={t("Your Free plan includes {n} new templates a month. Pro has no limit.", { n: plan.data?.usage?.templatesLimit ?? DEFAULT_PLANS.free.templatesPerMonth })} {testid} class={cls}>{#snippet children(locked)}{@render door?.(locked)}{/snippet}</ProLock>
