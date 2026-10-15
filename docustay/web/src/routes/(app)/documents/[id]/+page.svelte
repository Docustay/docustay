<script>
  import Success from "$lib/fx/Success.svelte";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import { cardTable } from "$lib/ui/cardTable.js";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import { live } from "$lib/live.js";
  let shared = $state(null);
  async function shareLink() { const r = await api("/api/documents/pdf/download-link", { method: "POST", body: { instanceId: trk.leadId, days: 7 } }); if (r.ok) shared = r.json; else alert(r.error ?? t("The link could not be made.")); }
  import TeamPicker from "$lib/TeamPicker.svelte";
  import { onMount, onDestroy } from "svelte";
  // On a phone the events run down the page: laid out in a row, only the first two fit and the rest sit off the right edge.
  let phone = $state(false);
  onMount(() => { const m = matchMedia("(max-width: 640px)"); phone = m.matches; const on = (e) => (phone = e.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on); });
  import { DOC_CHANGED } from "$lib/chat/chat.svelte.js";
  import { chatBridge } from "$lib/chat/bridge.js";
  import { page } from "$app/state";
  import { goto, replaceState } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { when } from "$lib/docs.js";
  import { toast } from "$lib/ui/toast.js";
  import Icon from "$lib/ui/Icon.svelte"; import DetailHeader from "$lib/ui/DetailHeader.svelte"; import MetaGrid from "$lib/ui/MetaGrid.svelte"; import Timeline from "$lib/ui/Timeline.svelte"; import Tabs from "$lib/ui/Tabs.svelte"; import StatusChip from "$lib/ui/StatusChip.svelte"; import { activityText } from "$lib/activityText.js";
  let tabNow = $state("people"), emails = $state(null);
  const toneOf = (x) => (/declin|reject|bounc|cancel/i.test(x) ? "bad" : /signed|complet|agreed|approved/i.test(x) ? "ok" : /open|view/i.test(x) ? "info" : "mute");
  const tone = $derived(trk?.status === "completed" ? "ok" : ["declined", "voided"].includes(trk?.status) ? "bad" : trk?.status === "expired" ? "warn" : "info");
  const remindable = $derived((trk?.parties ?? []).filter((p) => p.canRemind && !p.inPerson));
  const nodes = $derived((() => { const ev = (trk?.timeline ?? []).slice(-5).map((e) => ({ title: activityText(e, { short: true }), detail: e.who ?? "", at: e.at, tone: toneOf(e.text) })); if (trk && ["sent", "in_progress", "ready"].includes(trk.status)) ev.push({ title: t("Waiting"), detail: "", tone: "info", live: true }); return ev; })());
  async function remindAll() { for (const p of remindable) await api("/api/documents/pdf/remind", { method: "POST", body: { instanceId: trk.leadId, partyId: p.id } }); note = t("Reminders sent."); await load(); }
  async function loadEmails() { const r = await api(`/api/documents/email-events?limit=50&documentId=${encodeURIComponent(id)}`); const d = r.ok ? (r.json?.data ?? r.json) : { emails: [] }; emails = d.emails ?? []; }
  const id = page.params.id;
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
  // Run 7: a cancelled, declined or expired document starts again as a NEW draft (same file, fields, people and message); the old one and its dead links stay as they are
  let againBusy = $state(false);
  async function sendAgain() { againBusy = true; note = null; const r = await api("/api/documents/pdf/send-again", { method: "POST", body: { instanceId: trk.leadId ?? id } }); againBusy = false; if (r.ok) await goto(`/documents/${r.json.instanceId}/edit?again=1`); else note = r.error ?? t("That did not work."); }
  async function act(path, body, msg) { note = null; const r = await api(path, { method: "POST", body }); note = r.ok ? msg : (r.error ?? t("That did not work.")); if (r.ok) await load(); return r; }
  async function signNow(p) { const r = await api("/api/documents/pdf/sign-now", { method: "POST", body: { instanceId: trk.leadId, partyId: p.id } }); const url = r.json?.presented; if (r.ok && url) window.open(url.replace(/^https?:\/\/[^/]+/, location.origin), "_blank", "noopener"); else note = r.error ?? t("Could not open the signing screen."); }
