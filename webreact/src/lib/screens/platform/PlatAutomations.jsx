// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatAutomations — platform automations view. Ported from
// webui/src/lib/screens/platform/PlatAutomations.svelte (302 lines).
// Props: app, onNavigate. Loads automations data via api.platformAutomationsAdoption and
// api.platformAutomationsKillSwitch.
// Archetype: none (part — composes kit primitives).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function PlatAutomations({ app, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [automations, setAutomations] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [notBuilt, setNotBuilt] = useState([]);
  const [killSwitchStates, setKillSwitchStates] = useState({});
  const [killSwitchInProgress, setKillSwitchInProgress] = useState({});

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.platformAutomationsAdoption();
      setAutomations(result.automations || []);
      setIncidents(result.incidents || []);
      setNotBuilt(result.notBuilt ?? []);
      setKillSwitchStates(result.states || {});
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError({ message: "Access denied", kind: "denied" });
      } else {
        setError(err instanceof ApiError ? err : { message: String(err?.message ?? err) });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKillSwitch = async (workflowId, workflowName, currentState) => {
    const newState = !currentState;

    // Optimistic update
    setKillSwitchStates((prev) => ({ ...prev, [workflowId]: newState }));
    setKillSwitchInProgress((prev) => ({ ...prev, [workflowId]: true }));

    try {
      const result = await api.platformAutomationsKillSwitch(workflowId, newState);
      // Reflect the actual state from n8n
      setKillSwitchStates((prev) => ({ ...prev, [workflowId]: result.active }));
    } catch (err) {
      // Revert on error
      setKillSwitchStates((prev) => ({ ...prev, [workflowId]: currentState }));
      setError(err instanceof ApiError ? err : { message: String(err?.message ?? err) });
    } finally {
      setKillSwitchInProgress((prev) => ({ ...prev, [workflowId]: false }));
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (error?.kind === "denied") {
    return <ScreenState phase="denied" testIds={{ denied: "screen-denied" }} />;
  }

  if (error) {
    return <ScreenState phase="error" error={error} onRetry={loadData} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-auto px-[30px] pt-[26px] pb-[70px]">
        <h1 className="m-0 mb-[6px] font-serif text-2xl font-medium tracking-[-0.01em]">
          Automations
        </h1>
        <p className="m-0 mb-[18px] text-meta text-mute">
          Adoption counts per family. Kill switch reads n8n live — not cached.
        </p>

        <div className="mb-[20px] overflow-hidden rounded-[12px] border border-line bg-white">
          <div className="grid border-b border-line px-4 py-[10px] grid-cols-[1fr_150px_120px] gap-4 bg-[var(--color-surface-2)]">
            <div className="text-xs font-semibold text-mute">Workflow</div>
            <div className="text-xs font-semibold text-mute text-center">Adoption</div>
            <div className="text-xs font-semibold text-mute text-center">Platform state</div>
          </div>

          {automations.map((auto) => (
            <div
              key={auto.workflow_id}
              className="grid border-b border-hair px-4 py-3 items-center last:border-b-0 grid-cols-[1fr_150px_120px] gap-4"
            >
              <div className="flex flex-col gap-[2px]">
                <span className="text-control font-medium text-ink-2">{auto.workflow_name}</span>
                {auto.family && <span className="text-xs text-mute">{auto.family}</span>}
              </div>
              <div className="text-center">
                <span className="inline-block rounded px-2 py-1 text-xs font-medium bg-[var(--color-signer-client-bg)] text-[var(--color-signer-client-ink)]">
                  {auto.adoption_count} practices
                </span>
              </div>
              <div className="text-center">
                <button
                  className={`rounded-[6px] border px-[14px] py-[6px] text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    killSwitchStates[auto.workflow_id]
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-white text-ink-2 hover:border-brand hover:text-brand"
                  }`}
                  disabled={killSwitchInProgress[auto.workflow_id]}
                  onClick={() => handleKillSwitch(auto.workflow_id, auto.workflow_name, killSwitchStates[auto.workflow_id])}
                >
                  {killSwitchStates[auto.workflow_id] ? "On" : "Off"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {incidents.length > 0 && (
          <div className="mt-[20px]">
            <h2 className="m-0 mb-3 mt-4 text-sm font-medium text-ink">Recent incidents</h2>
            <div className="flex flex-col gap-2">
              {incidents.map((incident) => (
                <div
                  key={incident.id}
                  className="grid rounded-[4px] border-l-[3px] px-3 py-[10px] text-xs items-start grid-cols-[150px_1fr_1fr] gap-3 bg-[var(--color-bad-soft)] border-l-[var(--color-bad)]"
                >
                  <span className="font-medium text-[var(--color-bad)]">
                    {new Date(incident.occurred_at).toLocaleString()}
                  </span>
                  <span className="text-ink-2">{incident.workflow_name}</span>
                  <span className="text-mute">{incident.detail || "Automation incident"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {notBuilt.includes("adoption") && (
          <p className="text-center text-meta text-mute py-10 px-5">
            Adoption counts and incidents are not built yet — nothing records which practices turned an automation on, or what failed.
          </p>
        )}

        {automations.length === 0 && !notBuilt.includes("adoption") && (
          <p className="text-center text-meta text-mute py-10 px-5">
            No automations configured yet.
          </p>
        )}
      </div>
    </div>
  );
}
