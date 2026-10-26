<script>
  // Billing > Payments > Set up payments: the four-step wizard on its own focused page.
  import { t } from "$lib/i18n/index.svelte.js";
  import PayWizard from "$lib/payments/PayWizard.svelte";
</script>
<svelte:head><title>{t("Set up payments")} · {t("Billing")} · Docustay</title></svelte:head>
<PayWizard />
