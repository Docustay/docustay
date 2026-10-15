// SettingsWebhookLog.jsx — QUEUE §25.5. The delivery log of one webhook endpoint, with a Replay button per delivery.
// A replay is a person's own click: it sends the same event again as a NEW row (marked "replay"), whatever happened before. Automatic retries are unchanged.
// Props: { view: { endpoints: [...] } } — the list comes from GET /api/developer/webhook-endpoints.
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

const tone = (s) => (s === "delivered" ? "ok" : s === "failed" || s === "dead" ? "bad" : "neutral");
const when = (v) => { try { return v ? new Date(v).toLocaleString() : "—"; } catch { return "—"; } };

export default function SettingsWebhookLog({ view = null }) {
  const endpoints = view?.endpoints ?? [];
  const [id, setId] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const current = id ?? endpoints[0]?.id ?? null;
  const load = async (eid) => { try { setRows((await api.webhookDeliveries(eid)).deliveries ?? []); } catch (e) { setNote(e?.message ?? "Could not load the log."); } };
  useEffect(() => { if (current) load(current); }, [current]);
  async function replay(deliveryId) {
    setBusy(deliveryId); setNote(null);
    try { const out = await api.replayWebhookDelivery({ deliveryId }); setNote(out.outcome === "delivered" ? "Replayed — your server answered." : `Replayed — it did not go through (${out.error ?? out.status ?? out.outcome}).`); await load(current); }
    catch (e) { setNote(e instanceof ApiError || e?.message ? e.message : "That did not work."); } finally { setBusy(null); }
  }
  return (
    <div className="mx-auto max-w-[960px] px-1" data-testid="settings-webhook-log">
      <PageTitle>Webhook deliveries</PageTitle>
      <p className="m-0 mt-1 text-body text-ink-2">Every send to your endpoints, newest first. Replay sends the same event again — useful after you fix your server.</p>
      {endpoints.length === 0 ? <p className="mt-4 text-body text-ink-2" data-testid="webhook-log-empty">No webhook endpoints yet.</p> : (
        <>
          <select className="mt-4 h-9 rounded-card border border-line bg-surface px-2 text-ui" value={current ?? ""} onChange={(e) => setId(e.target.value)} aria-label="Endpoint" data-testid="webhook-log-endpoint">
            {endpoints.map((e) => <option key={e.id} value={e.id}>{e.name || e.url}</option>)}
          </select>
          {note && <p role="status" className="mt-3 text-meta text-ink-2" data-testid="webhook-log-note">{note}</p>}
          <div className="mt-3 overflow-auto rounded-card border border-line">
            <table className="w-full border-collapse text-ui" data-testid="webhook-log-table">
              <thead><tr>{["When", "Event", "Attempt", "Result", ""].map((h) => <th key={h} className="h-9 border-b border-line bg-surface-sunken px-3 py-0 text-left text-caption font-medium text-ink-2">{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="h-10 px-3 text-ink-2">Nothing sent to this endpoint yet.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="h-10 border-b border-line-soft px-3 py-0">{when(r.attempted_at)}</td>
                    <td className="h-10 border-b border-line-soft px-3 py-0">{r.topic}{r.replay_of && <span className="ml-2 text-caption text-mute">replay</span>}</td>
                    <td className="h-10 border-b border-line-soft px-3 py-0">{r.attempt}</td>
                    <td className="h-10 border-b border-line-soft px-3 py-0"><StatusBadge tone={tone(r.dead_at ? "dead" : r.status)} label={`${r.dead_at ? "gave up" : r.status}${r.response_status ? ` · ${r.response_status}` : ""}`} /></td>
                    <td className="h-10 border-b border-line-soft px-3 py-0"><Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => replay(r.id)} data-testid="webhook-replay">{busy === r.id ? "Replaying…" : "Replay"}</Button></td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </>)}
    </div>
  );
}
