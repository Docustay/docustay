<script>
  // "Compare plans" (Billing, Plan tab): Free, Pay as you go, Pro and Lifetime side by side, the plan this workspace is on tinted and tagged, one action under each column. On a phone the same facts
  // are one card per plan (the current plan open). The words in every cell come from billingModel.columns(), i.e. from the status payload. There is NO "Choose Free": Free is reached by cancelling
  // (the paid period runs to its end), so the Free column offers only a quiet "Cancel {plan}" on a paid subscription.
  import { onMount } from "svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import PlanPiece from "./PlanPiece.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { EXPLORE_PRO_URL } from "$lib/pro/plan.svelte.js";
  import { SHORT, columns, ROWS } from "./billingModel.js";
  let { st, busy = false, canSwitch = false, onBuy = () => {}, onSwitch = () => {} } = $props();
  const cols = $derived(columns(st)), rows = $derived(ROWS(st));
  const cur = $derived(st?.plan?.ended ? "free" : (SHORT[st?.plan?.key] ?? "free"));
  const isSub = $derived(["pro", "payg"].includes(cur));
  const proPriced = $derived(st?.upgrade?.plan != null);
  let narrow = $state(false);
  onMount(() => { const m = matchMedia("(max-width: 719px)"); narrow = m.matches; const f = (e) => (narrow = e.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); });
  /** the one action under a column, or null */
  function action(c) {
    if (c.current) return { kind: "current" };
    if (c.short === "free") return isSub && !st.plan.cancelsAt && st.billing?.canManage ? { kind: "cancel" } : null;
    if (canSwitch && ((cur === "pro" && c.short === "payg") || (cur === "payg" && c.short === "pro"))) return { kind: "switch", to: c.short };
    if (isSub && c.short === "lifetime" && st.billing?.canManage) return { kind: "switch", to: "lifetime" };   // 21 Oct 2026: Lifetime from a running plan, with the unused time credited
    if (st?.billing?.canUpgrade && (c.short !== "pro" || proPriced)) return { kind: "buy", plan: c.short };
    return null;
  }
  const label = (c, a) => a.kind === "switch" ? (c.short === "pro" ? t("Switch to Pro") : c.short === "lifetime" ? t("Switch to Lifetime") : t("Switch to Pay as you go")) : t("Choose {plan}", { plan: c.name });
