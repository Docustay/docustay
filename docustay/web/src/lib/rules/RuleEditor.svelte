<script>
  // "SHOW THIS WHEN" (Run 9): a rule built from rows — a box, a condition, a value — joined by "and" or "or". The rows ARE the JSON Logic the server checks (src/documents/rules.mjs);
  // nothing is typed in a rule language, so every word here is translated. A rule that came in another way (the API) and is not rows is shown in words with Remove.
  // `choices` are the boxes the rule may read: [{ id, label, type }]. `rule` is the JSON Logic or null; `onchange(ruleOrNull)`.
  import { t } from "$lib/i18n/index.svelte.js";
  import { checkRule, describeRule } from "./rules.js";
  let { rule = null, choices = [], onchange, testid = "rule", note = "" } = $props();
  const OPS = () => [["ticked", t("is ticked")], ["unticked", t("is not ticked")], ["filled", t("is filled in")], ["empty", t("is empty")], ["==", t("is")], ["!=", t("is not")], [">", t("is more than")], [">=", t("is at least")], ["<", t("is less than")], ["<=", t("is at most")]];
  const needsValue = (op) => !["ticked", "unticked", "filled", "empty"].includes(op);
  const idOf = (x) => (x && typeof x === "object" && "var" in x ? (Array.isArray(x.var) ? x.var[0] : x.var) : null);
  function rowOf(c) {
    const [op] = Object.keys(c ?? {}); const a = c?.[op];
    if (op === "==" && a?.[1] === true && idOf(a[0])) return { id: idOf(a[0]), op: "ticked", value: "" };
    if (op === "!=" && a?.[1] === true && idOf(a[0])) return { id: idOf(a[0]), op: "unticked", value: "" };
    if (op === "!!" && idOf(Array.isArray(a) ? a[0] : a)) return { id: idOf(Array.isArray(a) ? a[0] : a), op: "filled", value: "" };
    if (op === "!" && idOf(Array.isArray(a) ? a[0] : a)) return { id: idOf(Array.isArray(a) ? a[0] : a), op: "empty", value: "" };
    if (["==", "!=", ">", ">=", "<", "<="].includes(op) && idOf(a?.[0]) && ["string", "number"].includes(typeof a[1])) return { id: idOf(a[0]), op, value: String(a[1]) };
    return null;
  }
  const parsed = $derived.by(() => {
    if (!rule) return { join: "and", rows: [] };
    const [op] = Object.keys(rule);
    const list = op === "and" || op === "or" ? rule[op] : [rule];
    const rows = list.map(rowOf);
    return rows.every(Boolean) ? { join: op === "or" ? "or" : "and", rows } : null;
  });
  const clause = (r) => {
    const v = { var: r.id }, n = Number(String(r.value).replace(/,/g, ""));
    const val = r.value !== "" && Number.isFinite(n) && /^-?[\d,]*\.?\d+$/.test(String(r.value).trim()) ? n : String(r.value);
    return r.op === "ticked" ? { "==": [v, true] } : r.op === "unticked" ? { "!=": [v, true] } : r.op === "filled" ? { "!!": [v] } : r.op === "empty" ? { "!": [v] } : { [r.op]: [v, val] };
  };
  function emit(join, rows) {
    const done = rows.filter((r) => r.id && (!needsValue(r.op) || r.value !== ""));
    const out = !done.length ? null : done.length === 1 ? clause(done[0]) : { [join]: done.map(clause) };
    if (out) checkRule(out);   // the same allow-list the server uses; a row can only make an allowed rule
    onchange(out);
  }
  let draft = $state(null);   // rows being edited that are not complete yet (a new row with no box chosen)
  const rows = $derived(draft?.rows ?? parsed?.rows ?? []);
  const join = $derived(draft?.join ?? parsed?.join ?? "and");
  const set = (i, p) => { const next = rows.map((r, k) => (k === i ? { ...r, ...p } : r)); draft = { join, rows: next }; emit(join, next); };
  const add = () => { const first = choices[0]; draft = { join, rows: [...rows, { id: first?.id ?? "", op: first?.type === "checkbox" ? "ticked" : "filled", value: "" }] }; emit(join, draft.rows); };
  const drop = (i) => { const next = rows.filter((_, k) => k !== i); draft = { join, rows: next }; emit(join, next); };
  const setJoin = (j) => { draft = { join: j, rows }; emit(j, rows); };
  const labelOf = (id) => choices.find((c) => c.id === id)?.label || id;
</script>
<div class="space-y-1.5" data-testid={testid}>
  {#if parsed === null && !draft}
    <p class="text-xs" data-testid={`${testid}-words`}>{describeRule(rule, labelOf)}</p>
    <button class="btn !min-h-8 !py-0.5 !text-xs" onclick={() => { draft = { join: "and", rows: [] }; onchange(null); }}>{t("Remove the rule")}</button>
  {:else}
    {#each rows as r, i (i)}
      {#if i > 0}<div class="flex gap-1 text-xs" role="radiogroup" aria-label={t("Join the conditions with")}>{#each [["and", t("and")], ["or", t("or")]] as [v, w]}<button type="button" role="radio" aria-checked={join === v} class="rounded px-1.5 py-0.5 {join === v ? 'bg-brand text-white' : 'border border-line'}" onclick={() => setJoin(v)} disabled={i > 1} data-testid={`${testid}-join-${v}`}>{w}</button>{/each}</div>{/if}
      <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
        <select class="field !py-1 text-xs" value={r.id} onchange={(e) => { const c = choices.find((x) => x.id === e.currentTarget.value); set(i, { id: e.currentTarget.value, op: c?.type === "checkbox" ? "ticked" : r.op === "ticked" || r.op === "unticked" ? "filled" : r.op }); }} aria-label={t("Box")} data-testid={`${testid}-box-${i}`}>
          {#if !choices.some((c) => c.id === r.id)}<option value={r.id}>{r.id || t("Choose…")}</option>{/if}
          {#each choices as c}<option value={c.id}>{c.label || c.id}</option>{/each}</select>
        <button type="button" class="btn quiet !min-h-8 !px-2 !py-0.5 text-xs" onclick={() => drop(i)} aria-label={t("Remove this condition")}>×</button>
        <select class="field !py-1 text-xs" value={r.op} onchange={(e) => set(i, { op: e.currentTarget.value })} aria-label={t("Condition")} data-testid={`${testid}-op-${i}`}>{#each OPS().filter(([o]) => (choices.find((c) => c.id === r.id)?.type === "checkbox" ? ["ticked", "unticked"].includes(o) : !["ticked", "unticked"].includes(o))) as [o, w]}<option value={o}>{w}</option>{/each}</select>
        {#if needsValue(r.op)}<input class="field !py-1 text-xs" value={r.value} oninput={(e) => set(i, { value: e.currentTarget.value })} aria-label={t("Value")} placeholder={t("Value")} data-testid={`${testid}-value-${i}`} />{:else}<span></span>{/if}
      </div>
    {/each}
    {#if choices.length}<button type="button" class="btn !min-h-8 !py-0.5 !text-xs" onclick={add} data-testid={`${testid}-add`}>{rows.length ? t("Add a condition") : t("Add a rule")}</button>
    {:else}<p class="text-xs text-mute">{t("There is nothing earlier for a rule to use yet.")}</p>{/if}
    {#if note}<p class="text-xs text-mute">{note}</p>{/if}
  {/if}
</div>
