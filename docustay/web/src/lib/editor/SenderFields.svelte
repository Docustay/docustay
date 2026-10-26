<script>
  // R13-D032 / R13-D042: YOUR PARTS. The boxes marked "Filled in by: Sender" as a plain list with one input each, so they can be answered from the Check step on any screen (a phone cannot place or select
  // boxes on Prepare). Each answer is the box's own starting value (the same thing the Prepare inspector's "Your answer" sets); the list changes nothing about where a box sits.
  import { t } from "$lib/i18n/index.svelte.js";
  import { validateFieldValue } from "$lib/validate.js";
  let { body, onChange } = $props();
  const fields = $derived((body?.fields ?? []).filter((f) => f.sender === true && ["text", "dropdown", "multiselect"].includes(f.type)));
  const pageOf = (f) => t("Page {n}", { n: f.page });
  // A starter may begin a box with a fact about the workspace ({{org.name}}): it is worked out when the document is sent. Showing "{{org.name}}" in the box looked like a mistake, so such a box
  // shows what it will be (greyed, in words) and typing over it replaces it; clearing it puts the automatic value back.
  const REF = /^\{\{\s*([a-z]+\.[a-z]+)\s*\}\}$/i;
  const AUTO = $derived({ "org.name": t("your organisation's name"), "org.email": t("your organisation's email"), "sender.name": t("your name"), "sender.email": t("your email") });
  const refOf = (f) => (typeof f.default === "string" ? REF.exec(f.default.trim())?.[1]?.toLowerCase() ?? null : null);
  const original = new Map();
  $effect(() => { for (const f of fields) if (!original.has(f.id) && refOf(f)) original.set(f.id, f.default); });
  function set(id, value) { onChange?.({ ...body, fields: body.fields.map((f) => (f.id === id ? { ...f, default: value || original.get(id) || undefined } : f)) }); }
</script>
{#if fields.length}
  <div class="space-y-2 border-y border-line py-3" data-testid="sender-fields">
    <div class="font-mono text-[.7rem] uppercase tracking-wider text-brand">{t("Your parts to fill in")}</div>
    <p class="text-xs text-mute">{t("These boxes are yours. Signers see your answer and cannot change it.")}</p>
    {#each fields as f (f.id)}
      <label class="grid gap-1" data-sender-field={f.id} data-testid="sender-field">
        <span class="text-sm font-medium">{f.label || f.id}{#if f.required !== false} <span aria-hidden="true">*</span>{/if} <span class="text-xs font-normal text-mute">{pageOf(f)}</span></span>
        {#if f.type === "text"}<input class="field !py-1.5" type={f.validation === "date" ? "date" : f.validation === "email" ? "email" : f.validation === "phone" ? "tel" : "text"} inputmode={f.validation === "number" ? "decimal" : undefined} value={refOf(f) ? "" : (f.default ?? "")} placeholder={refOf(f) ? t("Filled in automatically with {what}", { what: AUTO[refOf(f)] ?? refOf(f) }) : ""} oninput={(e) => set(f.id, e.currentTarget.value)} data-testid="sender-field-input" />
        {:else}<select class="field !py-1.5" value={f.default ?? ""} onchange={(e) => set(f.id, e.currentTarget.value)} data-testid="sender-field-input"><option value="">{t("Choose…")}</option>{#each f.options ?? [] as o}<option value={o}>{o}</option>{/each}</select>{/if}
      </label>
      {#if f.type === "text" && !refOf(f) && String(f.default ?? "").trim() && validateFieldValue({ ...f, required: false }, f.default)}<p class="text-xs text-bad" role="alert" data-testid="sender-field-problem">{t("This {what}.", { what: validateFieldValue({ ...f, required: false }, f.default) })}</p>{/if}
    {/each}
  </div>
{/if}
