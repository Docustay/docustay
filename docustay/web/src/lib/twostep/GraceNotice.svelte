<script>
  // "Your workspace will require two-step sign-in in N days": the calm notice a person sees while their workspace is giving everyone time to set it up. A track of seven stages shows the days left.
  // Asked once per tab session (and again every ten minutes), never on every page.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let st = $state(null);
  let cache = globalThis.__dsGrace ??= { at: 0, value: null };
  onMount(async () => {
    if (Date.now() - cache.at > 600_000) { const r = await api("/api/settings/security"); cache.value = r.ok ? r.json : null; cache.at = Date.now(); }
    st = cache.value;
  });
  const show = $derived(st?.youWillNeedTwoStep === true && st.graceDaysLeft != null);
  // an owner reset this person's two-step and they have not set it up again: the same calm notice, with no countdown (20 Oct 2026)
  const asked = $derived(st?.askedToSetUp === true && !show && st?.youHaveTwoStep !== true);
  const total = $derived(Math.max(7, st?.graceDaysLeft ?? 7));
</script>
{#if asked}
  <div class="notice warn mb-4" role="status" data-testid="two-step-reset-notice">
    <p>{t("A workspace owner reset your two-step sign-in, so it is off for your account. Please set it up again.")} <a class="underline" href="/settings?tab=security" data-testid="reset-set-up">{t("Set it up now")}</a></p>
  </div>
{:else if show}
  <div class="notice warn mb-4" role="status" data-testid="two-step-grace-notice">
    <p>{t("{n, plural, one {Your workspace will require two-step sign-in in # day.} other {Your workspace will require two-step sign-in in # days.}}", { n: st.graceDaysLeft })} <a class="underline" href="/settings?tab=security" data-testid="grace-set-up">{t("Set it up now")}</a></p>
    <div class="mt-2 flex gap-[3px]" aria-hidden="true" data-testid="grace-track">{#each Array.from({ length: total }) as _, i}<i class="block h-1 w-6 rounded-[2px]" style="background: {i < total - st.graceDaysLeft ? 'var(--warn)' : 'var(--warn-line)'}"></i>{/each}</div>
  </div>
{/if}
