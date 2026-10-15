import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import * as ButtonGroup from "@/lib/components/ui/button-group.jsx";
import * as Alert from "@/lib/components/ui/alert.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import NotificationPrefsScreenTable1Table from "./NotificationPrefsScreenTable1Table.jsx";

const ROLE_COLUMNS = [
  { key: "owner_admin", label: "Owner / admins" },
  { key: `coach`, label: `Coach` },
  { key: "client_parent", label: "Client or parent" },
];

const CHANNEL_COLUMNS = [
  { key: "in_app", label: "in-app" },
  { key: "email", label: "email" },
  { key: "push", label: "push" },
];

export default function NotificationPrefsScreen({ view = null, onNavigate = null, onDone = null }) {
  const topics = view?.topics ?? [];
  const lastChanged = view?.lastChanged ?? null;

  const [answered, setAnswered] = useState({});
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);

  // Clear overlays when topics change
  useEffect(() => {
    setAnswered({});
  }, [topics]);

  const cellKey = (topic, role, channel) => `${topic}|${role}|${channel}`;

  const enabledOf = (topic, role, channel, serverValue) => {
    const k = cellKey(topic, role, channel);
    return Object.prototype.hasOwnProperty.call(answered, k) ? answered[k] : !!serverValue;
  };

  const goto = (e, href) => {
    e.preventDefault();
    onNavigate?.(href);
  };

  const toggle = async (topic, role, channel, serverValue) => {
    const k = cellKey(topic, role, channel);
    if (busy) return;
    setBusy(k);
    setProblem(null);
    const next = !enabledOf(topic, role, channel, serverValue);
    try {
      await api.setNotificationRule({ topic, role, channel, enabled: next });
      setAnswered(prev => ({ ...prev, [k]: next }));
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[980px]" data-testid="settings-notifications">
      <p className="m-0 text-xs text-structure-600">
        <a href="/settings" onClick={(e) => goto(e, "/settings")} className="text-action-600 no-underline hover:underline">
          Settings
        </a>
      </p>
      <h1 className="m-0 mt-1 text-2xl font-medium -tracking-[0.01em] text-structure-900">Notifications</h1>
      <p className="m-0 mb-4 text-sm text-structure-600">
        Who hears about what. Staff can also choose a daily digest in{" "}
        <span>My settings</span>.
      </p>

      {problem && (
        <p className="m-0 text-sm text-danger-700" data-testid="notif-error" role="alert">
          {problem}
        </p>
      )}

      <LastChanged
        at={lastChanged?.at ?? null}
        by={lastChanged?.by ?? null}
        label="Last changed"
        testId="notif-last-changed"
      />

      {topics.length === 0 ? (
        <EmptyState
          kind="empty"
          headline="No notification topics found"
          line="Nothing to configure yet."
          testId="notif-empty"
        />
      ) : (
        <div className="overflow-x-auto">
          <NotificationPrefsScreenTable1Table
            topics={topics}
            ROLE_COLUMNS={ROLE_COLUMNS}
            CHANNEL_COLUMNS={CHANNEL_COLUMNS}
            busy={busy}
            cellKey={cellKey}
            enabledOf={enabledOf}
            toggle={toggle}
          />
        </div>
      )}

      <section className="grid grid-cols-[240px_minmax(0,1fr)] gap-4 py-6 border-t border-structure-200 md:grid-cols-1">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-sm font-medium text-structure-900">Texting</h2>
          <p className="m-0 text-xs text-structure-600">Add-on, coming after launch.</p>
        </div>
        <div className="flex flex-col">
          <Alert.Alert
            className="flex items-center gap-4 bg-structure-75 text-xs rounded-lg border border-structure-200"
            data-testid="notif-texting-banner"
          >
            <Alert.AlertDescription className="flex-grow text-structure-900">
              Text reminders cut no-shows. When it launches you'll pay per text at cost, and clients
              opt in when they book.
            </Alert.AlertDescription>
            <Badge className="h-5 text-xs font-medium bg-chip-neutral-bg text-chip-neutral-ink shrink-0">
              Coming later
            </Badge>
          </Alert.Alert>
        </div>
      </section>

      <section className="grid grid-cols-[240px_minmax(0,1fr)] gap-4 py-6 border-t border-structure-200 md:grid-cols-1">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-sm font-medium text-structure-900">Always sent</h2>
          <p className="m-0 text-xs text-structure-600">Clients can't turn these off.</p>
        </div>
        <div className="flex flex-col">
          <p className="m-0 text-xs text-structure-600 break-words">
            Receipts, documents to sign, booking confirmations and cancellations.
          </p>
        </div>
      </section>
    </div>
  );
}