</script>
{#snippet cell(c, f)}
  {#if f === "price"}<span class="main" data-testid="price-{c.short}">{c.price.main}</span>{#if c.price.sub}<span class="unit"> {c.price.sub}</span>{/if}{#if c.price.note}<span class="note">{c.price.note}</span>{/if}
  {:else if f === "plays"}{#if c.plays}<span class="yes"><Icon name="check" size={16} /><span class="sr-only">{t("Included")}</span></span>{:else}<span class="no" aria-hidden="true">—</span><span class="sr-only">{t("Not included")}</span>{/if}
  {:else}{c[f]}{/if}
{/snippet}
{#snippet act(c)}
  {@const a = action(c)}
  {#if a?.kind === "current"}<span class="you" data-testid="compare-current">{t("Your plan")}</span>
  {:else if a?.kind === "switch"}<button class="btn" disabled={busy} onclick={() => onSwitch(a.to)} data-testid="compare-switch-{c.short}">{label(c, a)}</button>
  {:else if a?.kind === "buy"}<button class="btn" disabled={busy} onclick={() => onBuy(a.plan)} data-testid="buy-{c.short}">{label(c, a)}</button>
  {:else if a?.kind === "cancel"}<a class="btn quiet text-sm" href="/billing/cancel" data-testid="compare-cancel">{t("Cancel {plan}", { plan: st.plan.name })}</a>{/if}
{/snippet}
<section aria-label={t("Compare plans")} data-testid="billing-plans">
  <h2 class="head">{t("Compare plans")}</h2>
  {#if !narrow}
    <div class="cmp-wrap">
      <table class="cmp">
        <caption class="sr-only">{t("Compare plans")}</caption>
        <thead><tr><td></td>
          {#each cols as c (c.key)}<th scope="col" class:cur={c.current} data-testid="plan-{c.short}" data-current={c.current ? "true" : undefined}>
            {#if c.current}<span class="tag">{t("Your plan")}</span>{/if}
            <span class="hd"><PlanPiece plan={c.short} size={46} glow={c.current} testid="plan-piece-{c.short}" /><span class="nm">{c.name}</span></span></th>{/each}</tr></thead>
        <tbody>
          {#each rows as [lab, f, hint] (f)}<tr><th scope="row">{lab}{#if hint}<span class="hint">{hint}</span>{/if}</th>{#each cols as c (c.key)}<td class:cur={c.current}>{@render cell(c, f)}</td>{/each}</tr>{/each}
          <tr class="acts"><th scope="row"><span class="sr-only">{t("Action")}</span></th>{#each cols as c (c.key)}<td class:cur={c.current} class="last">{@render act(c)}</td>{/each}</tr>
        </tbody>
      </table>
    </div>
  {:else}
    <div class="stack">
      {#each cols as c (c.key)}
        <details class="card" class:cur={c.current} open={c.current} data-testid="plan-{c.short}" data-current={c.current ? "true" : undefined}>
          <summary><PlanPiece plan={c.short} size={40} still testid="plan-piece-{c.short}" /><span class="nm">{c.name}</span>{#if c.current}<span class="tag">{t("Your plan")}</span>{/if}<span class="pr">{c.price.main}<span class="unit"> {c.price.sub}</span></span></summary>
          <dl>{#each rows as [lab, f] (f)}{#if f !== "price"}<div><dt>{lab}</dt><dd>{@render cell(c, f)}</dd></div>{/if}{/each}</dl>
          {#if c.price.note}<p class="note">{c.price.note}</p>{/if}
          <div class="mt-3">{@render act(c)}</div>
        </details>
      {/each}
    </div>
  {/if}
  {#if st?.words}
    <p class="mt-3 max-w-prose text-sm text-mute" data-testid="compare-footnote">{st.words.footnote}</p>
    <p class="mt-1 max-w-prose text-sm text-mute" data-testid="compare-example">{st.words.costExample.text}</p>
  {/if}
  <p class="mt-3 max-w-prose text-sm text-mute" data-testid="billing-switch-note">{t("Moving up starts the new plan today with a fresh allowance, and the unused part of what you already paid is credited against it. Moving down waits for the end of the period you paid for. Cancelling keeps your plan to the end of that period.")}</p>
  <a class="mt-2 inline-block py-1 text-sm text-brand" href={EXPLORE_PRO_URL} target="_blank" rel="noopener">{t("Compare the plans on the pricing page")} →</a>
</section>
<style>
  .hint { display: block; font-weight: 400; font-size: 12px; color: var(--faint); margin-top: 2px; }
  .head { font-size: 17px; font-weight: 600; letter-spacing: -.01em; margin-bottom: 12px; }
  .cmp-wrap { border: 1px solid var(--line); border-radius: 14px; background: var(--card); overflow: hidden; }
  .cmp { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 14.5px; }
  .cmp thead td { width: 19%; }
  .cmp th, .cmp td { padding: 13px 18px; text-align: left; vertical-align: middle; border-top: 1px solid var(--line); }
  .cmp thead th, .cmp thead td { border-top: 0; vertical-align: bottom; padding-top: 18px; }
  .cmp tbody th { font-weight: 500; color: var(--mute); width: 19%; }
  .cmp thead th { font-weight: 600; position: relative; }
  .cmp .cur { background: color-mix(in srgb, var(--brand) 6%, var(--card)); }
  .cmp thead th.cur { box-shadow: inset 0 2px 0 var(--brand); }
  .hd { display: flex; align-items: center; gap: 10px; } .nm { font-size: 16px; }
  .tag { display: inline-block; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; color: var(--brand); background: var(--brand-soft); border-radius: 999px; padding: 1px 8px; margin-bottom: 6px; }
  .main { font-size: 18px; font-weight: 600; letter-spacing: -.01em; } .unit { color: var(--mute); font-size: 13px; margin-left: 4px; } .note { display: block; margin-top: 3px; font-size: 12px; color: var(--mute); }
  .yes { color: var(--ok); display: inline-flex; } .no { color: var(--faint); }
  .acts th, .acts td { padding-top: 16px; padding-bottom: 18px; } .you { font-weight: 600; color: var(--brand); }
  .stack { display: grid; gap: 10px; }
  .card { border: 1px solid var(--line); border-radius: 12px; background: var(--card); padding: 4px 14px 14px; }
  .card.cur { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 6%, var(--card)); }
  .card summary { display: flex; align-items: center; gap: 10px; min-height: 52px; cursor: pointer; list-style: none; }
  .card summary::-webkit-details-marker { display: none; }
  .card summary .pr { margin-left: auto; font-weight: 600; text-align: right; } .card .tag { margin: 0; }
  .card dl > div { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); font-size: 14px; } .card dt { color: var(--mute); } .card dd { text-align: right; font-weight: 500; }
</style>
