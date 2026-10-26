<script>
  // Run 10 (R10-22): a signer opening, signing or declining has no workspace account: say what it is, not "The system"
  const SIGNER_TOPICS = new Set(["documents.document.opened", "documents.document.signed", "documents.document.declined"]);
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import Pager from "$lib/ui/Pager.svelte";
  // The admin audit log: what happened in this workspace, newest first. Owners and admins only (the server decides).
  let events = $state(null), problem = $state(null), q = $state(""), pageNo = $state(1), from = $state(""), to = $state(""); const PER = 20;
  // R13-D084: a date range is asked of the server (both days included); the search box also matches the document's title
  const loadA = async () => { const qs = new URLSearchParams({ limit: "500" }); if (from) qs.set("from", from); if (to) qs.set("to", to); try { qs.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* UTC days */ } const r = await api(`/api/developer/audit-log?${qs}`); if (r.ok) events = r.json.events ?? []; else problem = r.status === 403 ? t("The audit log is for owners and admins.") : (r.error ?? t("The log could not be loaded.")); };
  onMount(() => { loadA(); return live(["team", "keys", "settings", "templates", "documents", "webhooks"], loadA); });
  const shown = $derived((events ?? []).filter((e) => !q.trim() || `${e.description} ${e.actorName ?? ""} ${e.section} ${e.documentTitle ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const pageRows = $derived(shown.slice((pageNo - 1) * PER, pageNo * PER));
  const when = (x) => whenText(x);
  function csv() {
    const cell = (v) => { const s = String(v ?? ""); return /^[=+\-@]/.test(s) || /[",\n]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` : s; };
    const rows = [["when", "who", "what", "document", "area", "reason"], ...shown.map((e) => [new Date(e.at).toISOString(), e.actorName ?? "system", e.topic === "documents.setting.changed" && e.detail?.key ? `${e.description} (${e.detail.key})` : e.description, e.documentTitle ?? "", e.section, e.reason ?? ""])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" })); a.download = "audit-log.csv"; a.click();
  }
</script>
{#if problem}<p class="text-bad" role="alert" data-testid="audit-failed">{problem} <button class="btn quiet" onclick={() => { problem = null; loadA(); }}>{t("Try again")}</button></p>{:else if !events}<p class="text-mute">{t("Loading…")}</p>{:else}
<div class="space-y-3" data-testid="audit-panel">
  <div class="flex flex-wrap items-center gap-2"><input class="field !w-64 !py-1.5" placeholder={t("Search the log")} bind:value={q} oninput={() => (pageNo = 1)} aria-label={t("Search the log")} /><label class="flex items-center gap-1 text-sm">{t("From")}<input type="date" class="field !w-auto !py-1.5" bind:value={from} max={to || undefined} onchange={() => { pageNo = 1; loadA(); }} data-testid="audit-from" /></label><label class="flex items-center gap-1 text-sm">{t("To")}<input type="date" class="field !w-auto !py-1.5" bind:value={to} min={from || undefined} onchange={() => { pageNo = 1; loadA(); }} data-testid="audit-to" /></label><button class="btn ml-auto" onclick={csv}>{t("Download CSV")}</button></div>
  <ul class="divide-y divide-line rounded-xl border border-line">
    {#each pageRows as e (e.id)}<li class="px-4 py-2 text-sm"><span class="font-medium">{e.actorName ?? (SIGNER_TOPICS.has(e.topic) ? t("A signer") : t("The system"))}</span>{#if e.actorName && e.actorRole} <span class="text-mute" data-testid="audit-role">({t(e.actorRole.charAt(0).toUpperCase() + e.actorRole.slice(1))})</span>{/if} {e.description}{#if e.documentTitle} <a class="inline-block py-1 underline" href={`/documents/${e.subjectId}`} data-testid="audit-document">{e.documentTitle}</a>{/if}{#if e.topic === "documents.setting.changed" && e.detail?.key} <span class="ml-1 text-mute" data-testid="audit-setting">— {String(e.detail.key).replace(/[._]/g, " ")}</span>{/if}{#if e.reason} <span class="ml-1 text-mute">— {e.reason}</span>{/if}<span class="block text-xs text-mute">{when(e.at)} · {e.section}</span></li>{:else}<li class="px-4 py-3 text-mute">{t("Nothing matches.")}</li>{/each}
  </ul>
  <Pager total={shown.length} per={PER} bind:page={pageNo} testid="audit-pager" />
</div>{/if}
