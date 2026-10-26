<script>
  // A LIST typed as chips (Ark UI Tags Input, MIT) — never a one-per-line box or a comma string. Type and press Enter or comma; paste a whole list (split on commas, spaces, semicolons and
  // new lines) and each piece becomes a chip; Backspace removes the last chip; every chip has a remove button. `validate(value)` returns a sentence or null; a bad chip stays, in red, with
  // the sentence under the box, and `onchange(values, problems)` lets the form refuse to save while one is there. `max`, no repeats, and a small count.
  import { TagsInput } from "@ark-ui/svelte/tags-input";
  import X from "@lucide/svelte/icons/x";
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = $bindable([]), onchange = () => {}, validate = () => null, normalize = (v) => v, max = 0, label = "", placeholder = "", testid = "", id = "", disabled = false, mono = true, count = null, hint = "" } = $props();
  const split = (s) => String(s ?? "").split(/[\s,;]+/).map((x) => normalize(x.trim())).filter(Boolean);
  const problems = $derived(Object.fromEntries(value.map((v) => [v, validate(v)]).filter(([, m]) => m)));
  const over = $derived(max > 0 && value.length > max);
  let pending = $state("");   // D-081: text typed but not yet turned into a chip counts as one, so the counter moves as you type
  const pendingN = $derived(split(pending).filter((v) => !value.includes(v)).length);
  const countText = $derived(count ? count(value.length + pendingN) : t("{n, plural, one {# item} other {# items}}", { n: value.length + pendingN }));
  function set(next) {
    const seen = new Set(); const clean = next.filter((v) => (seen.has(v) ? false : (seen.add(v), true)));
    value = clean; onchange(clean, Object.fromEntries(clean.map((v) => [v, validate(v)]).filter(([, m]) => m)));
  }
  function paste(e) {
    const text = e.clipboardData?.getData("text") ?? ""; const parts = split(text);
    if (parts.length < 2 && !/[\s,;]/.test(text.trim())) return;
    e.preventDefault(); set([...value, ...parts]);
  }
  const add = (e) => { const el = e.currentTarget; if (e.key === "Backspace" && !el.value && value.length) { e.preventDefault(); e.stopPropagation(); set(value.slice(0, -1)); return; } if (el.value.trim() && (e.key === "Enter" || e.key === ",")) { e.preventDefault(); e.stopPropagation(); set([...value, ...split(el.value)]); el.value = ""; pending = ""; } };
  const leave = (e) => { const v = e.currentTarget.value.trim(); if (v) { set([...value, ...split(v)]); e.currentTarget.value = ""; pending = ""; } };
</script>
<TagsInput.Root value={[...value]} onValueChange={(d) => set(d.value)} allowOverflow addOnPaste={false} validate={() => true} {disabled} class="chips" data-testid={testid || undefined}>
  {#if label}<TagsInput.Label class="label">{label}</TagsInput.Label>{/if}
  <TagsInput.Control class="chips-control">
    {#each value as v, i (v)}
      <TagsInput.Item value={v} index={i} class="chip {problems[v] ? 'bad' : ''}" data-invalid={problems[v] ? "" : undefined} data-testid={testid ? `${testid}-chip` : undefined}>
        <TagsInput.ItemPreview class="chip-body">
          <TagsInput.ItemText class={mono ? "mono" : ""}>{v}</TagsInput.ItemText>
          <TagsInput.ItemDeleteTrigger class="chip-x" aria-label={t("Remove {value}", { value: v })}><X size={14} /></TagsInput.ItemDeleteTrigger>
        </TagsInput.ItemPreview>
      </TagsInput.Item>
    {/each}
    <TagsInput.Input {id} class="chips-input {mono ? 'mono' : ''}" placeholder={value.length ? "" : placeholder} data-testid={testid ? `${testid}-input` : undefined} onkeydown={add} onpaste={paste} onblur={leave} oninput={(e) => (pending = e.currentTarget.value)} />
  </TagsInput.Control>
  <TagsInput.HiddenInput />
  <div class="chips-foot">
    <span class="chips-count" class:bad={over}>{countText}{#if max > 0}<span>&nbsp;·&nbsp;{t("up to {n}", { n: max })}</span>{/if}</span>
    {#if hint}<span class="chips-hint">{hint}</span>{/if}
  </div>
  {#each Object.entries(problems) as [v, m] (v)}<p class="chips-problem" role="alert" data-testid={testid ? `${testid}-problem` : undefined}><span class="mono">{v}</span> — {m}</p>{/each}
  {#if over}<p class="chips-problem" role="alert">{t("At most {n} are allowed.", { n: max })}</p>{/if}
</TagsInput.Root>
