import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import SetNotificationsTable1Table from "./SetNotificationsTable1Table.jsx";

export default function SetNotifications({ data = null, onNavigate = null, onDone = null }) {
  const matrix = data?.matrix ?? [];
  const roles = data?.roles ?? [];
  const channels = data?.channels ?? ["email", "in-app"];
  const quietHours = data?.quietHours ?? null;

  const [busy, setBusy] = useState({});
  const [problem, setProblem] = useState(null);

  async function toggleRule(topicKey, role, channel, enabled) {
    const cellId = `${topicKey}-${role}-${channel}`;
    setBusy(prev => ({ ...prev, [cellId]: true }));
    try {
      await api.setNotificationRule({ topic: topicKey, role, channel, enabled }, crypto.randomUUID());
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(prev => ({ ...prev, [cellId]: false }));
    }
  }

  function getCellState(topic, role, channel) {
    const row = matrix.find(m => m.topic === topic && m.role === role);
    if (!row) return { enabled: false, provenance: "default" };
    const cell = row.channels.find(c => c.channel === channel);
    return cell || { enabled: false, provenance: "default" };
  }

  function getProvenanceLabel(provenance) {
    switch (provenance) {
      case "default":
        return "Default";
      case "practice":
        return "Practice";
      case "personal":
        return "Personal";
      default:
        return provenance;
    }
  }

  return (
    <section className="max-w-none px-[30px] py-[26px]" data-testid="set-notifications">
      <div className="mb-6">
        <h1 className="m-0 mb-2 text-2xl font-medium -tracking-[0.01em] text-ink">
          Notifications
        </h1>
        <p className="m-0 text-body text-mute-decor">Choose what reaches you and how.</p>
      </div>

      {problem && <ErrorPanel message={problem} onDismiss={() => setProblem(null)} />}

      {matrix.length === 0 ? (
        <ScreenState phase="loading" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <SetNotificationsTable1Table
            data={data}
            matrix={matrix}
            roles={roles}
            channels={channels}
            quietHours={quietHours}
            busy={busy}
            toggleRule={toggleRule}
            getCellState={getCellState}
            getProvenanceLabel={getProvenanceLabel}
          />
        </div>
      )}
    </section>
  );
}
