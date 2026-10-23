<script>
  import Toggle from "$lib/ui/Toggle.svelte";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, td } from "$lib/i18n/index.svelte.js";
  import Pick from "$lib/ui/Pick.svelte";
  import ProLock from "$lib/pro/ProLock.svelte";
  import ColorPick from "$lib/ui/ColorPick.svelte";
  import ChipInput from "$lib/ui/ChipInput.svelte";
  import ChoiceMulti from "$lib/ui/ChoiceMulti.svelte";
  import { splitList, normOrigin, originProblem } from "$lib/lists.js";
  // A settings page drawn from the server's own list of settings (groups → fields with a type), so a new setting needs no new screen.
  // Docustay's signed copy is the document's own pages plus a certificate page, so these look settings (they dress a typeset document: header, page numbers, closing line, the signature block) have nothing to act on here; they stay in the API, not on the screen (Stage T F925)
  const NOT_ON_A_CERTIFIED_COPY = new Set(["signed_copy.header_text", "signed_copy.page_numbers", "signed_copy.closing_line", "signed_copy.signature_style", "signed_copy.show_signer_email", "signed_copy.show_signer_ip"]);
  let { endpoint = "/api/documents/settings", only = null, except = [], bare = false, intro = false, reserve = "" } = $props();   // reserve: the height to hold while loading, for a long form that sits above other panels (stops them jumping)
  let data = $state(null), problem = $state(null), notes = $state({}), rev = $state({});
  // D-001 / D-087: a control that was refused (or typed past what is allowed) is redrawn from the saved value, so the screen never shows a state the server did not accept
  // Run 8 (motion board Ask 5, settings that answer back): switches slide (ark.css), a changed model turns over like a card once the new value is back, and "Saved" arrives quietly
  let flipped = $state({});
  const redraw = (key) => { rev = { ...rev, [key]: (rev[key] ?? 0) + 1 }; };
  const load = async (again = 2) => { const r = await api(endpoint); if (r.ok) { data = r.json; problem = null; } else if (data && again > 0) { setTimeout(() => load(again - 1), r.status === 429 ? 4000 : 1500); } else if (!data) problem = r.error ?? t("The settings could not be loaded."); };
  onMount(() => { load(); return live(["settings", "email", "ai", "billing"], () => load()); });
  async function save(f, value) {
    notes = { ...notes, [f.key]: "saving" };
    const r = await api(endpoint, { method: "POST", body: { key: f.key, value } });
    notes = { ...notes, [f.key]: r.ok ? "saved" : (r.error ?? t("That was not accepted.")) };
    if (!r.ok) redraw(f.key);
    await load();
  }
  // a value picked from a short list: the list's own entries, plus whatever is saved now if it is not among them (so nothing saved earlier is hidden)
  const label = (o) => td(o.label);
  const pickOptions = (f) => { const list = f.choices.map((o) => ({ value: o.value === null ? "none" : String(o.value), label: label(o) })); const cur = f.value === null || f.value === undefined ? "none" : String(f.value); return list.some((o) => o.value === cur) ? list : [{ value: cur, label: t("Current: {value}", { value: cur }) }, ...list]; };
  const providerOf = () => data?.groups?.flatMap((g) => g.fields).find((x) => x.key === "ai.provider")?.value ?? "anthropic";
  const modelOptions = (f) => { const list = f.modelChoices[providerOf()].map((o) => ({ value: o.value === "" ? "none" : o.value, label: label(o) })); const cur = f.value || "none"; return list.some((o) => o.value === cur) ? list : [{ value: cur, label: t("Current: {value}", { value: cur }) }, ...list]; };
  const show = (g) => (only ? only.includes(g.key) : !except.includes(g.key));
