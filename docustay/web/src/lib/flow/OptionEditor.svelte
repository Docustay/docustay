<script>
  // The choices of a Dropdown, Choose one or Choose several: one row per option, add, delete, drag to reorder, a default, and (for a single choice) "I pick the answer and lock it".
  import { t } from "$lib/i18n/index.svelte.js";
  import FlowIcon from "./FlowIcon.svelte";
  let { options = [], value = "", locked = false, multi = false, onchange = () => {}, testid = "opt" } = $props();
  let dragFrom = $state(-1), over = $state(-1);
  const clean = (s) => String(s ?? "").replace(/[,;"{}=]/g, " ").replace(/\s+/g, " ").trimStart().slice(0, 120);   // an option is one plain phrase: the tag grammar uses commas, semicolons and quotes
  const emit = (opts, v = value, l = locked) => onchange({ options: opts, default: opts.includes(v) ? v : "", locked: Boolean(l) && opts.includes(v) });
  const rename = (i, v) => { const old = options[i], next = options.map((o, k) => (k === i ? clean(v) : o)); emit(next, value === old ? clean(v) : value); };
  const add = () => { let n = options.length + 1, w = `Option ${n}`; while (options.includes(w)) { n += 1; w = `Option ${n}`; } emit([...options, w]); };
  const remove = (i) => { const gone = options[i]; emit(options.filter((_, k) => k !== i), value === gone ? "" : value, value === gone ? false : locked); };
  const move = (a, b) => { if (a === b || a < 0 || b < 0 || b >= options.length) return; const next = [...options]; const [x] = next.splice(a, 1); next.splice(b, 0, x); emit(next); };
  const pickDefault = (o) => emit(options, value === o ? "" : o, value === o ? false : locked);
</script>
<div class="grid gap-2" data-testid={testid}>
  <p class="text-sm">{t("Choices")}</p>
  <ol class="grid gap-1.5">
    {#each options as o, i (i)}
      <li class="flex items-center gap-1.5 rounded-lg {over === i && dragFrom !== i ? 'bg-tint' : ''}" ondragover={(e) => { e.preventDefault(); over = i; }} ondrop={(e) => { e.preventDefault(); move(dragFrom, i); dragFrom = -1; over = -1; }} ondragend={() => { dragFrom = -1; over = -1; }} data-testid={`${testid}-row`}>
        <span class="cursor-grab px-1 text-mute" draggable="true" ondragstart={(e) => { dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }} aria-label={t("Drag to reorder")} title={t("Drag to reorder")} data-testid={`${testid}-grip`}>⋮⋮</span>
        <input class="field !py-1.5 min-w-0 flex-1" value={o} oninput={(e) => rename(i, e.currentTarget.value)} onkeydown={(e) => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); } else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); } }} aria-label={t("Choice {n}", { n: i + 1 })} data-testid={`${testid}-input`} />
        {#if !multi}<button type="button" class="btn !min-h-9 !px-2 !py-1 text-xs {value === o ? 'primary' : ''}" aria-pressed={value === o} onclick={() => pickDefault(o)} title={t("Start with this one chosen")} data-testid={`${testid}-default`}>{t("Default")}</button>{/if}
        <button type="button" class="btn !min-h-9 !px-2 !py-1" onclick={() => remove(i)} disabled={options.length <= 1} aria-label={t("Delete choice {n}", { n: i + 1 })} data-testid={`${testid}-delete`}><FlowIcon name="x" size={14} /></button>
      </li>
    {/each}
  </ol>
  <button type="button" class="btn !min-h-9 !py-1 text-sm" onclick={add} data-testid={`${testid}-add`}><FlowIcon name="plus" size={14} /> {t("Add a choice")}</button>
  {#if !multi}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={locked} disabled={!value} onchange={(e) => emit(options, value, e.currentTarget.checked)} data-testid={`${testid}-locked`} /> {t("I choose the answer and lock it")}</label>
    {#if !value}<p class="text-xs text-mute">{t("Mark one choice as Default to lock it.")}</p>{/if}{/if}
</div>
