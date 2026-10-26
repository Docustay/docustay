// THE DOCUSTAY INBOX (Run 9 board "Notifications"; ruling R9-k). The host's notification rows (`keystone.notification`, written by the generic listener for the workspace owner and
// by the Run 9 listeners) were never read by Docustay's own app. This turns each row into FACTS — what kind of thing happened, to which document, by whom, the numbers of a limit —
// and the browser words them in the reader's language. Nothing here is a second store: read state and preferences are the host's own (`/api/notifications/read`, `/read-all`,
// `/preferences`). The document facts come through the Documents front door (no document_* table is named here).
import { inboxFacts } from "../documents/frontDoor.mjs";

/** Topic → inbox kind, and which tab the kind shows under. A topic not listed here is not a Docustay notice and never shows. */
const KIND_OF = {
  "documents.document.signed": "signed", "documents.document.executed": "completed", "documents.document.opened": "opened", "documents.document.declined": "declined",
  "documents.document.expired": "expired", "documents.document.bounced": "bounced", "documents.document.changes_requested": "changes", "documents.document.delegated": "passed_on",
  "documents.usage.threshold": "limit", "settings.subscription.updated": "plan",
  "documents.payment.failed": "payment_failed", "documents.payment.received": "paid",
};
const INBOX_TOPICS = Object.freeze(Object.keys(KIND_OF));
const TAB_OF = { signed: "signed", completed: "signed", opened: "signed", declined: "signed", expired: "signed", bounced: "signed", changes: "signed", response: "all", limit: "limits", plan: "limits", payment_failed: "all", paid: "all" };
const INBOX_TABS = Object.freeze(["all", "signed", "limits"]);

/** An absolute deep link written for email ("https://sign.example/documents/…") becomes the app's own path; anything that is not a path inside the app is dropped. */
function appPath(link) {
  if (!link) return null;
  try { const u = new URL(link, "https://x.invalid"); const p = u.pathname + u.search; return /^\/(documents|billing|templates|people|plays|reports|settings|payments)(\/|\?|$)/.test(p) ? p : null; } catch { return null; }
}

/** → { items, unread, tab }. `before` pages back (an ISO time). The unread count covers every Docustay notice, whatever the tab, so the bell and the panel agree. */
export async function listInbox(tx, { appUserId, tab = "all", limit = 40, before = null }) {
  if (!appUserId) return { items: [], unread: 0, tab };
  const t = INBOX_TABS.includes(tab) ? tab : "all";
  const n = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const b = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
  // a kind switched off for "in the app" (Settings → Notifications) is not shown and not counted; the row stays (the email channel decides for itself)
  const { rows: off } = await tx.query(`SELECT topic FROM keystone.notification_preference WHERE app_user_id = $1 AND channel = 'in_app' AND enabled = false`, [appUserId]);
  const topics = INBOX_TOPICS.filter((x) => !off.some((o) => o.topic === x));
  const { rows } = await tx.query(
    `SELECT n.id, n.topic, n.deep_link, n.read_at, n.created_at, e.subject_id, e.subject_type, e.payload
       FROM keystone.notification n LEFT JOIN keystone.event e ON e.id = n.event_id
      WHERE n.recipient_id = $1 AND n.topic = ANY($2::text[]) AND ($3::timestamptz IS NULL OR n.created_at < $3)
      ORDER BY n.created_at DESC LIMIT $4`, [appUserId, topics, b, t === "all" ? n : n * 4]);
  const refs = rows.filter((r) => r.subject_type === "document" && r.subject_id).map((r) => ({ instanceId: r.subject_id, role: r.payload?.role ?? null }));
  const facts = await inboxFacts(tx, { refs });
  const items = [];
  for (const r of rows) {
    const f = r.subject_type === "document" ? facts.get(r.subject_id) : null;
    let kind = KIND_OF[r.topic];
    if (f?.form) { if (kind === "signed") continue; if (kind === "completed") kind = "response"; }   // a form response is ONE notice ("New response"), not a signed + a completed
    if (r.subject_type === "document" && !f) continue;   // the document is gone (or not this workspace's): nothing to show or link to
    const p = r.payload ?? {};
    items.push({
      id: r.id, kind, tab: TAB_OF[kind] ?? "all", at: r.created_at, read: Boolean(r.read_at),
      documentId: f ? r.subject_id : null, title: f ? (f.form ? f.formName : f.title) : null, test: f?.test ?? false,
      who: f?.whoByRole?.[p.role] ?? (f?.form ? (f.parties.find((x) => x.role !== "witness")?.name ?? null) : null),
      limit: kind === "limit" ? { kind: p.kind, used: p.used, limit: p.limit, percent: p.percent, resetsAt: p.period_end ?? null } : null,
      plan: kind === "plan" ? { planKey: p.planKey ?? null, status: p.status ?? null, change: p.change ?? null } : null,
      extra: ["payment_failed", "paid"].includes(kind) ? p : null,
      link: f ? `/documents/${r.subject_id}` : kind === "limit" || kind === "plan" ? "/billing" : appPath(r.deep_link),
    });
  }
  const shown = (t === "all" ? items : items.filter((i) => i.tab === t)).slice(0, n);
  const { rows: [{ unread }] } = await tx.query(`SELECT count(*)::int AS unread FROM keystone.notification WHERE recipient_id = $1 AND read_at IS NULL AND topic = ANY($2::text[])`, [appUserId, topics]);
  return { items: shown, unread, tab: t, next: shown.length === n ? shown[shown.length - 1].at : null };
}

/** Mark every Docustay notice read (the panel's "Mark all read"). The host's own read-all covers every topic; this one only the ones the panel shows, so a the platform row is never touched. */
export async function markInboxRead(tx, { appUserId }) {
  if (!appUserId) return { changed: 0 };
  const { rowCount } = await tx.query(`UPDATE keystone.notification SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL AND topic = ANY($2::text[])`, [appUserId, INBOX_TOPICS]);
  return { changed: rowCount };
}

/** The kinds a person can switch on and off (Settings → Notifications), each the topics it covers. The preference itself is the host's `notification_preference`, per topic and channel. */
export const INBOX_SETTINGS = Object.freeze([
  { key: "signed", topics: ["documents.document.signed"] },
  { key: "completed", topics: ["documents.document.executed"] },
  { key: "opened", topics: ["documents.document.opened"] },
  { key: "declined", topics: ["documents.document.declined", "documents.document.expired", "documents.document.bounced", "documents.document.changes_requested", "documents.document.delegated"] },
  { key: "limits", topics: ["documents.usage.threshold"] },
  { key: "payments", topics: ["documents.payment.received", "documents.payment.failed"] },
]);
