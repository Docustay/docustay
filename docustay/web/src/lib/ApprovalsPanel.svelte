<script>
  import { live } from "$lib/live.js";
  // Settings → Developers → Approvals: sends a draft-only API key asked for. A person approves (the draft is sent now, as them) or declines (it stays a draft).
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  import DataTable from "$lib/ui/DataTable.svelte";
  import StatusChip from "$lib/ui/StatusChip.svelte";
  import RelativeTime from "$lib/ui/RelativeTime.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  let rows = $state(null), busy = $state(null), log = $state(null);
  async function load() {
    const [r, a] = await Promise.all([api("/api/documents/approvals"), api("/api/documents/agent-activity")]);
    rows = r.ok ? (r.json?.data?.approvals ?? []) : []; log = a.ok ? (a.json?.data?.entries ?? []) : [];
  }
  onMount(() => { load(); return live(["documents", "keys"], load); });
  async function decide(a, approve) {
    busy = a.id; const r = await api("/api/documents/approvals/decide", { method: "POST", body: { id: a.id, approve } }); busy = null;
    if (!r.ok) { toast(r.error ?? t("That did not save."), "bad"); return; }
    toast(approve ? t("Sent.") : t("Declined. It stays a draft."), "ok"); await load();
  }
  const tone = (s) => (s === "approved" ? "ok" : s === "declined" ? "mute" : s === "failed" ? "bad" : "warn");
  const logColumns = [{ key: "when", label: t("When") }, { key: "key", label: t("Key") }, { key: "what", label: t("What it did") }, { key: "by", label: t("Decided by") }];
  const columns = [{ key: "when", label: t("Asked") }, { key: "doc", label: t("Document") }, { key: "key", label: t("Key") }, { key: "status", label: t("Status") }, { key: "act", label: "" }];
</script>
<div class="max-w-5xl space-y-4" data-testid="approvals">
  <div><h2 class="text-lg font-semibold">{t("Approvals")}</h2>
    <p class="text-sm text-mute">{t("A draft-only key can make documents but cannot send them. When it asks, the request waits here until you approve it or decline it.")}</p></div>
  {#if rows === null}<p class="text-sm text-mute">{t("Loading…")}</p>
  {:else}
    <DataTable {columns} {rows} testid="approvals-table" caption={t("Send requests")}>
      {#snippet cell(r, c)}
        {#if c.key === "when"}<RelativeTime value={r.requestedAt} class="text-mute" />
        {:else if c.key === "doc"}<a class="inline-block min-h-6 py-0.5 underline" href={`/documents/${r.documentId}`}>{r.title ?? t("Untitled")}</a>{#if r.test}<span class="chip mute ml-2">{t("test")}</span>{/if}
        {:else if c.key === "key"}<span>{r.keyName ?? "—"}</span>
        {:else if c.key === "status"}<StatusChip tone={tone(r.status)}>{r.status}</StatusChip>{#if r.decidedBy?.name}<span class="text-mute ml-2">{t("by")} {r.decidedBy.name}</span>{/if}
        {:else if r.status === "pending"}<span class="flex gap-2"><button class="btn primary !min-h-9" disabled={busy === r.id} onclick={() => decide(r, true)} data-testid="approve">{t("Approve and send")}</button><button class="btn quiet !min-h-9" disabled={busy === r.id} onclick={() => decide(r, false)} data-testid="decline">{t("Decline")}</button></span>{/if}
      {/snippet}
      {#snippet empty()}<EmptyState title={t("Nothing waiting")} line={t("When a draft-only key asks to send, it shows up here.")} />{/snippet}
    </DataTable>
    <div class="pt-4"><h3 class="text-base font-semibold">{t("What your keys did")}</h3>
      <p class="text-sm text-mute">{t("Every call a key made and every request it filed, newest first. It records the route and the answer, never what was in the request.")}</p></div>
    <DataTable columns={logColumns} rows={log ?? []} testid="agent-activity" caption={t("Key activity")}>
      {#snippet cell(r, c)}
        {#if c.key === "when"}<RelativeTime value={r.at} class="text-mute" />
        {:else if c.key === "key"}<span>{r.key ?? "—"}</span>
        {:else if c.key === "what"}<span>{r.summary}</span>{#if r.status}<span class="chip mute ml-2">{r.status}</span>{/if}
        {:else}<span>{r.by ?? "—"}</span>{/if}
      {/snippet}
      {#snippet empty()}<EmptyState title={t("Nothing yet")} line={t("Calls made with your keys show up here.")} />{/snippet}
    </DataTable>
  {/if}
</div>
