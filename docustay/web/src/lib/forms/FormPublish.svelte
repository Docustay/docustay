<script>
  // A FORM's Publish options (Run 7) — the same boxes on the flow's Publish step and on the Forms page. The list and labels come from the flow definition (FORM_PUBLISH_OPTIONS);
  // `s` is the form's settings as the server stores them (src/documents/forms.mjs cleanFormSettings), `slug` the link name.
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import { FORM_PUBLISH_OPTIONS } from "$lib/flow/flowDefinition.js";
  import Toggle from "$lib/ui/Toggle.svelte";
  let { s = $bindable(), slug = $bindable(""), lockSlug = false, tried = false } = $props();
  const SLUG = /^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$/;
  const slugBad = $derived(tried && !SLUG.test(String(slug ?? "")));
  const HELP = () => ({
    slug: t("Letters, numbers and dashes. It becomes the end of the link."),
    expiresAt: t("The form stays open through the end of this day. After that the link says it is closed."),
    responseLimit: t("Leave empty for no limit."),
    verifyEmail: t("They get a link by email before they can sign, so you know the address is theirs."),
    copyTo: t("A copy of every signed response also goes here."),
    intro: t("A short paragraph the person reads before they start."),
    thankYou: t("What the person reads when they finish."),
    fillAgain: t("After signing, offer a button to start a new response."),
    embedSites: t("The start of each address, one per line, like https://www.example.com. Only these sites may show the form inside their pages."),
    notifyOwner: t("One email per signed response, to the workspace owner."),
    confirmRespondent: t("The person gets an email with their signed copy attached."),
  });
  const embedText = $derived(Array.isArray(s.embedSites) ? s.embedSites.join("\n") : (s.embedSites ?? ""));
</script>
<div class="grid max-w-[860px] gap-4" data-testid="form-publish">
  {#each FORM_PUBLISH_OPTIONS as o (o.key)}
    {#if o.kind === "toggle"}
      <Toggle checked={!!s[o.key]} onchange={(v) => (s[o.key] = v)} label={tl(o.label)} hint={HELP()[o.key]} testid={`fp-${o.key}`} />
    {:else}
      <label class="grid gap-1"><span class="text-sm font-medium">{tl(o.label)}</span><span class="text-xs text-mute">{HELP()[o.key]}</span>
        {#if o.key === "slug"}<input class="field {slugBad ? '!border-bad' : ''}" bind:value={slug} disabled={lockSlug} placeholder="front-desk-sign-in" aria-invalid={slugBad} data-testid="fp-slug" />{#if slugBad}<span class="text-xs text-bad" role="alert">{t("The link name must be 4–60 characters: letters, numbers and dashes.")}</span>{/if}
        {:else if o.kind === "date"}<input class="field !w-48" type="date" value={s[o.key] ? String(s[o.key]).slice(0, 10) : ""} oninput={(e) => (s[o.key] = e.currentTarget.value || null)} data-testid={`fp-${o.key}`} />
        {:else if o.kind === "number"}<input class="field !w-40" type="number" min="1" max="100000" value={s[o.key] ?? ""} oninput={(e) => (s[o.key] = e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} data-testid={`fp-${o.key}`} />
        {:else if o.kind === "email"}<input class="field" type="email" value={s[o.key] ?? ""} oninput={(e) => (s[o.key] = e.currentTarget.value || null)} data-testid={`fp-${o.key}`} />
        {:else if o.kind === "textarea"}<textarea class="field" rows="3" maxlength="1000" value={s[o.key] ?? ""} oninput={(e) => (s[o.key] = e.currentTarget.value || null)} data-testid={`fp-${o.key}`}></textarea>
        {:else if o.kind === "list"}<textarea class="field font-mono text-sm" rows="3" value={embedText} oninput={(e) => (s.embedSites = e.currentTarget.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))} data-testid="fp-embedSites"></textarea>
        {:else}<input class="field" maxlength="300" value={s[o.key] ?? ""} oninput={(e) => (s[o.key] = e.currentTarget.value || null)} data-testid={`fp-${o.key}`} />{/if}
      </label>
    {/if}
  {/each}
</div>
