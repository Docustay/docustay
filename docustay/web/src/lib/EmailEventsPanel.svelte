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
  let rows = $state(null), status = $state(""), hasNext = $state(false), page = $state(1), per = $state(50), busy = $state(false), cursors = [null];   // cursors[n - 1] opens page n
  /** Open page n (1 by default: choosing what to show, a new page size or a live update starts again from the newest mail). */
  async function load(n = 1) {
    busy = true; if (n === 1) cursors = [null];
    const q = new URLSearchParams({ limit: String(per) }); if (status) q.set("status", status); if (cursors[n - 1]) q.set("cursor", cursors[n - 1]);
    const r = await api(`/api/documents/email-events?${q}`); const d = r.ok ? (r.json?.data ?? r.json) : { emails: [], nextCursor: null }; busy = false;
    rows = d.emails; page = n; cursors[n] = d.nextCursor; hasNext = !!d.nextCursor;
  }
  onMount(() => { load(); return live(["email"], () => { if (page === 1) load(1); }); });
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
  <div class="flex flex-wrap items-center gap-3"><label class="flex items-center gap-2 text-sm"><span class="text-mute">{t("Show")}</span>
    <select class="field !min-h-9 !w-auto" bind:value={status} onchange={() => load(1)}>{#each STATUSES as s}<option value={s}>{s || t("everything")}</option>{/each}</select></label><button class="btn !py-1.5" onclick={csv} disabled={!rows?.length} data-testid="email-events-csv">{t("Download CSV")}</button></div>
  {#if rows === null}<p class="text-sm text-mute">{t("Loading…")}</p>
  {:else}
    <DataTable {columns} {rows} testid="email-events-table" caption={t("Email log")}>
      {#snippet cell(r, c)}
        {#if c.key === "when"}<RelativeTime value={r.createdAt} class="text-mute" />
        {:else if c.key === "to"}<span>{r.to}</span>{#if r.test}<span class="chip mute ml-2">{t("test")}</span>{/if}
        {:else if c.key === "kind"}<span class="font-mono text-xs">{r.kind}</span>
        {:else if c.key === "subject"}<a class="inline-block min-h-6 py-0.5 underline" href={r.documentId ? `/documents/${r.documentId}` : undefined}>{r.subject ?? "—"}</a>
        {:else}<StatusChip tone={tone(r.status)}>{r.status}</StatusChip>{#if r.error}<span class="ml-2 text-xs text-mute">{r.error}</span>{/if}{/if}
      {/snippet}
      {#snippet empty()}<EmptyState title={t("No email yet")} line={t("When a document is sent, its emails show up here.")} />{/snippet}
    </DataTable>
    <CursorPager {page} {per} {hasNext} {busy} onprev={() => load(page - 1)} onnext={() => load(page + 1)} onsize={(n) => { per = n; load(1); }} testid="email-events-pager" />
  {/if}
</div>
