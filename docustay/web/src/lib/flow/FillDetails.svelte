<script>
  // FILL IN THE DETAILS: the short form a template asks before it becomes a document. One box per question the template's author put in (names, fees, dates, terms); the answers go into the words and are kept on the document.
  import { t } from "$lib/i18n/index.svelte.js";
  let { vars = [], values = $bindable({}), tried = false, ai = null } = $props();
  const bad = (v) => tried && !String(values[v.key] ?? "").trim();
  const type = (k) => (k === "date" ? "date" : k === "number" || k === "money" ? "text" : "text");
  const mode = (k) => (k === "number" || k === "money" ? "decimal" : undefined);
</script>
<section aria-label={t("Fill in the details")} data-testid="fill-details">
  <h2 class="text-lg font-semibold">{t("Fill in the details")}</h2>
  <p class="mt-1 text-sm text-mute">{t("This template asks a few questions. Your answers go into the words.")}</p>
  <div class="pg-sections mt-4" style="--col: 24rem; --row: 1rem; --colgap: 2rem">
    {#each vars as v (v.key)}
      <label class="grid gap-1 text-sm"><span class="font-medium">{v.label}</span>
        <input class="field {bad(v) ? '!border-bad' : ''}" type={type(v.kind)} inputmode={mode(v.kind)} bind:value={values[v.key]} aria-invalid={bad(v)} data-testid={`fill-${v.key}`} />
        {#if v.help}<span class="text-xs text-mute">{v.help}</span>{/if}
        {#if bad(v)}<span class="text-xs text-bad" data-testid={`fill-${v.key}-error`}>{t("Fill this in to continue.")}</span>{/if}
      </label>
    {/each}
  </div>
</section>
