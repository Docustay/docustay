<script>
  import { live } from "$lib/live.js";
  // Developers → Email events: the log of email about this workspace's documents (who, what, and what the mail provider said). Never a general mailbox: only mail about a document.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import DataTable from "$lib/ui/DataTable.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import RelativeTime from "$lib/ui/RelativeTime.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import CursorPager from "$lib/ui/CursorPager.svelte";
  const STATUSES = ["", "sent", "delivered", "bounced", "complained", "failed", "skipped", "paused", "limit_reached"];
  // R13-D404: people read words, not codes (the API and the CSV keep the codes). The daily-limit note is said in this product's words, whatever the mail layer wrote.
  const STATUS_WORDS = { sent: "Sent", delivered: "Delivered", bounced: "Bounced", complained: "Marked as spam", failed: "Failed", skipped: "Not sent", paused: "Paused", limit_reached: "Daily limit reached" };
  const said = (s) => (STATUS_WORDS[s] ? t(STATUS_WORDS[s]) : s);
  const why = (r) => (r.status === "limit_reached" ? t("This workspace reached its daily sending limit. It resets at midnight UTC.") : r.error);
  let failed = $state(null), rows = $state(null), status = $state(""), hasNext = $state(false), page = $state(1), per = $state(50), busy = $state(false), cursors = [null];   // cursors[n - 1] opens page n
  /** Open page n (1 by default: choosing what to show, a new page size or a live update starts again from the newest mail). */
  async function load(n = 1) {
    busy = true; if (n === 1) cursors = [null];
    const q = new URLSearchParams({ limit: String(per) }); if (status) q.set("status", status); if (cursors[n - 1]) q.set("cursor", cursors[n - 1]);
    const r = await api(`/api/documents/email-events?${q}`); busy = false;   // R13-D448: a failed read is not "No email yet"
    if (!r.ok) { failed = r.error ?? t("Email events could not be loaded."); if (rows === null) rows = []; return; }   // a failed page keeps the rows already shown
    failed = null; const d = r.json?.data ?? r.json; rows = d.emails; page = n; cursors[n] = d.nextCursor; hasNext = !!d.nextCursor;
  }
  // R13-D490: after a bounce spike the workspace is paused and its owner must be able to resume from here (the message used to name a Settings, Email screen that does not exist)
  let guard = $state(null), resuming = $state(false), resumeProblem = $state(null);
  async function loadGuard() { const r = await api("/api/documents/email/guard"); guard = r.ok ? (r.json?.data ?? r.json)?.guard ?? null : null; }
  async function resume() { resuming = true; resumeProblem = null; const r = await api("/api/documents/email/resume", { method: "POST", body: {} }); resuming = false; if (!r.ok) { resumeProblem = r.error ?? t("Sending could not be resumed."); return; } await loadGuard(); }
  onMount(() => { load(); loadGuard(); return live(["email"], () => { if (page === 1) load(1); }); });
  const tone = (s) => (s === "delivered" ? "ok" : s === "bounced" || s === "complained" || s === "failed" ? "bad" : s === "sent" ? "info" : "warn");
  // R13-D159: the rows on screen as a CSV (same cell rules as the audit log: a value that starts like a formula is kept as text)
  function csv() {
    const cell = (v) => { const s = String(v ?? ""); return /^[=+\-@]/.test(s) || /[",\n]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` : s; };
    const out = [["when", "to", "message", "subject", "status", "error", "test"], ...(rows ?? []).map((r) => [r.createdAt ? new Date(r.createdAt).toISOString() : "", r.to, r.kind, r.subject ?? "", r.status, r.error ?? "", r.test ? "yes" : ""])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([out.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" })); a.download = "email-events.csv"; a.click();
  }
  const columns = [{ key: "when", label: t("When") }, { key: "to", label: t("To") }, { key: "kind", label: t("Message") }, { key: "subject", label: t("Subject") }, { key: "status", label: t("Status") }];
</script>
<div class=" space-y-4" data-testid="email-events">
  <div><h2 class="text-lg font-semibold">{t("Email events")}</h2>
    <p class="text-sm text-mute">{t("Every email sent about your documents, and what the mail provider said about it. Only mail about a document is ever sent.")}</p></div>
  {#if guard?.paused}<div class="notice bad flex flex-wrap items-center justify-between gap-3" role="alert" data-testid="email-paused">{#if /reported as spam/i.test(String(guard.reason))}<p>{t("Sending is paused for this workspace: {reason}. Email support and we will look at it with you.", { reason: guard.reason })}</p>{:else}<p>{t("Sending is paused for this workspace: {reason}. Clean up the addresses that bounced, then resume sending.", { reason: guard.reason })}</p><button class="btn primary" onclick={resume} disabled={resuming} data-testid="email-resume">{resuming ? t("Resuming…") : t("Resume sending")}</button>{/if}</div>{#if resumeProblem}<p class="text-sm text-bad" role="alert">{resumeProblem}</p>{/if}{/if}
  <div class="flex flex-wrap items-center gap-3"><label class="flex items-center gap-2 text-sm"><span class="text-mute">{t("Show")}</span>
    <select class="field !min-h-9 !w-auto" bind:value={status} onchange={() => load(1)}>{#each STATUSES as s}<option value={s}>{s ? said(s) : t("everything")}</option>{/each}</select></label><button class="btn !py-1.5" onclick={csv} disabled={!rows?.length} data-testid="email-events-csv">{t("Download CSV")}</button></div>
  {#if rows === null}<p class="text-sm text-mute">{t("Loading…")}</p>
  {:else}
    {#if failed}<p class="text-sm" role="alert" data-testid="email-events-failed">{failed} <button class="btn quiet" onclick={() => load(page)}>{t("Try again")}</button></p>{/if}
    <DataTable {columns} {rows} testid="email-events-table" caption={t("Email log")}>
      {#snippet cell(r, c)}
        {#if c.key === "when"}<RelativeTime value={r.createdAt} class="text-mute" />
        {:else if c.key === "to"}<span>{r.to}</span>{#if r.test}<span class="chip mute ml-2">{t("test")}</span>{/if}
        {:else if c.key === "kind"}<span class="font-mono text-xs">{r.kind}</span>
        {:else if c.key === "subject"}<a class="inline-block min-h-6 py-0.5 underline" href={r.documentId ? `/documents/${r.documentId}` : undefined}>{r.subject ?? "—"}</a>
        {:else}<StatusChip tone={tone(r.status)}>{said(r.status)}</StatusChip>{#if why(r)}<span class="ml-2 text-xs text-mute">{why(r)}</span>{/if}{/if}
      {/snippet}
      {#snippet empty()}{#if failed}{:else if status}<EmptyState title={t("No emails with this status")} line={t("Choose everything to see every email.")} />{:else}<EmptyState title={t("No email yet")} line={t("When a document is sent, its emails show up here.")} />{/if}{/snippet}   <!-- R13 F08-144: a filter with no match is not "no email yet" -->
    </DataTable>
    <CursorPager {page} {per} {hasNext} {busy} onprev={() => load(page - 1)} onnext={() => load(page + 1)} onsize={(n) => { per = n; load(1); }} testid="email-events-pager" />
  {/if}
</div>