</script>
<svelte:head><title>{trk?.title ?? draft?.title ?? t("Document")} · Docustay</title></svelte:head>
<a href="/documents" class="text-sm text-mute no-underline hover:text-ink">{t("← All documents")}</a>
{#if problem}<p class="mt-4 text-bad" role="alert">{problem}</p>
{:else if draft}
  <h1 class="mt-3 text-2xl font-bold tracking-tight">{draft.title}</h1>
  {#if draft.scheduledSendAt}<p class="mt-2 text-mute" data-testid="draft-scheduled">{t("Scheduled to be emailed on {when}. Nothing has gone to anybody yet.", { when: new Date(draft.scheduledSendAt).toLocaleString() })}</p>
  {:else}<p class="mt-2 text-mute">{t("This is a draft. Nothing has gone to anybody.")}</p>{/if}
  <div class="mt-5 flex gap-3"><a class="btn primary" href="/documents/{id}/edit">{draft.scheduledSendAt ? t("Change the schedule") : t("Set up and send")}</a>
    {#if draft.scheduledSendAt}<button class="btn" data-testid="draft-unschedule" onclick={async () => { if (await ask(t("Cancel the scheduled send? The document stays a draft."))) { const o = { ...(draft.sendOptions ?? {}) }; delete o.send_at; const r = await api("/api/documents/pdf/save", { method: "POST", body: { instanceId: id, sendOptions: o } }); if (r.ok) await load(); else note = r.error ?? t("That did not work."); } }}>{t("Cancel the scheduled send")}</button>{/if}
    <button class="btn" onclick={async () => { if (await ask(t("Discard this draft? The uploaded file is removed."))) { await api("/api/documents/pdf/discard", { method: "POST", body: { instanceId: id } }); await goto("/documents"); } }}>{t("Discard draft")}</button></div>
{:else if trk}
  <DetailHeader title={trk.title} label={t("Document")} icon="file-text">
    {#snippet chips()}{#if trk.test}<span class="chip warn" data-testid="test-chip">{t("Test")}</span>{/if}<TeamPicker kind="document" id={trk.leadId} current={trk.team?.teamId} /><span class="text-[13px] text-mute" data-testid="track-progress">{t("{signed} of {total} signed", { signed: trk.progress.signed, total: trk.progress.of })}</span>{/snippet}
    {#snippet actions()}
      {#if trk.actions.download}<a class="btn" href="/api/documents/pdf/{trk.id}/signed.pdf" onclick={async (e) => { e.preventDefault(); const r = await fetch(`/api/documents/pdf/${trk.id}/signed.pdf`, { credentials: "same-origin" }); if (r.ok) { const u = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = u; a.download = `${trk.title ?? "document"} (signed).pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); } else toast(t("The signed copy is still being prepared. Try again in a minute or two."), "info"); }} data-testid="track-download"><Icon name="download" size={15} />{t("Download")}</a>{/if}
      {#if trk.actions.void && !voiding}<button class="btn" onclick={() => (voiding = true)} data-testid="track-void">{t("Cancel document")}</button>{/if}
      {#if ["voided", "declined", "expired"].includes(trk.status)}<button class="btn primary" disabled={againBusy} onclick={sendAgain} data-testid="track-send-again">{t("Send it again")}</button>{/if}
      {#if remindable.length}<button class="btn primary" onclick={remindAll} data-testid="track-remind-all"><Icon name="send" size={15} />{t("Remind everyone")}</button>{/if}
    {/snippet}
  </DetailHeader>
  {#if moment === "sent" && trk.parties.some((p) => p.notEmailed)}<div class="notice warn mb-5" role="status" data-testid="moment-sent-not-emailed"><strong>{t("Sent, but not everyone was emailed.")}</strong> {trk.parties.some((p) => p.notEmailed?.reason === "limit_reached") ? t("Today's email limit was reached. Send a reminder after midnight UTC, or give them their link yourself.") : t("An email could not be sent. Check Settings → Email, then send a reminder.")}</div>
  {:else if moment === "sent"}<div class="card mb-5 p-4"><Success art="envelope" title={t("Sent.")} line={trk.parties.filter((p) => p.actionRole !== "cc").length === 1 ? t("They get their own link. You will see here when they open it and sign.") : t("Each person gets their own link. You will see here when they open it and sign.")} testid="moment-sent" /></div>
  {:else if moment === "sealed"}<div class="card mb-5 p-4"><Success art="stamp" stampLabel={t("SEALED")} title={t("Signed by everyone and sealed.")} line={t("The signed copy with its certificate is ready to download.")} testid="moment-sealed" /></div>{/if}
  {#if trk.voidReason}<p class="-mt-3 mb-4 text-sm text-mute">{t("Cancelled: {reason}", { reason: trk.voidReason })}</p>{/if}
  <MetaGrid cols={5} items={[{ label: t("Status"), value: STATUS[trk.status] ?? trk.status, tone: tone }, { label: t("Sent"), value: trk.sentAt ? when(trk.sentAt) : "—" }, { label: t("Expires"), value: trk.expiresAt && trk.status !== "completed" ? when(trk.expiresAt) : "—" }, { label: t("Team"), value: trk.team?.name ?? t("None") }, { label: t("ID"), value: trk.id, mono: true, copy: true }]} />
  <p data-testid="track-status" class="sr-only">{STATUS[trk.status] ?? trk.status}</p>
  <h2 class="mb-2 mt-8 font-mono text-[11px] uppercase tracking-wider text-faint">{t("Document events")}</h2>
  <div class="overflow-x-auto"><Timeline horizontal={!phone} items={nodes} /></div>
  <ol class="sr-only" data-testid="track-timeline">{#each trk.timeline as e}<li>{activityText(e)}{e.who ? ` — ${e.who}` : ""}</li>{/each}</ol>
  {#if voiding}<div class="mt-4 space-y-2 rounded-xl border border-line p-4"><p class="text-sm">{t("Nobody will be able to sign it any more. Tell people why (optional):")}</p><input class="field" bind:value={reason} aria-label={t("Reason")} />
    <div class="flex gap-2"><button class="btn primary" onclick={async () => { await act("/api/documents/pdf/void", { instanceId: trk.leadId, reason }, t("Cancelled.")); voiding = false; }} data-testid="track-void-confirm">{t("Cancel the document")}</button><button class="btn" onclick={() => (voiding = false)}>{t("Keep it")}</button></div></div>{/if}
  <div class="mt-8"><Tabs items={[{ value: "people", label: t("People") }, { value: "document", label: t("Document") }, { value: "emails", label: t("Emails") }, { value: "audit", label: t("Audit log") }]} bind:value={tabNow} label={t("Document details")} testid="doc-detail-tabs" onchange={(v) => v === "emails" && loadEmails()} /></div>
  {#if note}<p class="mt-3 text-sm" role="status" data-testid="track-note">{note}</p>{/if}
  <div class="mt-4">
  {#if tabNow === "people"}
      <div class="overflow-x-auto rounded-xl border border-line bg-card"><table use:cardTable class="card-table w-full min-w-[480px] text-left text-[14px]"><thead class="text-left font-mono text-[.7rem] uppercase tracking-wider text-faint"><tr><th class="h-9 px-4">{t("Person")}</th><th class="px-4">{t("Role")}</th><th class="px-4">{t("Status")}</th><th class="px-4"></th></tr></thead>
        <tbody>{#each trk.parties as p (p.id)}
          <tr class="border-t border-line align-top" data-testid="track-party" data-status={p.status}>
            <td class="px-4 py-3">{#if edit?.id === p.id}<div class="flex flex-wrap gap-2"><input class="field !w-40 !py-1.5" bind:value={edit.name} aria-label={t("Name")} /><input class="field !w-52 !py-1.5" type="email" bind:value={edit.email} aria-label={t("Email")} /><button class="btn primary !py-1.5" onclick={async () => { await act("/api/documents/pdf/reassign", { instanceId: trk.leadId, partyId: p.id, name: edit.name, email: edit.email }, t("Saved — a new link was sent.")); edit = null; }}>Save</button><button class="btn !py-1.5" onclick={() => (edit = null)}>Cancel</button></div>
              {:else}<span class="font-medium">{p.name}</span><br /><span class="text-xs text-mute">{p.email ?? t("signs on this device")}</span>{/if}</td>
            <td class="px-4 py-3 text-mute">{p.seatLabel && p.actionRole === "signer" ? p.seatLabel : (ROLE[p.actionRole] ?? p.actionRole)}</td>
            <td class="px-4 py-3"><StatusChip tone={p.status === "signed" || p.status === "approved" ? "ok" : p.status === "declined" || p.status === "bounced" || p.status === "rejected" ? "bad" : p.status === "viewed" || p.status === "awaiting_payment" ? "info" : "mute"}>{p.linkExpired ? t("Link expired") : p.status === "bounced" ? t("Email bounced") : ({ signed: t("Signed"), pending: t("Pending"), waiting: t("Waiting"), declined: t("Declined"), viewed: t("Viewed"), sent: t("Sent"), approved: t("Approved"), rejected: t("Rejected"), cancelled: t("Cancelled"), closed: t("Not needed"), awaiting_payment: t("Waiting to pay") })[p.status] ?? p.status[0].toUpperCase() + p.status.slice(1)}</StatusChip>
              <div class="mt-1 text-xs text-mute">{p.completedAt ? when(p.completedAt) : p.viewedAt ? t("Opened {date}", { date: when(p.viewedAt) }) : p.notEmailed ? (p.notEmailed.reason === "limit_reached" ? t("Not emailed: today's email limit was reached") : t("Not emailed: the email could not be sent")) : p.waiting ? t("Has the link") : p.status === "pending" ? t("Not up yet") : ""}{p.declineReason ? ` — “${p.declineReason}”` : ""}</div>
              {#if p.group}<div class="mt-1 text-xs text-mute" data-testid="track-group">{p.status === "closed" && p.closedBy ? t("{name} signed for the group", { name: p.closedBy }) : t("Group: {name}", { name: p.group })}</div>{/if}
              {#if p.witness}<div class="mt-1 text-xs text-mute" data-testid="track-witness">{t("Witnessed by {name}", { name: p.witness })}</div>{/if}</td>
            <td class="whitespace-nowrap px-4 py-3 text-right">
              {#if p.canRemind && !p.inPerson}<button class="btn !py-1.5" onclick={() => act("/api/documents/pdf/remind", { instanceId: trk.leadId, partyId: p.id }, t("Reminder sent to {name}.", { name: p.name }))}>{t("Remind now")}</button>{/if}
              {#if p.canRemind && p.inPerson}<button class="btn !py-1.5" onclick={() => signNow(p)}>{t("Sign now")}</button>{/if}
              {#if p.canReassign && edit?.id !== p.id}<button class="btn !py-1.5" onclick={() => (edit = { id: p.id, name: p.name, email: p.email ?? "" })}>{p.status === "bounced" ? t("Fix email") : t("Change")}</button>{/if}</td></tr>{/each}</tbody></table></div>
  {:else if tabNow === "document"}
      <div class="flex flex-wrap gap-2">
        {#if trk.actions.download}<a class="btn" href="/api/documents/pdf/{trk.id}/evidence.zip">{t("Evidence package (zip)")}</a>{#if trk.actions.share ?? true}<button class="btn" onclick={shareLink}>{t("Share a download link")}</button>{/if}{:else}<p class="text-mute">{trk.status === "declined" ? t("This document was declined, so there is no signed copy.") : trk.status === "voided" ? t("This document was cancelled, so there is no signed copy.") : trk.status === "expired" ? t("This document expired before everyone signed, so there is no signed copy.") : t("The signed copy appears here once everyone has signed.")}</p>{/if}
      </div>
      {#if shared}<p class="mt-3 break-all rounded-lg border border-line bg-tint p-3 font-mono text-[12.5px]" data-testid="share-link">{shared.url ?? shared.link ?? JSON.stringify(shared)}</p>{/if}
  {:else if tabNow === "emails"}
      {#if emails === null}<PageSkel kind="list" rows={2} testid="emails-loading" />{:else if !emails.length}<p class="text-mute">{t("No email about this document yet.")}</p>{:else}
      <div class="overflow-x-auto rounded-xl border border-line bg-card"><table use:cardTable class="card-table w-full text-left text-[14px]"><thead class="font-mono text-[.7rem] uppercase tracking-wider text-faint"><tr><th class="h-9 px-4">{t("When")}</th><th class="px-4">{t("To")}</th><th class="px-4">{t("Message")}</th><th class="px-4">{t("Status")}</th></tr></thead><tbody>{#each emails as m}<tr class="border-t border-line"><td class="px-4 py-2.5 text-mute">{when(m.createdAt ?? m.at)}</td><td class="px-4 py-2.5">{m.to}</td><td class="px-4 py-2.5">{m.kind}</td><td class="px-4 py-2.5"><StatusChip tone={m.status === "delivered" ? "ok" : m.status === "bounced" || m.status === "failed" ? "bad" : "info"}>{m.status}</StatusChip></td></tr>{/each}</tbody></table></div>{/if}
  {:else}
      <div class="mb-3"><a class="btn" href="/api/documents/pdf/{trk.id}/audit.csv"><Icon name="download" size={15} />{t("Audit log (CSV)")}</a></div>
      <Timeline items={trk.timeline.map((e) => ({ title: activityText(e), detail: e.who ?? "", at: e.at, tone: toneOf(e.text) }))} />
  {/if}
  </div>
{:else}<div class="mt-6"><PageSkel kind="detail" testid="doc-loading" /></div>{/if}
