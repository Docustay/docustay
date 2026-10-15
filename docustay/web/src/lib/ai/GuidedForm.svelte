<script>
  import Building from "$lib/fx/Building.svelte";
  import ChipInput from "$lib/ui/ChipInput.svelte";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";

  let { onopen } = $props();

  const BASE = "/api/documents/engine";
  let questions = $state([]);
  let answers = $state({});
  let loading = $state(true);
  let loadError = $state("");
  let busy = $state(false);
  let error = $state("");
  let notes = $state([]);

  onMount(async () => {
    const r = await api(`${BASE}/guided/questions`);
    loading = false;
    if (!r.ok) { loadError = r.error ?? ""; return; }
    questions = (r.json?.data ?? r.json)?.questions ?? [];
    const init = {};
    for (const q of questions) init[q.key] = q.type === "bool" ? false : q.type === "list" ? [] : "";
    answers = init;
  });

  async function build() {
    busy = true; error = ""; notes = [];
    const out = {};
    for (const q of questions) {
      const v = answers[q.key];
      if (q.type === "number") { if (v !== "" && v !== null && v !== undefined) out[q.key] = Number(v); }
      else if (q.type === "bool") out[q.key] = !!v;
      else if (q.type === "list") { if (v.length) out[q.key] = v.join(", "); }   // saved the way the server already reads it: one comma-joined string
      else if (v !== "") out[q.key] = v;
    }
    const r = await api(`${BASE}/guided`, { method: "POST", body: { answers: out } });
    busy = false;
    if (!r.ok) { error = r.error ?? ""; return; }
    const d = r.json?.data ?? r.json;
    notes = d.notes ?? [];
    onopen?.(d.source, d.title, notes);
  }
</script>

<div class="card p-4 grid gap-3" data-testid="guided-form">
  <div class="font-semibold">{t("Build it with questions")}</div>
  <p class="text-mute">{t("Answer a few questions and we put the document together for you. No AI is used.")}</p>
  {#if loading}
    <div class="text-mute">{t("Loading the questions…")}</div>
  {:else if loadError}
    <div class="notice warn">{loadError}</div>
  {:else}
    {#each questions as q (q.key)}
      <div class="grid gap-1">
        <label class="font-medium" for={"gd-" + q.key}>{q.label}{#if q.required}<span class="text-bad" aria-hidden="true"> *</span>{/if}</label>
        {#if q.type === "list"}
          <ChipInput id={"gd-" + q.key} bind:value={answers[q.key]} max={q.max} mono={false} normalize={(v) => v.replace(/[,;]/g, " ").trim()} placeholder={q.placeholder ?? ""} testid={"gd-" + q.key} count={(n) => t("{n, plural, one {# person} other {# people}}", { n })} />
        {:else if q.type === "text"}
          <input id={"gd-" + q.key} class="field" style="min-height:40px" data-testid={"gd-" + q.key} maxlength={q.max} placeholder={q.placeholder ?? ""} bind:value={answers[q.key]} />
        {:else if q.type === "number" && q.choices}
          <select id={"gd-" + q.key} class="field" style="min-height:40px" data-testid={"gd-" + q.key} bind:value={answers[q.key]}><option value="">{t("Choose")}</option>{#each q.choices as o}<option value={o.value}>{o.label}</option>{/each}</select>
        {:else if q.type === "number"}
          <input id={"gd-" + q.key} class="field" style="min-height:40px" type="number" min={q.min} max={q.max} data-testid={"gd-" + q.key} placeholder={q.placeholder ?? ""} bind:value={answers[q.key]} />
        {:else if q.type === "bool"}
          <label class="flex items-center gap-2" style="min-height:40px"><input id={"gd-" + q.key} type="checkbox" data-testid={"gd-" + q.key} bind:checked={answers[q.key]} /><span>{q.placeholder ?? ""}</span></label>
        {:else if q.type === "choice"}
          {#if (q.options ?? []).length > 4}
            <select id={"gd-" + q.key} class="field" style="min-height:40px" data-testid={"gd-" + q.key} bind:value={answers[q.key]}>
              <option value="">{q.placeholder ?? ""}</option>
              {#each q.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          {:else}
            <div class="grid gap-1" role="radiogroup" aria-labelledby={"gd-" + q.key}>
              {#each q.options ?? [] as o (o.value)}
                <label class="flex items-center gap-2" style="min-height:40px"><input type="radio" name={"gd-" + q.key} value={o.value} data-testid={"gd-" + q.key + "-" + o.value} bind:group={answers[q.key]} /><span>{o.label}</span></label>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/each}
    <div class="flex items-center gap-3 flex-wrap">
      <button class="btn primary" style="min-height:40px" data-testid="gd-go" disabled={busy} onclick={build}>{busy ? t("Building…") : t("Build it")}</button>
      {#if busy}<Building kind="form" label={t("Building it from your answers")} testid="gd-building" />{/if}
      {#if error}<span class="text-bad" role="alert" data-testid="gd-error">{error}</span>{/if}
    </div>
    {#if notes.length}
      <div class="notice info" data-testid="gd-notes">
        <div class="font-semibold">{t("Check these before you send")}</div>
        <ul class="list-disc pl-5">{#each notes as n}<li>{n}</li>{/each}</ul>
      </div>
    {/if}
  {/if}
</div>
