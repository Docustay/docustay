<script>
  import { live } from "$lib/live.js";
  // The AI activity log: what the assistant proposed and what people did with it. Counts only, never what anyone typed.
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { AGENT_DEFAULT_NAME } from "$lib/flow/flowDefinition.js";
  let rows = $state(null), error = $state(""), agent = $state(AGENT_DEFAULT_NAME);
  const BASE = "/api/documents/engine";
  const loadL = async () => {
    const [r, s] = await Promise.all([api(`${BASE}/ai/log?limit=50`), api(`${BASE}/ai/status`)]);
    if (!r.ok) { error = r.error || t("The assistant log could not be loaded."); rows = []; return; }   // R13-D448: an empty error fell through to "Nothing yet"
    error = "";
    rows = (r.json?.data ?? r.json).actions ?? [];
    const st = s.ok ? (s.json?.data ?? s.json) : null; if (st?.agentName) agent = st.agentName;
  };
  $effect(() => { loadL(); return live(["ai", "settings"], loadL); });
  const what = (a) => {
    const n = a.counts?.changes ?? a.counts?.applied ?? a.counts?.blocks;
    // D-016: a plain chat answer is not "a draft": a chat turn is worded by what it did (answered, or proposed changes)
    if (a.action === "proposed" && a.kind === "chat") return (a.counts?.proposals ?? 0) > 0 ? t("{name} proposed {n} changes", { name: agent, n: a.counts.proposals }) : t("{name} answered a question", { name: agent });
    if (a.action === "proposed") return a.kind === "edit" ? t("{name} proposed {n} changes", { name: agent, n: a.counts?.applied ?? 0 }) : t("{name} wrote a draft", { name: agent });
    if (a.action === "failed") return t("{name} could not finish", { name: agent });
    if (a.action === "accepted") return t("{n} accepted", { n: n ?? 0 });
    if (a.action === "rejected") return t("{n} rejected", { n: n ?? 0 });
    return t("{n} undone", { n: n ?? 0 });
  };
  const when = (iso) => whenText(iso);
  const tone = (a) => (a.action === "failed" ? "bad" : a.action === "accepted" ? "ok" : a.action === "rejected" || a.action === "undone" ? "warn" : "mute");
  const tokens = (a) => (a.inputTokens ?? 0) + (a.outputTokens ?? 0);
  const nf = new Intl.NumberFormat();
</script>

<section data-testid="ai-log">
  <h2 class="font-semibold">{t("What the assistant did")}</h2>
  <p class="mt-1 text-sm text-mute">{t("Every proposal and every accept or reject. It records what happened, never what anyone typed.")}</p>
  {#if rows === null}<p class="mt-4 text-mute">{t("Loading")}…</p>
  {:else if error}<div class="notice warn mt-4" role="alert" data-testid="ai-log-failed">{error} <button class="btn quiet" onclick={loadL} data-testid="ai-log-retry">{t("Try again")}</button></div>
  {:else if !rows.length}<p class="mt-4 text-mute" data-testid="ai-log-empty">{t("Nothing yet. When someone uses the assistant, it shows here.")}</p>
  {:else}
    <ul class="ai-rows mt-4">{#each rows as a (a.id)}
      <li class="ai-row" data-testid="ai-log-row">
        <span class="ai-dot {tone(a)}" aria-hidden="true"></span>
        <span class="min-w-0">
          <span class="block text-[14px] font-medium">{what(a)}</span>
          {#if a.note}<span class="block text-sm text-mute">{a.note}</span>{/if}
          <span class="ai-meta"><span>{when(a.at)}</span>{#if a.by}<span>{a.by}</span>{/if}{#if a.model}<span class="font-mono">{a.model}</span>{/if}</span>
        </span>
        <span class="ai-tok">{#if tokens(a)}{nf.format(tokens(a))} <span class="text-faint">{t("tokens")}</span>{:else}—{/if}</span>
      </li>{/each}</ul>
  {/if}
</section>
<style>
  .ai-rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .ai-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .75rem; align-items: start; padding: .7rem .25rem; border-bottom: 1px solid var(--line); }
  .ai-row:hover { background: var(--tint); }
  .ai-dot { width: 8px; height: 8px; margin-top: .45rem; border-radius: 999px; background: var(--faint); } .ai-dot.ok { background: var(--ok, #1f8a4c); } .ai-dot.bad { background: var(--bad, #c0352b); } .ai-dot.warn { background: var(--warn, #b7791f); }
  .ai-meta { display: flex; flex-wrap: wrap; margin-top: .15rem; font-size: 12px; color: var(--faint); }
  .ai-meta > span:not(:first-child)::before { content: "·"; margin: 0 .45em; }
  .ai-tok { font-size: 13px; color: var(--mute); font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: .1rem; }
</style>