</script>
{#if problem}<p class="text-bad" role="alert">{problem}</p>{:else if !data}<p class="text-mute" style={reserve ? `min-height: ${reserve}` : undefined}>{t("Loading…")}</p>{:else}
  {#if data.intro && !bare && intro}<p class="mb-4 max-w-2xl text-mute">{td(data.intro)}</p>{/if}   <!-- D-088: the lead line describes the Documents tab only, so only that tab asks for it -->
  <div class="pg-sections" style="--col: 36rem; --row: 2rem">
  {#each data.groups.filter(show) as g}
    <section>{#if !bare}<h2 class="mb-2 text-lg font-semibold">{td(g.label)}</h2>{/if}
      <div class="divide-y divide-line border-y border-line">
        {#each g.fields.filter((x) => !NOT_ON_A_CERTIFIED_COPY.has(x.key)) as f (f.key)}
          <div class="grid grid-cols-1 gap-1 px-0 py-3 md:grid-cols-[minmax(0,1fr)_280px] md:gap-6">
            <div><label class="text-sm font-medium" for={"s-" + f.key}>{td(f.label)}</label>{#if f.help}<p class="mt-0.5 text-xs text-mute">{td(f.help)}</p>{/if}</div>
            <div>
              {#key rev[f.key] ?? 0}
              {#if f.choices}{@const opts = pickOptions(f)}<Pick id={"s-" + f.key} options={opts} value={f.value === null || f.value === undefined ? "none" : String(f.value)} onchange={(v) => save(f, v === "none" ? null : Number(v))} testid={"pick-" + f.key} />
              {:else if f.widget === "color"}<ColorPick id={"s-" + f.key} value={f.value} onchange={(v) => save(f, v)} testid={"color-" + f.key} />
              {:else if f.widget === "model" && f.modelChoices?.[providerOf()]}{#key f.value}<span class="flip" class:on={flipped[f.key]} data-testid="model-flip"><Pick id={"s-" + f.key} options={modelOptions(f)} value={f.value || "none"} onchange={(v) => { flipped = { ...flipped, [f.key]: true }; save(f, v === "none" ? null : v); }} testid="pick-ai.model" /></span>{/key}
              {:else if f.type === "bool"}{#if f.planItem}<ProLock item={f.planItem} locked={f.lockedByPlan === true && f.value !== true} tip={td(f.label)}>{#snippet children(locked)}<Toggle id={"s-" + f.key} checked={f.value === true} disabled={locked} onchange={(v) => save(f, v)} testid={"toggle-" + f.key} />{/snippet}</ProLock>{:else}<Toggle id={"s-" + f.key} checked={f.value === true} disabled={f.lockedByPlan === true && f.value !== true} onchange={(v) => save(f, v)} testid={"toggle-" + f.key} />{/if}
              {:else if f.type === "number"}<input id={"s-" + f.key} class="field !py-1.5" type="number" value={f.value} onchange={(e) => save(f, Number(e.currentTarget.value))} />
              {:else if f.type === "select"}<Pick id={"s-" + f.key} options={(f.options ?? []).map((o) => ({ value: String(o.value ?? o), label: td(o.label ?? String(o)) }))} value={String(f.value ?? "")} onchange={(v) => save(f, v)} testid={"pick-" + f.key} />
              {:else if f.type === "days"}{#if f.planItem && f.lockedByPlan}<ProLock item={f.planItem} locked={true} tip={td(f.label)}>{#snippet children()}<span class="chip mute" data-testid={"locked-value-" + f.key}>{(f.value ?? []).join(", ")}</span>{/snippet}</ProLock>{:else}{#key JSON.stringify(f.value)}<ChipInput id={"s-" + f.key} value={(f.value ?? []).map(String)} max={3} placeholder="3" validate={(v) => (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60 ? null : t("a whole number from 1 to 60"))} onchange={(vals, bad) => { if (!Object.keys(bad).length && vals.length >= 1 && vals.length <= 3) save(f, vals.map(Number).sort((a, b) => a - b)); else { notes = { ...notes, [f.key]: t("Up to three days, each a whole number from 1 to 60.") }; redraw(f.key); } }} count={(n) => t("{n, plural, one {# day} other {# days}}", { n })} />{/key}{/if}
              {:else if f.type === "list"}{#key JSON.stringify(f.value)}<ChoiceMulti id={"s-" + f.key} options={(f.options ?? []).map((o) => ({ value: o.value ?? o, label: td(o.label ?? String(o.value ?? o)) }))} value={f.value ?? []} onchange={(v) => save(f, v)} />{/key}
              {:else if f.widget === "origins"}{#key f.value}<ChipInput id={"s-" + f.key} value={splitList(f.value).map(normOrigin)} max={25} normalize={normOrigin} placeholder="https://app.example.com" validate={originProblem} onchange={(vals, bad) => { if (!Object.keys(bad).length && vals.length <= 25) save(f, vals.length ? vals.join("\n") : ""); }} count={(n) => t("{n, plural, one {# website} other {# websites}}", { n })} />{/key}
              {:else if f.widget === "styles"}{#key f.value}<ChoiceMulti id={"s-" + f.key} options={(f.options ?? []).map((o) => ({ value: o.value, label: td(o.label), hint: td(o.hint) }))} value={splitList(f.value)} onchange={(v) => save(f, v.join(", "))} placeholder={t("All styles")} />{/key}
              {:else}<input id={"s-" + f.key} class="field !py-1.5" value={f.value ?? ""} onchange={(e) => save(f, e.currentTarget.value === "" ? null : e.currentTarget.value)} />{/if}
              {/key}
              {#if f.lockedByPlan && f.value !== true}<p class="mt-1 text-xs text-mute" data-testid={"locked-" + f.key}>{t("Part of Pro.")}</p>{/if}
              {#if notes[f.key]}<p class="mt-1 text-xs {notes[f.key] === 'saved' || notes[f.key] === 'saving' ? 'text-mute' : 'text-bad'}" class:saved-note={notes[f.key] === 'saved'} role="status">{notes[f.key] === 'saved' ? t('Saved') : notes[f.key] === 'saving' ? t('Saving…') : notes[f.key]}</p>{/if}
            </div>
          </div>{/each}
      </div></section>{/each}
  </div>
{/if}
<style>
  .flip { display: block; perspective: 600px; } .flip.on :global(> *) { animation: flip-in 420ms cubic-bezier(.2,.8,.2,1); transform-origin: 50% 50%; }
  @keyframes flip-in { from { transform: rotateX(-88deg); opacity: .2; } to { transform: none; opacity: 1; } }
  .saved-note { animation: saved-in 320ms cubic-bezier(.2,.8,.2,1); }
  @keyframes saved-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .flip.on :global(> *), .saved-note { animation: none; } }
</style>
