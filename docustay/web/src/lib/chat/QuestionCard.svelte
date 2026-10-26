<script>
  // The assistant's clickable questions (1–4, each with 2–4 options and always a type-your-own line). Pressing "Send answers" returns them as the person's next message.
  // Run 8 (the maintainer): no boxes around answers. Three looks, one behaviour — `rows` (A and C: radio rows with hairline dividers), `pills` (B), `bar` (D: big rows with number keys 1–4 and ↵).
  // Once answered the question FOLDS: the other choices fade, then the whole thing becomes one summary line ("Form type · Job application"). Reduced motion: it folds at once.
  import { fade, slide } from "svelte/transition";
  import { t } from "$lib/i18n/index.svelte.js";
  import { calm } from "$lib/fx/index.js";
  let { proposal, onanswer = () => {}, variant = "rows", active = false } = $props();
  const qs = $derived(proposal.card?.questions ?? []);
  const answered = $derived(proposal.state !== "proposed");
  let picks = $state({}), other = $state({}), busy = $state(false), folding = $state(false), kq = $state(0);
  // the recommended option is pre-selected, so the quickest answer is one press
  $effect.pre(() => { qs.forEach((q, i) => { if (picks[i] === undefined) picks[i] = q.multiSelect ? q.options.filter((o) => o.recommended).map((o) => o.label) : (q.options.find((o) => o.recommended)?.label ?? null); }); });
  const chosen = (i) => { const q = qs[i], o = (other[i] ?? "").trim(); const p = picks[i]; return q.multiSelect ? [...(p ?? []), ...(o ? [o] : [])] : (o || p || ""); };
  const ready = $derived(qs.every((_, i) => { const v = chosen(i); return Array.isArray(v) ? v.length > 0 : Boolean(v); }));
  function toggle(i, label) { if (answered) return; const q = qs[i]; if (q.multiSelect) { const cur = picks[i] ?? []; picks[i] = cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]; other[i] = other[i] ?? ""; } else { picks[i] = label; other[i] = ""; } }
  async function send() {
    if (busy || !ready) return; busy = true; const ans = qs.map((_, i) => chosen(i));
    proposal.answers = ans.map((a) => (Array.isArray(a) ? a.join(", ") : a));   // the summary line shows what was picked
    if (!calm()) { folding = true; await new Promise((r) => setTimeout(r, 220)); }
    await onanswer(proposal, ans); busy = false; folding = false;
  }
  const summary = $derived(qs.map((q, i) => ({ head: q.header || q.question, answer: proposal.answers?.[i] ?? "" })));
  // D: number keys pick, ↵ sends — only for the live question, and never while the person is typing in a field
  function keys(e) {
    if (variant !== "bar" || !active || answered || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    const n = Number(e.key), qi = Math.min(kq, qs.length - 1);
    if (n >= 1 && n <= (qs[qi]?.options.length ?? 0)) { e.preventDefault(); toggle(qi, qs[qi].options[n - 1].label); if (!qs[qi].multiSelect && qi < qs.length - 1) kq = qi + 1; }
    else if (e.key === "Enter" && ready) { e.preventDefault(); send(); }
  }
  const dur = () => (calm() ? 0 : 240);
</script>
<svelte:window onkeydown={keys} />
{#if answered}
  <div class="qsum" data-testid="chat-q-done" in:fade={{ duration: dur() }}>
    <span class="ck" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg></span>
    <span class="min-w-0">{#each summary as s, i}{#if i}<span class="sep">·</span>{/if}<span class="hd">{s.head}</span>{#if s.answer}<span class="arrow">·</span><span class="an">{s.answer}</span>{/if}{/each}{#if !summary.some((s) => s.answer)}<span class="arrow">·</span><span class="an">{t("Answered")}</span>{/if}</span>
  </div>
{:else}
  <div class="qc {variant}" class:folding data-testid="chat-card-questions" data-state={proposal.state} out:slide={{ duration: dur() }}>
    {#if variant === "bar"}<div class="lab mono">{qs.length > 1 ? t("Scribe · {n} questions", { n: qs.length }) : t("Scribe · one question")}</div>{/if}
    {#each qs as q, i (i)}
      <fieldset>
        <legend>
          {#if q.header && variant !== "bar"}<span class="lab mono">{q.header}</span>{/if}
          <span class="qq">{q.question}</span>
          {#if qs.length > 1 || q.multiSelect}<span class="sub">{qs.length > 1 ? t("Question {n} of {total}", { n: i + 1, total: qs.length }) : ""}{q.multiSelect ? `${qs.length > 1 ? " · " : ""}${t("pick any")}` : ""}</span>{/if}
        </legend>
        <div class="opts" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
          {#each q.options as o, k (o.label)}
            {@const on = q.multiSelect ? (picks[i] ?? []).includes(o.label) : picks[i] === o.label && !(other[i] ?? "").trim()}
            <button type="button" class="opt" class:on role={q.multiSelect ? "checkbox" : "radio"} aria-checked={on} data-testid="chat-q-option" onclick={() => toggle(i, o.label)}>
              {#if variant !== "pills"}<span class="mark" class:sq={q.multiSelect} aria-hidden="true"></span>{/if}
              <span class="txt"><span class="ol">{o.label}{#if o.recommended}<span class="rec">{t("Recommended")}</span>{/if}</span>{#if o.description && variant !== "pills"}<span class="od">{o.description}</span>{/if}</span>
              {#if variant === "bar"}<kbd class="key" aria-hidden="true">{k + 1}</kbd>{/if}
            </button>
          {/each}
        </div>
        <input class="own" placeholder={t("Or type your own…")} aria-label={t("Type your own answer")} bind:value={other[i]} oninput={() => { if (!q.multiSelect) picks[i] = null; }} data-testid="chat-q-other" />
      </fieldset>
    {/each}
    <div class="go"><button type="button" class="btn primary send" disabled={!ready || busy} data-testid="chat-q-send" onclick={send}>{t("Send answers")}{#if variant === "bar"}<kbd class="key dark" aria-hidden="true">↵</kbd>{/if}</button></div>
  </div>
{/if}
<style>
  .qc { display: grid; gap: 14px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: grid; gap: 8px; }
  legend { display: grid; gap: 4px; padding: 0; margin-bottom: 8px; }
  .lab { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); }
  .mono { font-family: var(--font-mono, ui-monospace, monospace); }
  .qq { font-size: 15px; font-weight: 600; line-height: 1.35; color: var(--ink); }
  .bar .qq { font-size: 17px; }
  .sub { font-size: 12px; color: var(--mute); }
  .opts { display: grid; }
  .opt { display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left; background: none; border: 0; border-top: 1px solid var(--line); color: var(--ink); padding: 10px 2px; min-height: 44px; cursor: pointer; font: inherit; transition: opacity 200ms cubic-bezier(.2,.8,.2,1), background 160ms; }
  .opt:last-child { border-bottom: 1px solid var(--line); }
  .opt:hover { background: color-mix(in srgb, var(--tint) 70%, transparent); }
  .opt:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; border-radius: 4px; }
  .mark { width: 16px; height: 16px; margin-top: 2px; border-radius: 50%; border: 1.5px solid var(--line-strong); flex: none; transition: border-color 160ms, box-shadow 160ms; }
  .mark.sq { border-radius: 4px; }
  .opt.on .mark { border-color: var(--brand); box-shadow: inset 0 0 0 3.5px var(--card), inset 0 0 0 8px var(--brand); }
  .opt.on .mark.sq { box-shadow: inset 0 0 0 2.5px var(--card), inset 0 0 0 8px var(--brand); }
  .txt { display: grid; gap: 2px; min-width: 0; flex: 1; }
  .ol { font-size: 14px; font-weight: 500; }
  .rec { margin-left: 8px; font-size: 11.5px; font-weight: 500; color: var(--brand); }
  .od { font-size: 13px; color: var(--mute); }
  .own { width: 100%; border: 0; border-bottom: 1px dashed var(--line-strong); background: transparent; color: var(--ink); padding: 8px 2px; font: inherit; font-size: 14px; min-height: 40px; }
  .own:focus { outline: none; border-bottom-color: var(--brand); border-bottom-style: solid; }
  .go { display: flex; }
  .send { min-height: 36px !important; padding: 0 14px !important; font-size: 13.5px; gap: 8px; }
  /* B: pills */
  .pills .opts { display: flex; flex-wrap: wrap; gap: 8px; }
  .pills .opt, .pills .opt:last-child { width: auto; border: 1px solid var(--line-strong); border-radius: 999px; padding: 7px 14px; min-height: 36px; align-items: center; }
  .pills .opt.on { border-color: var(--brand); color: var(--brand); background: color-mix(in srgb, var(--brand) 7%, transparent); }
  .pills .ol { font-size: 13.5px; }
  /* D: the command bar's big rows with keys */
  .bar .opt { padding: 12px 6px; align-items: center; }
  .bar .ol { font-size: 15px; }
  .key { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 5px; border: 1px solid var(--line); background: var(--tint); color: var(--mute); font: 500 11.5px var(--font-mono, ui-monospace, monospace); margin-left: auto; }
  .key.dark { background: rgb(255 255 255 / .16); border-color: transparent; color: inherit; margin-left: 4px; }
  /* the fold: the picked row stays, the rest fade */
  .folding .opt:not(.on), .folding .own, .folding .go { opacity: 0; }
  .qsum { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--mute); padding: 2px 0; }
  .ck { width: 16px; height: 16px; border-radius: 50%; background: var(--brand); display: grid; place-items: center; flex: none; margin-top: 1px; }
  .ck svg { width: 11px; height: 11px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .hd { color: var(--mute); } .an { color: var(--ink); font-weight: 500; }
  .arrow, .sep { margin: 0 .3em; color: var(--mute); }
  @media (prefers-reduced-motion: reduce) { .opt, .mark { transition: none; } }
</style>
