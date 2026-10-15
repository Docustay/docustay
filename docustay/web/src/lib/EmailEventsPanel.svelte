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
  const STATUSES = ["", "sent", "delivered", "bounced", "complained", "failed", "skipped", "paused", "limit_reached"];
  let rows = $state(null), cursor = $state(null), status = $state(""), more = $state(false);
  async function load(reset = true) {
    const q = new URLSearchParams({ limit: "50" }); if (status) q.set("status", status); if (!reset && cursor) q.set("cursor", cursor);
    const r = await api(`/api/documents/email-events?${q}`); const d = r.ok ? (r.json?.data ?? r.json) : { emails: [], nextCursor: null };
    rows = reset ? d.emails : [...(rows ?? []), ...d.emails]; cursor = d.nextCursor; more = !!d.nextCursor;
  }
  onMount(() => { load(); return live(["email"], () => load()); });
  const tone = (s) => (s === "delivered" ? "ok" : s === "bounced" || s === "complained" || s === "failed" ? "bad" : s === "sent" ? "info" : "warn");
  const columns = [{ key: "when", label: t("When") }, { key: "to", label: t("To") }, { key: "kind", label: t("Message") }, { key: "subject", label: t("Subject") }, { key: "status", label: t("Status") }];
</script>
<div class="max-w-5xl space-y-4" data-testid="email-events">
  <div><h2 class="text-lg font-semibold">{t("Email events")}</h2>
    <p class="text-sm text-mute">{t("Every email sent about your documents, and what the mail provider said about it. Only mail about a document is ever sent.")}</p></div>
  <label class="flex items-center gap-2 text-sm"><span class="text-mute">{t("Show")}</span>
    <select class="field !min-h-9 !w-auto" bind:value={status} onchange={() => load()}>{#each STATUSES as s}<option value={s}>{s || t("everything")}</option>{/each}</select></label>
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
    {#if more}<button class="btn" onclick={() => load(false)}>{t("Show more")}</button>{/if}
  {/if}
</div>
