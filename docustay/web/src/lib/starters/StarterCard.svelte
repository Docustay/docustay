<script>
  // Shown on sign-up and sign-in when a template was chosen on the website: which template, how many pages, the first page. So the person can see the choice survived the trip.
  import { t } from "$lib/i18n/index.svelte.js";
  import { starterInfo } from "$lib/starter.js";
  let { slug, onclear = null } = $props();
  const s = $derived(starterInfo(slug));
</script>
{#if s}
  <div class="mb-5 flex items-center gap-3 rounded-xl border border-line bg-card p-3" data-testid="starter-card">
    {#if s.kind !== "form"}<picture class="shrink-0"><source type="image/webp" srcset="/starters/{s.slug}/p1-sm.webp" /><img src="/starters/{s.slug}/p1-sm.jpg" width="440" height="569" alt="" class="h-20 w-auto rounded border border-line shadow-sm" /></picture>{/if}
    <div class="min-w-0 text-sm">
      <p class="text-xs uppercase tracking-wide text-mute">{s.kind === "form" ? t("Your form template") : t("Your template")}</p>
      <p class="serif truncate text-base font-semibold">{s.title}</p>
      <p class="text-mute">{#if s.kind !== "form"}{s.pages === 1 ? t("1 page") : t("{n} pages", { n: s.pages })} · {/if}{t("{n} fields", { n: s.fields })}</p>
      <p class="mt-0.5 text-mute">{t("It will be ready in your workspace as soon as you are in.")}</p>
    </div>
    {#if onclear}<button type="button" class="ml-auto shrink-0 text-xs underline text-mute" onclick={onclear}>{t("Not this one")}</button>{/if}
  </div>
{/if}
