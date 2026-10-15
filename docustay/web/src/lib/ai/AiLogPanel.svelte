<script>
  import { cardTable } from "$lib/ui/cardTable.js";
  import { live } from "$lib/live.js";
  // The AI activity log: what the assistant proposed and what people did with it. Counts only, never what anyone typed.
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { AGENT_DEFAULT_NAME } from "$lib/flow/flowDefinition.js";
  let rows = $state(null), error = $state(""), agent = $state(AGENT_DEFAULT_NAME);
  const BASE = "/api/documents/engine";
  const loadL = async () => {
    const [r, s] = await Promise.all([api(`${BASE}/ai/log?limit=50`), api(`${BASE}/ai/status`)]);
    if (!r.ok) { error = r.error ?? ""; rows = []; return; }
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
</script>

<div class="card p-4 grid gap-3" data-testid="ai-log">
  <div>
    <div class="font-semibold">{t("What the assistant did")}</div>
    <div class="text-mute">{t("Every proposal and every accept or reject. It records what happened, never what anyone typed.")}</div>
  </div>
  {#if rows === null}<div class="text-mute">{t("Loading")}…</div>
  {:else if error}<div class="notice warn" role="alert">{error}</div>
  {:else if !rows.length}<div class="text-mute" data-testid="ai-log-empty">{t("Nothing yet. When someone uses the assistant, it shows here.")}</div>
  {:else}
    <div class="overflow-x-auto"><table use:cardTable class="card-table w-full" style="min-width:520px"><thead><tr><th class="text-left">{t("When")}</th><th class="text-left">{t("Who")}</th><th class="text-left">{t("What")}</th><th class="text-left">{t("Model")}</th><th class="text-right">{t("Tokens")}</th></tr></thead>
      <tbody>{#each rows as a (a.id)}<tr data-testid="ai-log-row"><td>{when(a.at)}</td><td>{a.by ?? "—"}</td><td>{what(a)}{#if a.note}<div class="text-mute">{a.note}</div>{/if}</td><td>{a.model ?? "—"}</td><td class="text-right">{(a.inputTokens ?? 0) + (a.outputTokens ?? 0) || "—"}</td></tr>{/each}</tbody></table></div>
  {/if}
</div>
