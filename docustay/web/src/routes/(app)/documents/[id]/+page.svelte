<script>
  import Page from "$lib/ui/Page.svelte";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import Envelope from "$lib/fx/Envelope.svelte";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import { live } from "$lib/live.js";
  let shared = $state(null);
  async function shareLink() { const r = await api("/api/documents/pdf/download-link", { method: "POST", body: { instanceId: trk.leadId, days: 7 } }); if (r.ok) shared = r.json; else alert(r.error ?? t("The link could not be made.")); }
  import TeamPicker from "$lib/TeamPicker.svelte";
  import { onMount, onDestroy } from "svelte";
  import { DOC_CHANGED } from "$lib/chat/chat.svelte.js";
  import { chatBridge } from "$lib/chat/bridge.js";
  import { page } from "$app/state";
  import { goto, replaceState } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { when } from "$lib/docs.js";
  import { toast } from "$lib/ui/toast.js";
  import Icon from "$lib/ui/Icon.svelte"; import PageHeader from "$lib/ui/PageHeader.svelte"; import Tabs from "$lib/ui/Tabs.svelte"; import StatusChip from "$lib/ui/StatusChip.svelte"; import { activityText } from "$lib/activityText.js";
  import Ribbon from "$lib/ui/Ribbon.svelte"; import Seal from "$lib/ui/Seal.svelte"; import Avatar from "$lib/ui/Avatar.svelte"; import CopyButton from "$lib/ui/CopyButton.svelte"; import RelativeTime from "$lib/ui/RelativeTime.svelte";
  let tabNow = $state("document"), emails = $state(null), emailsFailed = $state(null);
  const toneOf = (x) => (/declin|reject|bounc|cancel/i.test(x) ? "bad" : /signed|complet|agreed|approved/i.test(x) ? "ok" : /open|view/i.test(x) ? "info" : "mute");
  const tone = $derived(trk?.status === "completed" ? "ok" : ["declined", "voided"].includes(trk?.status) ? "bad" : trk?.status === "expired" ? "warn" : "info");
  // the ribbon is read from the document's own facts: its state, who opened it, how many seats have signed, who is next, when it was sealed
  const facts = $derived(trk ? { state: trk.state, sentAt: trk.sentAt, openedCount: trk.parties.filter((p) => p.viewedAt).length, signedCount: trk.progress.signed, totalCount: trk.progress.of, executedAt: trk.executedAt, nextName: trk.parties.find((p) => p.waiting)?.name ?? null, openedBy: [...trk.parties].filter((p) => p.viewedAt).sort((a, b) => String(b.viewedAt).localeCompare(String(a.viewedAt)))[0]?.name ?? null } : {});
  const sealedAt = $derived(trk?.executedAt ? new Date(trk.executedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
  const PREVIEW_PAGES = [1, 2, 3, 4, 5, 6];   // the picture route answers nothing past the last page and that page is hidden
  let hidePage = $state({});   // a page number the server has no picture for (past the last page) is hidden, not shown broken
  const stat = (p) => ({ signed: t("Signed"), pending: t("Pending"), waiting: t("Waiting"), declined: t("Declined"), viewed: t("Viewed"), sent: t("Sent"), approved: t("Approved"), rejected: t("Rejected"), cancelled: t("Cancelled"), closed: t("Not needed"), awaiting_payment: t("Waiting to pay") })[p.status] ?? (p.status ?? "")[0]?.toUpperCase() + (p.status ?? "").slice(1);
  const partyTone = (p) => (p.status === "signed" || p.status === "approved" ? "ok" : p.status === "declined" || p.status === "bounced" || p.status === "rejected" ? "bad" : p.status === "viewed" || p.status === "awaiting_payment" ? "info" : isCopy(p) && trk?.state === "executed" ? "ok" : "mute");
  // R13-D513: a person who only gets a copy has nothing to do, so "Pending" is wrong for them: they wait for the finished document, then they have had their copy
  const isCopy = (p) => p.actionRole === "cc" && p.status === "pending";
  const partyWord = (p) => (p.linkExpired ? t("Link expired") : p.status === "bounced" ? t("Email bounced") : isCopy(p) ? (trk?.state === "executed" ? t("Copy sent") : t("Gets a copy")) : stat(p));
  const partyNote = (p) => (p.completedAt ? when(p.completedAt) : p.viewedAt ? t("Opened {date}", { date: when(p.viewedAt) }) : p.notEmailed ? (p.notEmailed.reason === "limit_reached" ? t("Not emailed: today's email limit was reached") : t("Not emailed: the email could not be sent")) : p.waiting ? t("Has the link") : p.status === "pending" && !isCopy(p) ? t("Not up yet") : isCopy(p) ? t("Gets the signed copy when it is finished") : "") + (p.declineReason ? ` — “${p.declineReason}”` : "");
  const remindable = $derived((trk?.parties ?? []).filter((p) => p.canRemind && !p.inPerson));
  // R13-D442: the toast said "Reminders sent." even when the email limit stopped every one; it now says what really went out
  async function remindAll() {
    let sent = 0, tried = 0;
    for (const p of remindable) { const r = await api("/api/documents/pdf/remind", { method: "POST", body: { instanceId: trk.leadId, partyId: p.id } }); tried += 1; if (r.ok) sent += Number((r.json?.data ?? r.json)?.sent ?? 0); }
    note = sent === tried ? t("Reminders sent.") : sent === 0 ? t("No reminder was emailed. Each person below says why.") : t("{sent} of {tried} reminders were emailed. Each person below says why the others were not.", { sent, tried });
    await load();
  }
  async function loadEmails() { const r = await api(`/api/documents/email-events?limit=50&documentId=${encodeURIComponent(id)}`); emailsFailed = r.ok ? null : (r.error ?? t("The emails could not be loaded.")); const d = r.ok ? (r.json?.data ?? r.json) : { emails: [] }; emails = d.emails ?? []; }   // R13-D448: a failed read is not "no email"
  const id = $derived(page.params.id);   // R13-D162: opening another document from search keeps this page mounted; follow the address
  const STATUS = $derived({ draft: t("Draft"), ready: t("Ready"), sent: t("Sent"), in_progress: t("In progress"), completed: t("Completed"), declined: t("Declined"), expired: t("Expired"), voided: t("Cancelled") });
  const TONE = { completed: "bg-ok-bg text-ok", declined: "bg-bad-bg text-bad", voided: "bg-bad-bg text-bad", expired: "bg-warn-bg text-warn" };
  const ROLE = $derived({ signer: t("signs"), approver: t("approves"), viewer: t("views"), assistant: t("fills in details"), cc: t("gets a copy") });
  let moment = $state(null);   // Run 7 part 8: "sent" right after Send, "sealed" when the last person signs while this page is open
  let trk = $state(null), draft = $state(null), problem = $state(null), note = $state(null), voiding = $state(false), reason = $state(""), edit = $state(null), timer;
  // Run 9: Scribe knows which document this page shows (it said "no document open" here, so "explain this clause" had nothing to read)
  $effect(() => { const d = trk ?? draft; if (!d) return; return chatBridge.setPage({ documentId: id, title: d.title ?? null }); });
  async function load() {
    const r = await api(`/api/documents/pdf/${id}/track`);
    if (r.ok && r.json.status === "draft") { const d = await api(`/api/documents/pdf/${id}`); if (d.ok) { draft = d.json; trk = null; problem = null; return; } }
    if (r.ok) { if (trk && trk.status !== "completed" && r.json.status === "completed") moment = "sealed"; else if (moment === "sent" && ["cancelled", "voided", "declined", "expired"].includes(r.json.status)) moment = null;   // R10-32: "Sent. They get their own link" must not stay on a document that has since been cancelled
      trk = r.json; draft = null; problem = null; return; }
    if (r.status === 404 || r.status === 409 || r.status === 400) { const d = await api(`/api/documents/pdf/${id}`); if (d.ok) { draft = d.json; return; } }
    problem = r.error ?? t("That document could not be loaded.");
  }
  onMount(() => { if (new URLSearchParams(location.search).get("sent") === "1") { moment = "sent"; try { replaceState(location.pathname, {}); } catch { /* the router is not ready: the address keeps ?sent=1, harmless */ } } load(); const stopLive = live(["documents"], load); timer = setInterval(load, 60000); const h = (e) => { if (e.detail?.documentId === id) load(); }; window.addEventListener(DOC_CHANGED, h); return () => { stopLive(); window.removeEventListener(DOC_CHANGED, h); }; });
  onDestroy(() => clearInterval(timer));
  let shownId = page.params.id;
  $effect(() => { const cur = page.params.id; if (cur === shownId) return; shownId = cur; trk = null; draft = null; moment = null; note = null; problem = null; load(); });
  // Run 7: a cancelled, declined or expired document starts again as a NEW draft (same file, fields, people and message); the old one and its dead links stay as they are
  let againBusy = $state(false);
  async function sendAgain() { againBusy = true; note = null; const r = await api("/api/documents/pdf/send-again", { method: "POST", body: { instanceId: trk.leadId ?? id } }); againBusy = false; if (r.ok) await goto(`/documents/${r.json.instanceId}/edit?again=1`); else note = r.error ?? t("That did not work."); }
  async function act(path, body, msg) { note = null; const r = await api(path, { method: "POST", body }); note = r.ok ? msg : (r.error ?? t("That did not work.")); if (r.ok) await load(); return r; }
  async function signNow(p) { const r = await api("/api/documents/pdf/sign-now", { method: "POST", body: { instanceId: trk.leadId, partyId: p.id } }); const url = r.json?.presented; if (r.ok && url) window.open(url.replace(/^https?:\/\/[^/]+/, location.origin), "_blank", "noopener"); else note = r.error ?? t("Could not open the signing screen."); }
</script>
<svelte:head><title>{trk?.title ?? draft?.title ?? t("Document")} · Docustay</title></svelte:head>
{#if problem}<PageHeader title={t("Document")} back={{ href: "/documents", label: t("All documents") }} /><p class="text-bad" role="alert">{problem}</p>
{:else if draft}
  <PageHeader title={draft.title} back={{ href: "/documents", label: t("All documents") }} />
  <Page type="split" asideWidth="24rem" testid="doc-draft" sticky={false}>
    <div class="paper-ground rounded-md p-4 sm:p-8"><div class="mx-auto max-w-[560px]"><img src="/api/documents/pdf/{id}/thumb.png?w=480" alt={t("First page of {title}", { title: draft.title })} class="w-full rounded-[3px] border bg-white" style="border-color: var(--paper-sheet-line)" onerror={(e) => (e.currentTarget.style.display = "none")} /></div></div>
    {#snippet aside()}<div>
      <h2 class="paper-serif text-[26px] font-medium leading-tight tracking-[-0.01em]">{draft.title}</h2>
      {#if draft.scheduledSendAt}<p class="mt-2 text-[13px] text-mute" data-testid="draft-scheduled">{t("Scheduled to be emailed on {when}. Nothing has gone to anybody yet.", { when: new Date(draft.scheduledSendAt).toLocaleString() })}</p>
      {:else}<p class="mt-2 text-[13px] text-mute">{t("This is a draft. Nothing has gone to anybody.")}</p>{/if}
      <dl class="mt-5 border-t border-line text-[13px]">
        <div class="flex items-baseline justify-between gap-4 border-b border-line py-2.5"><dt class="text-mute">{t("Who signs")}</dt><dd class="min-w-0 truncate text-right">{(draft.parties ?? []).filter((p) => (p.action_role ?? "signer") === "signer" && p.name).map((p) => p.name).join(", ") || t("Nobody yet")}</dd></div>
        <div class="flex items-baseline justify-between gap-4 border-b border-line py-2.5"><dt class="text-mute">{t("Fields")}</dt><dd>{(draft.body?.fields ?? []).length || t("None yet")}</dd></div>
      </dl>
      <div class="mt-6 flex flex-wrap items-center gap-2"><a class="btn primary final" href="/documents/{id}/edit">{draft.scheduledSendAt ? t("Change the schedule") : t("Set up and send")}</a>
        {#if draft.scheduledSendAt}<button class="btn" data-testid="draft-unschedule" onclick={async () => { if (await ask(t("Cancel the scheduled send? The document stays a draft."))) { const o = { ...(draft.sendOptions ?? {}) }; delete o.send_at; const r = await api("/api/documents/pdf/save", { method: "POST", body: { instanceId: id, sendOptions: o } }); if (r.ok) await load(); else note = r.error ?? t("That did not work."); } }}>{t("Cancel the scheduled send")}</button>{/if}
        <button class="btn danger" onclick={async () => { if (await ask(t("Discard this draft? The uploaded file is removed."))) { await api("/api/documents/pdf/discard", { method: "POST", body: { instanceId: id } }); await goto("/documents"); } }}>{t("Discard draft")}</button></div>
    </div>{/snippet}
  </Page>
{:else if trk}
  <PageHeader title={trk.title} back={{ href: "/documents", label: t("All documents") }}>
    {#snippet actions()}
      {#if ["voided", "declined", "expired"].includes(trk.status)}<button class="btn primary" disabled={againBusy} onclick={sendAgain} data-testid="track-send-again">{t("Send it again")}</button>{/if}
      {#if remindable.length}<button class="btn primary" onclick={remindAll} data-testid="track-remind-all"><Icon name="send" size={14} />{t("Remind everyone")}</button>{/if}
      {#if trk.actions.void && !voiding}<button class="btn" onclick={() => (voiding = true)} data-testid="track-void">{t("Cancel document")}</button>{/if}
      {#if trk.actions.download}<a data-sveltekit-reload class="btn {trk.status === 'completed' ? 'primary' : ''}" href="/api/documents/pdf/{trk.id}/signed.pdf" onclick={async (e) => { e.preventDefault(); const r = await fetch(`/api/documents/pdf/${trk.id}/signed.pdf`, { credentials: "same-origin" }); if (r.ok) { const u = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = u; a.download = `${trk.title ?? "document"} (signed).pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); } else toast(t("The signed copy is still being prepared. Try again in a minute or two."), "info"); }} data-testid="track-download"><Icon name="download" size={14} />{trk.status === "completed" ? t("Download signed copy") : t("Download")}</a>{/if}
    {/snippet}
  </PageHeader>
  <div class="-mt-2 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
    <StatusChip tone={tone}>{STATUS[trk.status] ?? trk.status}</StatusChip>
    {#if trk.test}<span class="chip warn" data-testid="test-chip">{t("Test")}</span>{/if}
    <span class="text-mute" data-testid="track-progress">{t("{signed} of {total} signed", { signed: trk.progress.signed, total: trk.progress.of })}</span>
    <TeamPicker kind="document" id={trk.leadId} current={trk.team?.teamId} />
  </div>
  {#if moment === "sent" && trk.parties.some((p) => p.notEmailed)}<div class="notice warn mb-5" role="status" data-testid="moment-sent-not-emailed"><strong>{t("Sent, but not everyone was emailed.")}</strong> {trk.parties.some((p) => p.notEmailed?.reason === "limit_reached") ? t("Today's email limit was reached. Send a reminder after midnight UTC, or give them their link yourself.") : t("An email could not be sent. Check Settings → Email, then send a reminder.")}</div>
  {:else if moment === "sent"}<div class="mb-5 flex items-center gap-4 border-b border-line pb-4" data-testid="moment-sent"><span data-testid="moment-sent-envelope" aria-hidden="true"><Envelope /></span><div><p class="text-[13px] font-medium">{t("Sent.")}</p><p class="text-[13px] text-mute">{trk.parties.filter((p) => p.actionRole !== "cc").length === 1 ? t("They get their own link. You will see here when they open it and sign.") : t("Each person gets their own link. You will see here when they open it and sign.")}</p></div></div>
  {:else if moment === "sealed"}<div class="mb-5 flex items-center gap-4 border-b border-line pb-4" data-testid="moment-sealed"><Seal size={56} stamp /><div><p class="text-[13px] font-medium">{t("Signed by everyone and sealed.")}</p><p class="text-[13px] text-mute">{t("The signed copy with its certificate is ready to download.")}</p></div></div>{/if}
  {#if trk.voidReason}<p class="mb-4 text-[13px] text-mute">{t("Cancelled: {reason}", { reason: trk.voidReason })}</p>{/if}
  <p data-testid="track-status" class="sr-only">{STATUS[trk.status] ?? trk.status}</p>
  <div class="mb-6 border-b border-line pb-6"><Ribbon full {facts} /></div>
  <ol class="sr-only" data-testid="track-timeline">{#each trk.timeline as e}<li>{activityText(e)}{e.who ? ` — ${e.who}` : ""}</li>{/each}</ol>
  {#if voiding}<div class="mb-5 space-y-2 border-b border-line pb-4"><p class="text-[13px]">{t("Nobody will be able to sign it any more. Tell people why (optional):")}</p><input class="field" bind:value={reason} aria-label={t("Reason")} />
    <div class="flex gap-2"><button class="btn danger" onclick={async () => { await act("/api/documents/pdf/void", { instanceId: trk.leadId, reason }, t("Cancelled.")); voiding = false; }} data-testid="track-void-confirm">{t("Cancel the document")}</button><button class="btn" onclick={() => (voiding = false)}>{t("Keep it")}</button></div></div>{/if}
  <Tabs items={[{ value: "document", label: t("Document") }, { value: "activity", label: t("Activity"), count: trk.timeline.length }, { value: "emails", label: t("Emails") }, { value: "audit", label: t("Audit log") }]} bind:value={tabNow} label={t("Document details")} testid="doc-detail-tabs" onchange={(v) => v === "emails" && loadEmails()} />
  {#if note}<p class="mt-3 text-[13px]" role="status" data-testid="track-note">{note}</p>{/if}
  <div class="mt-5">
  {#if tabNow === "document"}
    <Page type="split" asideWidth="24rem" asideLabel={t("People, activity and details")}>
      <div class="paper-ground rounded-md p-4 sm:p-8" data-testid="doc-paper">
        <div class="mx-auto grid max-w-[640px] gap-4">
          {#each PREVIEW_PAGES as n (n)}{#if !hidePage[n]}<div class="relative">
            <img src="/api/documents/pdf/{trk.id}/thumb.png?w=720&page={n}&v={trk.progress.signed}-{trk.timeline.length}" alt={t("Page {n} of {title}", { n, title: trk.title })} class="w-full rounded-[3px] border bg-white" style="border-color: var(--paper-sheet-line)" loading={n === 1 ? "eager" : "lazy"} onerror={() => (hidePage[n] = true)} />
            {#if n === 1 && trk.status === "completed"}<span class="pointer-events-none absolute bottom-6 right-6"><Seal size={96} stamp date={sealedAt} /></span>{/if}
          </div>{/if}{/each}
        </div>
      </div>
      {#snippet aside()}<div class="min-w-0 space-y-7">
        <section aria-labelledby="people-h" data-testid="track-people">
          <h2 id="people-h" class="mb-1 text-[13px] font-semibold">{t("People")}</h2>
          <ul class="border-t border-line">{#each trk.parties as p (p.id)}
            <li class="border-b border-line py-2.5" data-testid="track-party" data-status={p.status}>
              {#if edit?.id === p.id}<div class="flex flex-wrap gap-2"><input class="field !w-36" bind:value={edit.name} aria-label={t("Name")} /><input class="field !w-48" type="email" bind:value={edit.email} aria-label={t("Email")} /><button class="btn primary" onclick={async () => { await act("/api/documents/pdf/reassign", { instanceId: trk.leadId, partyId: p.id, name: edit.name, email: edit.email }, t("Saved — a new link was sent.")); edit = null; }}>{t("Save")}</button><button class="btn" onclick={() => (edit = null)}>{t("Cancel")}</button></div>
              {:else}<div class="flex items-start gap-2.5"><Avatar name={p.name} /><div class="min-w-0 flex-1"><p class="truncate text-[13px] font-medium">{p.name}</p><p class="truncate text-[12px] text-mute">{p.email ?? t("signs on this device")} · {p.seatLabel && p.actionRole === "signer" ? p.seatLabel : (ROLE[p.actionRole] ?? p.actionRole)}</p></div><StatusChip tone={partyTone(p)}>{partyWord(p)}</StatusChip></div>
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[30px] text-[12px] text-mute"><span>{partyNote(p)}</span>
                  {#if p.canRemind && !p.inPerson}<button class="text-link underline" onclick={() => act("/api/documents/pdf/remind", { instanceId: trk.leadId, partyId: p.id }, t("Reminder sent to {name}.", { name: p.name }))}>{t("Remind now")}</button>{/if}
                  {#if p.canRemind && p.inPerson}<button class="text-link underline" onclick={() => signNow(p)}>{t("Sign now")}</button>{/if}
                  {#if p.canReassign}<button class="text-link underline" onclick={() => (edit = { id: p.id, name: p.name, email: p.email ?? "" })}>{p.status === "bounced" ? t("Fix email") : t("Change")}</button>{/if}</div>
                {#if p.group}<p class="mt-1 pl-[30px] text-[12px] text-mute" data-testid="track-group">{p.status === "closed" && p.closedBy ? t("{name} signed for the group", { name: p.closedBy }) : t("Group: {name}", { name: p.group })}</p>{/if}
                {#if p.witness}<p class="mt-1 pl-[30px] text-[12px] text-mute" data-testid="track-witness">{t("Witnessed by {name}", { name: p.witness })}</p>{/if}{/if}
            </li>{/each}</ul>
        </section>
        <section aria-labelledby="act-h"><h2 id="act-h" class="mb-1 text-[13px] font-semibold">{t("Activity")}</h2>
          <ol class="border-t border-line">{#each [...trk.timeline].reverse().slice(0, 5) as e}<li class="flex gap-3 border-b border-line py-2 text-[12.5px]"><span class="mono-id w-[88px] shrink-0 pt-px"><RelativeTime value={e.at} /></span><span class="min-w-0 flex-1">{activityText(e, { short: true })}{#if e.who} <span class="text-mute">· {e.who}</span>{/if}</span></li>{/each}</ol>
          {#if trk.timeline.length > 5}<button class="mt-2 text-[12.5px] text-link underline" onclick={() => (tabNow = "activity")}>{t("See all {n}", { n: trk.timeline.length })}</button>{/if}
        </section>
        <section aria-labelledby="det-h"><h2 id="det-h" class="mb-1 text-[13px] font-semibold">{t("Details")}</h2>
          <dl class="border-t border-line text-[13px]">
            <div class="flex items-baseline justify-between gap-4 border-b border-line py-2"><dt class="text-mute">{t("Sent")}</dt><dd>{trk.sentAt ? when(trk.sentAt) : "—"}</dd></div>
            <div class="flex items-baseline justify-between gap-4 border-b border-line py-2"><dt class="text-mute">{t("Expires")}</dt><dd>{trk.expiresAt && trk.status !== "completed" ? when(trk.expiresAt) : "—"}</dd></div>
            <div class="flex items-baseline justify-between gap-4 border-b border-line py-2"><dt class="text-mute">{t("Team")}</dt><dd>{trk.team?.name ?? t("None")}</dd></div>
            <div class="flex items-center justify-between gap-3 border-b border-line py-2"><dt class="text-mute">{t("ID")}</dt><dd class="flex min-w-0 items-center gap-1"><span class="mono-id truncate" data-testid="doc-id">{trk.id}</span><CopyButton value={trk.id} /></dd></div>
            {#if trk.fingerprint}<div class="flex items-center justify-between gap-3 border-b border-line py-2"><dt class="text-mute">{t("Fingerprint")}</dt><dd class="flex min-w-0 items-center gap-1"><span class="mono-id truncate" title={trk.fingerprint} data-testid="doc-fingerprint">{trk.fingerprint.slice(0, 16)}…</span><CopyButton value={trk.fingerprint} /></dd></div>{/if}
          </dl>
          {#if trk.actions.download}<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]"><a data-sveltekit-reload class="text-link underline" href="/api/documents/pdf/{trk.id}/evidence.zip">{t("Evidence package (zip)")}</a>{#if trk.actions.share ?? true}<button class="text-link underline" onclick={shareLink}>{t("Share a download link")}</button>{/if}{#if trk.fingerprint}<a class="text-link underline" href="/verify" target="_blank" rel="noopener">{t("Check this copy")}</a>{/if}</div>
          {:else}<p class="mt-3 text-[13px] text-mute">{trk.status === "declined" ? t("This document was declined, so there is no signed copy.") : trk.status === "voided" ? t("This document was cancelled, so there is no signed copy.") : trk.status === "expired" ? t("This document expired before everyone signed, so there is no signed copy.") : t("The signed copy appears here once everyone has signed.")}</p>{/if}
          {#if shared}<p class="mt-3 break-all border border-line bg-tint p-3 font-mono text-[12px]" data-testid="share-link">{shared.url ?? shared.link ?? JSON.stringify(shared)}</p>{/if}
        </section>
      </div>{/snippet}
    </Page>
  {:else if tabNow === "activity"}
    <ol class="border-t border-line">{#each [...trk.timeline].reverse() as e}<li class="flex gap-4 border-b border-line py-2.5 text-[13px]"><span class="mono-id w-[150px] shrink-0 pt-px">{when(e.at)}</span><span class="min-w-0 flex-1">{activityText(e)}{#if e.who} <span class="text-mute">· {e.who}</span>{/if}</span></li>{/each}</ol>
  {:else if tabNow === "emails"}
    {#if emails === null}<PageSkel kind="list" rows={2} testid="emails-loading" />{:else if emailsFailed}<p class="text-sm" role="alert" data-testid="emails-failed">{emailsFailed} <button class="btn quiet" onclick={loadEmails} data-testid="emails-retry">{t("Try again")}</button></p>{:else if !emails.length}<p class="text-mute">{t("No email about this document yet.")}</p>{:else}
    <div class="rows" role="table"><div class="rows-head grid grid-cols-[150px_1fr_1fr_110px] gap-3" role="row"><span>{t("When")}</span><span>{t("To")}</span><span>{t("Message")}</span><span>{t("Status")}</span></div>
      {#each emails as m}<div class="rows-row grid grid-cols-[150px_1fr_1fr_110px] gap-3 text-[13px]" role="row"><span class="text-mute">{when(m.createdAt ?? m.at)}</span><span class="truncate">{m.to}</span><span class="truncate">{m.kind}</span><span><StatusChip tone={m.status === "delivered" ? "ok" : m.status === "bounced" || m.status === "failed" ? "bad" : "info"}>{m.status}</StatusChip></span></div>{/each}</div>{/if}
  {:else}
    <div class="mb-3"><a data-sveltekit-reload class="btn" href="/api/documents/pdf/{trk.id}/audit.csv"><Icon name="download" size={14} />{t("Audit log (CSV)")}</a></div>
    <ol class="border-t border-line">{#each trk.timeline as e}<li class="flex gap-4 border-b border-line py-2.5 text-[13px]"><span class="mono-id w-[150px] shrink-0 pt-px">{when(e.at)}</span><span class="min-w-0 flex-1">{activityText(e)}{#if e.who} <span class="text-mute">· {e.who}</span>{/if}{#if e.kind === "changes_requested"} <span class="text-mute">— “{e.detail?.message ?? ""}”</span>{/if}</span></li>{/each}</ol>
  {/if}
  </div>
{:else}<div class="mt-6"><PageSkel kind="detail" testid="doc-loading" /></div>{/if}
