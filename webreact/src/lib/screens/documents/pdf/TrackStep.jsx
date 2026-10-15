// TrackStep — STEP 7 · TRACK (QUEUE §23.4.7) and STEP 8 · DONE (§23.4.8): the timeline, each person's state with Remind / Fix email / Change person, void, and — once everyone has signed — the sealed copy.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { useWrite } from "@/lib/documents/ports.js";

const TONE = { signed: "good", approved: "good", rejected: "bad", declined: "bad", bounced: "bad", viewed: "info", pending: "neutral" };
const STATUS_TEXT = { draft: "Draft", ready: "Ready", sent: "Sent", in_progress: "In progress", completed: "Completed", declined: "Declined", expired: "Expired", voided: "Voided" };
const ROLE_NOUN = { signer: "signs", approver: "approves", viewer: "views", assistant: "fills in details", cc: "gets a copy" };
const when = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

export default function TrackStep({ docId, onChanged }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);
  const [edit, setEdit] = useState(null);       // { id, name, email }
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(null);
  const [qr, setQr] = useState(null);                // { name, img } — the sign-now link as a QR code, for a phone to scan
  const remind = useWrite("POST /api/documents/pdf/remind");
  const reassign = useWrite("POST /api/documents/pdf/reassign");
  const voidIt = useWrite("POST /api/documents/pdf/void");
  const signNow = useWrite("POST /api/documents/pdf/sign-now");
  const extend = useWrite("POST /api/documents/pdf/extend");
  const refund = useWrite("POST /api/documents/pdf/refund-payment");
  const [refunding, setRefunding] = useState(null);      // { id, reason, amount } — a refund being typed
  const [ext, setExt] = useState(null);           // { id, days } — giving one person more time
  const load = () => api.pdfTrack(docId).then((r) => { setT(r); setErr(null); }).catch(setErr);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, msg) => { setNote(null); try { await fn(); setNote(msg); await load(); onChanged?.(); } catch (e) { setNote(e.message); } };
  if (err) return <p className="text-bad" role="alert" data-testid="track-error">This could not be loaded ({err.message}).</p>;
  if (!t) return <p className="text-mute">Loading…</p>;
  const a = t.actions;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" data-testid="track-step" data-status={t.status}>
      <section className="space-y-4" aria-label="People">
        <div className="flex flex-wrap items-center gap-3"><StatusBadge label={STATUS_TEXT[t.status] ?? t.status} tone={t.status === "completed" ? "good" : ["declined", "voided", "expired"].includes(t.status) ? "bad" : "info"} />
          <span className="text-meta text-mute" data-testid="track-progress">{t.progress.signed} of {t.progress.of} signed</span>
          {t.scheduledSendAt && <span className="text-meta text-mute">Scheduled for {when(t.scheduledSendAt)}</span>}
          {t.expiresAt && t.status !== "completed" && <span className="text-meta text-mute">Expires {when(t.expiresAt)}</span>}</div>
        {t.voidReason && <p className="m-0 text-meta text-mute">Voided: {t.voidReason}</p>}
        <table className="w-full border-collapse" data-testid="track-parties"><thead><tr>{["Person", "Status", ""].map((h) => <th key={h} className="h-9 border-b border-line bg-surface-sunken px-3 text-left text-caption font-medium text-mute">{h}</th>)}</tr></thead>
          <tbody>{t.parties.map((p) => (
            <tr key={p.id} data-testid="track-party" data-status={p.status}>
              <td className="border-b border-line-soft px-3 py-2 text-ui">{edit?.id === p.id ? <div className="flex flex-wrap gap-1.5"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} aria-label="Name" className="w-40" /><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.currentTarget.value })} aria-label="Email" className="w-52" data-testid="track-edit-email" />
                <Button size="sm" onClick={() => act(() => reassign.run({ body: { instanceId: t.leadId, partyId: p.id, name: edit.name, email: edit.email } }), "Saved — a new link was sent.").then(() => setEdit(null))} data-testid="track-edit-save">Save and resend</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
                : <><span className="font-medium">{p.name}</span><br /><span className="text-caption text-mute">{p.email ?? "signs on this device"} · {ROLE_NOUN[p.actionRole] ?? p.actionRole}{p.expiresAt && !p.finished ? ` · by ${when(p.expiresAt)}` : ""}</span></>}</td>
              <td className="border-b border-line-soft px-3 py-2 text-ui"><StatusBadge label={p.linkExpired ? "Link expired" : p.status === "bounced" ? "Email bounced" : p.finished && p.actionRole === "viewer" ? "Viewed" : p.waiting && p.status === "pending" ? "Waiting" : p.status} tone={p.linkExpired ? "bad" : p.finished && p.actionRole === "viewer" ? "good" : TONE[p.status] ?? "neutral"} />
                <div className="text-caption text-mute">{p.completedAt ? when(p.completedAt) : p.viewedAt ? `Opened ${when(p.viewedAt)}` : p.waiting ? "Has the link" : p.status === "pending" ? "Not up yet" : ""}{p.declineReason ? ` — “${p.declineReason}”` : ""}</div></td>
              <td className="border-b border-line-soft px-3 py-2 text-right text-ui whitespace-nowrap">
                {p.canRemind && !p.inPerson && <Button size="sm" variant="ghost" disabled={remind.busy} onClick={() => act(() => remind.run({ body: { instanceId: t.leadId, partyId: p.id } }), `Reminder sent to ${p.name}.`)} data-testid="track-remind">Remind now</Button>}
                {p.canRemind && p.inPerson && <Button size="sm" variant="ghost" onClick={async () => { try { const r = await signNow.run({ body: { instanceId: t.leadId, partyId: p.id } }); window.open(r.presented, "_blank", "noopener"); } catch (e) { setNote(e.message); } }} data-testid="track-sign-now">Sign now</Button>}
                {p.canRemind && p.inPerson && <Button size="sm" variant="ghost" onClick={async () => { try { const r = await signNow.run({ body: { instanceId: t.leadId, partyId: p.id } }); setQr({ name: p.name, img: await QRCode.toDataURL(r.presented, { margin: 1, width: 240 }) }); } catch (e) { setNote(e.message); } }} data-testid="track-qr">Show QR</Button>}
                {p.canExtend && (ext?.id === p.id
                  ? <span className="inline-flex items-center gap-1"><select className="h-8 rounded border border-line bg-surface px-1 text-ui" value={ext.days} onChange={(e) => setExt({ ...ext, days: Number(e.currentTarget.value) })} aria-label={`Extend ${p.name} by`} data-testid="track-extend-days">{[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}</select><Button size="sm" disabled={extend.busy} onClick={() => act(() => extend.run({ body: { instanceId: t.leadId, partyId: p.id, days: ext.days } }), `${p.name} has more time${p.waiting ? " — a new link was sent" : ""}.`).then(() => setExt(null))} data-testid="track-extend-go">Extend</Button><Button size="sm" variant="ghost" onClick={() => setExt(null)}>Cancel</Button></span>
                  : <Button size="sm" variant={p.linkExpired ? "outline" : "ghost"} onClick={() => setExt({ id: p.id, days: 7 })} data-testid="track-extend">{p.linkExpired ? "Give more time" : "Extend"}</Button>)}
                {p.canReassign && edit?.id !== p.id && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: p.id, name: p.name, email: p.email ?? "" })} data-testid="track-change">{p.status === "bounced" ? "Fix email" : "Change"}</Button>}
              </td></tr>))}</tbody></table>
        {t.payments?.length > 0 && (
          <div className="rounded border border-line bg-surface p-3" data-testid="track-payments">
            <p className="m-0 mb-1 text-ui font-medium">Payments</p>
            <ul className="m-0 list-none space-y-2 p-0">{t.payments.map((p) => (
              <li key={p.id} className="text-ui" data-testid="track-payment" data-status={p.status}>
                <span className="font-medium">{p.person}</span> — {p.label} <StatusBadge label={p.status === "paid" ? "Paid" : p.status === "pending" ? "Not paid yet" : p.status === "refunded" ? "Refunded" : "Partly refunded"} tone={p.status === "pending" ? "neutral" : p.status === "paid" ? "good" : "info"} />
                {p.refundedLabel && <span className="ml-2 text-caption text-mute">{p.refundedLabel} refunded</span>}
                {p.paidAt && <span className="ml-2 text-caption text-mute">{when(p.paidAt)}</span>}
                {p.canRefund && refunding?.id !== p.id && !refund.hidden && <Button size="sm" variant="ghost" className="ml-2" onClick={() => setRefunding({ id: p.id, reason: "", amount: "" })} data-testid="track-refund">Refund…</Button>}
                {refunding?.id === p.id && (
                  <div className="mt-2 flex flex-wrap items-end gap-2" data-testid="track-refund-form">
                    <Input className="w-[110px]" inputMode="decimal" placeholder="All" value={refunding.amount} onChange={(e) => setRefunding({ ...refunding, amount: e.currentTarget.value })} aria-label="Refund amount (empty = all that is left)" />
                    <Input className="min-w-[200px] flex-1" placeholder="Why it is being refunded" value={refunding.reason} onChange={(e) => setRefunding({ ...refunding, reason: e.currentTarget.value })} aria-label="Reason for the refund" />
                    <Button size="sm" disabled={refund.busy || !refunding.reason.trim()} onClick={() => act(() => refund.run({ body: { paymentId: p.id, reason: refunding.reason, ...(refunding.amount.trim() ? { amountMinor: Math.round(Number(refunding.amount) * 100) } : {}) } }), "Refunded.").then(() => setRefunding(null))} data-testid="track-refund-confirm">Refund</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRefunding(null)}>Cancel</Button>
                  </div>)}
              </li>))}</ul>
          </div>)}
        {note && <p className="m-0 text-meta text-ink-2" role="status" data-testid="track-note">{note}</p>}
        {qr && <div className="flex items-center gap-4 rounded border border-line bg-surface p-3" data-testid="track-qr-panel"><img src={qr.img} alt={`QR code to sign as ${qr.name}`} width={160} height={160} /><div><p className="m-0 text-ui font-medium">{qr.name} can scan this to sign on their phone</p><p className="m-0 text-meta text-mute">The link works for 2 hours and only once.</p><Button size="sm" variant="ghost" onClick={() => setQr(null)}>Hide</Button></div></div>}
        {t.documents.length > 1 && <ul className="m-0 list-none p-0 text-ui" data-testid="track-documents">{t.documents.map((d) => <li key={d.id}>{d.title} — {d.signed} of {d.of} signed</li>)}</ul>}
        <div className="flex flex-wrap gap-2">
          {a.download && <a className="inline-flex h-9 items-center rounded border border-line bg-surface px-3 text-ui" href={`/api/documents/pdf/${t.id}/signed.pdf`} data-testid="track-download">Download the signed copy</a>}
          {a.download && <a className="inline-flex h-9 items-center rounded border border-line bg-surface px-3 text-ui" href={`/api/documents/pdf/${t.id}/evidence.zip`} data-testid="track-evidence">Evidence package (zip)</a>}
          <a className="inline-flex h-9 items-center rounded border border-line bg-surface px-3 text-ui" href={`/api/documents/pdf/${t.id}/audit.csv`} data-testid="track-audit">Audit log (CSV)</a>
          {a.void && !voiding && <Button variant="outline" size="sm" onClick={() => setVoiding(true)} data-testid="track-void">Cancel this document</Button>}
        </div>
        {voiding && <div className="space-y-2 rounded-card border border-line p-3" data-testid="track-void-form"><p className="m-0 text-ui">Nobody will be able to sign it any more. Tell people why (optional):</p><Input value={reason} onChange={(e) => setReason(e.currentTarget.value)} aria-label="Reason" data-testid="track-void-reason" />
          <div className="flex gap-2"><Button size="sm" disabled={voidIt.busy} onClick={() => act(() => voidIt.run({ body: { instanceId: t.leadId, reason } }), "Cancelled.").then(() => setVoiding(false))} data-testid="track-void-confirm">Cancel the document</Button><Button size="sm" variant="ghost" onClick={() => setVoiding(false)}>Keep it</Button></div></div>}
      </section>
      <section aria-label="Timeline"><h3 className="m-0 mb-2 text-ui font-semibold text-ink">Timeline</h3>
        <ol className="m-0 list-none space-y-2 border-l border-line p-0 pl-4" data-testid="track-timeline">{t.timeline.map((e, i) => <li key={i} className="text-ui" data-kind={e.kind}><span className="font-medium">{e.text}</span>{e.who ? ` — ${e.who}` : ""}<br /><span className="text-caption text-mute">{when(e.at)}</span></li>)}</ol></section>
    </div>
  );
}
