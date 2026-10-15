<script>
  // The thinking and steps of one answer. While nothing has come back: "Thinking" — and only past one second the three turning sheets (a quick answer never flashes them). While a step runs: the
  // WORKING LINE — the motion for what is happening (a page being written, a form's fields dropping in, a PDF being scanned) beside the step in plain words and its detail underneath.
  // When finished: one collapsible line "Worked for 3.2 s · 2 steps" — Run 8 (the maintainer): only when the work took over a second; quicker work leaves no line unless a step failed.
  // `checklist` (layout C): the steps as a list — done ticks, the current one turning, the rest grey. Parts adapted from the Reasoning and Tool components of Svelte AI Elements (MIT, Copyright (c) 2026 Sikandar Bhide).
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import Shimmer from "./Shimmer.svelte";
  import Collapse from "./Collapse.svelte";
  import Orbit from "$lib/fx/Orbit.svelte";
  import InkSheet from "$lib/fx/InkSheet.svelte";
  import FormDrop from "$lib/fx/FormDrop.svelte";
  import Scan from "$lib/fx/Scan.svelte";
  let { steps = [], streaming = false, hasText = false, checklist = false } = $props();
  import { stepLabel } from "../stepLabels.js";
  const STEP = new Proxy({}, { get: (_, k) => stepLabel(String(k)) });
  const busy = $derived(streaming && steps.some((s) => s.state === "pending" || s.state === "running"));
  const current = $derived(steps.find((s) => s.state === "running") ?? null);
  const total = $derived(steps.reduce((n, s) => n + (s.ms ?? 0), 0));
  const failed = $derived(steps.some((s) => s.state === "failed"));
  const secs = $derived(total ? (total / 1000).toFixed(1) : null);
  // which motion fits the step that is running
  const motion = (s) => (!s ? "orbit" : s.build?.kind === "form" ? "form" : s.build || /Making the document|Preparing the draft/.test(s.label) ? "ink" : /Reading the document|Looking at your document/.test(s.label) ? "scan" : "orbit");
</script>
{#if streaming && !steps.length && !hasText}
  <div class="think" data-testid="chat-thinking"><Orbit size={16} after={1000} /><Shimmer text={t("Thinking")} /></div>
{:else if checklist && steps.length}
  <ol class="check" data-testid="chat-steps" data-state={busy ? "working" : "done"}>
    {#each steps as s (s.id)}
      <li data-testid="chat-step" data-state={s.state}><span class="mark" data-state={s.state} aria-hidden="true">{#if s.state === "done"}<Icon name="check" size={12} />{:else if s.state === "failed"}<Icon name="close" size={12} />{/if}</span><span class="grow">{STEP[s.label] ?? s.label}{#if s.detail}<span class="det">{s.detail}</span>{/if}</span>{#if s.ms != null && s.ms >= 1000}<span class="ms">{(s.ms / 1000).toFixed(1)} s</span>{/if}<span class="sr-only">{s.state === "pending" ? t("Waiting") : s.state === "running" ? t("Running") : s.state === "failed" ? t("Failed") : t("Done")}</span></li>
    {/each}
  </ol>
{:else if busy}
  <div class="working" data-testid="chat-steps" data-state="working" role="status" aria-live="polite">
    <span class="fx" aria-hidden="true">{#if motion(current) === "ink"}<InkSheet />{:else if motion(current) === "form"}<FormDrop count={current?.build?.parts?.length ?? null} />{:else if motion(current) === "scan"}<Scan testid="chat-scan" />{:else}<Orbit size={16} after={0} />{/if}</span>
    <span class="wl"><Shimmer text={current ? (STEP[current.label] ?? current.label) : t("Working")} />{#if current?.detail}<span class="det">{current.detail}</span>{/if}</span>
    <span class="sr-only" data-testid="chat-step" data-state="running">{current ? (STEP[current.label] ?? current.label) : ""}</span>
  </div>
{:else if steps.length && (total >= 1000 || failed)}
  <div class="steps" data-testid="chat-steps" data-state="done">
    <Collapse open={false} testid="chat-steps-toggle">
      {#snippet summary(isOpen)}
        <span class="chev" class:turned={isOpen}><Icon name="chevron" size={14} /></span>
        <span class="text-mute text-sm">{secs ? t("Worked for {s} s", { s: secs }) : t("Worked")} · {steps.length === 1 ? t("1 step") : t("{n} steps", { n: steps.length })}</span>
      {/snippet}
      <ul class="grid pt-1">
        {#each steps as s (s.id)}
          <li class="step" data-testid="chat-step" data-state={s.state}>
            <Collapse testid="chat-step-toggle">
              {#snippet summary()}
                <span class="mark" data-state={s.state} aria-hidden="true">{#if s.state === "done"}<Icon name="check" size={12} />{:else if s.state === "failed"}<Icon name="close" size={12} />{/if}</span>
                <span class="grow text-sm">{STEP[s.label] ?? s.label}</span>
                {#if s.ms != null}<span class="ms">{(s.ms / 1000).toFixed(1)} s</span>{/if}
                <span class="sr-only">{s.state === "failed" ? t("Failed") : t("Done")}</span>
              {/snippet}
              <div class="detail text-sm text-mute">{#if s.detail}<div>{s.detail}</div>{/if}{#if s.summary}<div>{s.summary}</div>{/if}{#if !s.detail && !s.summary}<div>{t("No more detail.")}</div>{/if}</div>
            </Collapse>
          </li>
        {/each}
      </ul>
    </Collapse>
  </div>
{/if}
<style>
  .think { display: inline-flex; align-items: center; gap: 10px; min-height: 24px; }
  .working { display: flex; align-items: center; gap: 12px; min-height: 44px; animation: wl-in 240ms cubic-bezier(.2,.8,.2,1); }
  .fx { display: inline-grid; place-items: center; width: 36px; height: 44px; flex: none; }
  .wl { display: grid; gap: 2px; min-width: 0; font-size: 14px; }
  .det { display: block; font-size: 12.5px; color: var(--mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .steps { color: var(--ink); }
  .chev { display: inline-grid; transition: transform var(--dur-fast, 160ms) var(--ease-out, ease-out); }
  .chev.turned { transform: rotate(90deg); }
  .step { border-top: 1px solid var(--line); padding: .1rem 0; }
  .step:first-child { border-top: 0; }
  .ms { font-size: 12px; color: var(--mute); font-variant-numeric: tabular-nums; }
  .mark { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 9999px; border: 1.5px solid var(--line-strong); color: #fff; flex: none; }
  .mark[data-state="done"] { background: var(--brand); border-color: var(--brand); }
  .mark[data-state="failed"] { background: var(--bad); border-color: var(--bad); }
  .mark[data-state="running"] { border-color: var(--brand); border-top-color: transparent; animation: spin 900ms linear infinite; }
  .mark[data-state="pending"] { opacity: .6; }
  .detail { padding: .15rem 0 .35rem 1.65rem; overflow-wrap: anywhere; }
  .check { list-style: none; margin: 0; padding: 0; display: grid; }
  .check li { display: flex; align-items: flex-start; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); font-size: 14px; }
  .check li:first-child { border-top: 0; }
  .check li .mark { margin-top: 2px; }
  .check li[data-state="pending"] { color: var(--mute); }
  .check li[data-state="running"] { font-weight: 500; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes wl-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .chev { transition: none; } .working { animation: none; } .mark[data-state="running"] { animation: none; border-top-color: var(--brand); } }
</style>
