<script>
  // The ribbon: where a document is, in four stages (Sent, Opened, Signed, Sealed), derived from true data (see ribbon.js). `full` draws the document page's version (nodes on a line with a
  // one-line subtext under each); the default is the compact one for list rows, phones and the signing page: four 22x4 segments and a short label that says what is next in plain words.
  import { ribbonOf } from "./ribbon.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Icon from "./Icon.svelte";
  let { facts = {}, full = false, slim = false, names = null, labels = null, class: cls = "", testid = "" } = $props();
  const r = $derived(ribbonOf(facts, (s, v) => t(s, v)));
  const NAMES = $derived({ Sent: t("Sent"), Opened: t("Opened"), Signed: t("Signed"), Sealed: t("Sealed"), ...(names ?? {}) });
  const segColor = (st) => (r.sealed ? "var(--seal)" : r.ended ? "var(--faint)" : st === "done" || st === "current" ? "var(--brand)" : "var(--stage-off)");
  const toneClass = $derived(r.tone === "ok" ? "text-ok" : r.tone === "warn" ? "text-warn" : r.tone === "bad" ? "text-bad" : "text-mute");
</script>
{#if full}
  <ol class="grid grid-cols-4 {cls}" data-testid={testid || "ribbon-full"} data-kind={r.kind} aria-label={t("Where this document is")}>
    {#each r.stages as s, i (s.name)}
      <li class="min-w-0" aria-current={s.state === "current" ? "step" : undefined}>
        <div class="flex items-center">
          <span class="h-[2px] flex-1 {i === 0 ? 'opacity-0' : ''}" style="background: {r.stages[i - 1]?.state === 'done' && (s.state === 'done' || s.state === 'current') ? (r.sealed ? 'var(--seal)' : 'var(--brand)') : 'var(--stage-off)'}"></span>
          {#if s.state === "done"}<span class="grid h-[18px] w-[18px] place-items-center rounded-full text-white" style="background: {r.sealed ? 'var(--seal)' : r.ended ? 'var(--faint)' : 'var(--brand)'}"><Icon name="check" size={11} /></span>
          {:else if s.state === "current"}<span class="grid h-[18px] w-[18px] place-items-center rounded-full border-2" style="border-color: var(--brand); background: var(--card)"><span class="h-[6px] w-[6px] rounded-full" style="background: var(--brand)"></span></span>
          {:else}<span class="h-[18px] w-[18px] rounded-full border-2 bg-[var(--card)]" style="border-color: var(--line-strong)"></span>{/if}
          <span class="h-[2px] flex-1 {i === 3 ? 'opacity-0' : ''}" style="background: {s.state === 'done' && r.stages[i + 1] && r.stages[i + 1].state !== 'todo' ? (r.sealed ? 'var(--seal)' : 'var(--brand)') : 'var(--stage-off)'}"></span>
        </div>
        <p class="{slim ? 'mt-1.5' : 'mt-2'} text-center text-[13px] font-medium {s.state === 'todo' ? 'text-mute' : 'text-ink'}">{NAMES[s.name]}</p>
        {#if s.sub && !slim}<p class="mt-0.5 truncate text-center text-[12px] text-faint">{s.sub}</p>{/if}
      </li>
    {/each}
  </ol>
{:else}
  <span class="inline-flex min-w-0 items-center gap-2 {cls}" data-testid={testid || "ribbon"} data-kind={r.kind}>
    <span class="flex shrink-0 gap-[3px]" aria-hidden="true">
      {#each r.stages as s (s.name)}<i class="ribbon-seg block h-1 w-[22px] rounded-[2px] {r.kind === 'draft' ? 'border border-dashed border-line-strong' : ''}" style="background: {r.kind === 'draft' ? 'transparent' : segColor(s.state)}"></i>{/each}
    </span>
    <span class="min-w-0 truncate text-[12px] {toneClass}">{labels?.label ?? r.label}</span>
  </span>
{/if}
