<script>
  // Run 10 (R10-22): a signer opening, signing or declining has no workspace account: say what it is, not "The system"
  const SIGNER_TOPICS = new Set(["documents.document.opened", "documents.document.signed", "documents.document.declined"]);
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  // The admin audit log: what happened in this workspace, newest first. Owners and admins only (the server decides).
  let events = $state(null), problem = $state(null), q = $state("");
  const loadA = async () => { const r = await api("/api/developer/audit-log?limit=500"); if (r.ok) events = r.json.events ?? []; else problem = r.status === 403 ? t("The audit log is for owners and admins.") : (r.error ?? t("The log could not be loaded.")); };
  onMount(() => { loadA(); return live(["team", "keys", "settings", "templates", "documents", "webhooks"], loadA); });
  const shown = $derived((events ?? []).filter((e) => !q.trim() || `${e.description} ${e.actorName ?? ""} ${e.section}`.toLowerCase().includes(q.trim().toLowerCase())));
  const when = (x) => whenText(x);
  function csv() {
    const cell = (v) => { const s = String(v ?? ""); return /^[=+\-@]/.test(s) || /[",\n]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` : s; };
    const rows = [["when", "who", "what", "area", "reason"], ...shown.map((e) => [new Date(e.at).toISOString(), e.actorName ?? "system", e.description, e.section, e.reason ?? ""])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" })); a.download = "audit-log.csv"; a.click();
  }
</script>
{#if problem}<p class="text-bad" role="alert">{problem}</p>{:else if !events}<p class="text-mute">{t("Loading…")}</p>{:else}
<div class="max-w-4xl space-y-3" data-testid="audit-panel">
  <div class="flex flex-wrap items-center gap-2"><input class="field !w-64 !py-1.5" placeholder={t("Search the log")} bind:value={q} aria-label={t("Search the log")} /><button class="btn ml-auto" onclick={csv}>{t("Download CSV")}</button></div>
  <ul class="divide-y divide-line rounded-xl border border-line">
    {#each shown as e (e.id)}<li class="px-4 py-2 text-sm"><span class="font-medium">{e.actorName ?? (SIGNER_TOPICS.has(e.topic) ? t("A signer") : t("The system"))}</span> {e.description}{#if e.topic === "documents.setting.changed" && e.detail?.key} <span class="ml-1 text-mute" data-testid="audit-setting">— {String(e.detail.key).replace(/[._]/g, " ")}</span>{/if}{#if e.reason} <span class="ml-1 text-mute">— {e.reason}</span>{/if}<span class="block text-xs text-mute">{when(e.at)} · {e.section}</span></li>{:else}<li class="px-4 py-3 text-mute">{t("Nothing matches.")}</li>{/each}
  </ul>
</div>{/if}
