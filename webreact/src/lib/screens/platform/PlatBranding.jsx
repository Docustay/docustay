// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatBranding — platform branding push states view. Ported from
// webui/src/lib/screens/platform/PlatBranding.svelte (242 lines).
// Props: app, onNavigate. Loads branding data via api.platformBrandingPushStates.
// Archetype: none (part — composes kit primitives).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function PlatBranding({ app, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pushStates, setPushStates] = useState([]);
  const [notBuilt, setNotBuilt] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.platformBrandingPushStates();
      setPushStates(result.push_states || []);
      setNotBuilt((result.notBuilt ?? []).includes("push_states"));
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

  useEffect(() => {
    loadData();
  }, []);

  const getStateColor = (state) => {
    if (state === "success") return { bg: "bg-[var(--color-success-50)]", text: "text-[var(--color-success-700)]", border: "border-[var(--color-success-700)]" };
    if (state === "failed") return { bg: "bg-[var(--color-danger-50)]", text: "text-[var(--color-danger-700)]", border: "border-[var(--color-danger-700)]" };
    if (state === "pending") return { bg: "bg-[var(--color-warning-50)]", text: "text-[var(--color-warning-700)]", border: "border-[var(--color-warning-700)]" };
    return { bg: "bg-[var(--color-structure-150)]", text: "text-[var(--color-structure-600)]", border: "border-[var(--color-structure-600)]" };
  };

  const getStateLabel = (state) => {
    if (state === "success") return "✓ Success";
    if (state === "failed") return "✗ Failed";
    if (state === "pending") return "⋯ Pending";
    return state;
  };

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
          Branding
        </h1>
        <p className="m-0 mb-[18px] text-meta text-mute">
          Push states and failure reasons. What went out, and what didn't.
        </p>

        <div className="flex flex-col gap-3">
          {pushStates.map((pushState) => {
            const colors = getStateColor(pushState.state);
            return (
              <div
                key={pushState.id}
                className="rounded-[12px] border border-line bg-white p-4"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <h3 className="m-0 text-sm font-medium text-ink">
                      {pushState.practice_name || "Unnamed practice"}
                    </h3>
                    <p className="m-0 mt-0.5 font-mono text-xs text-mute">
                      {pushState.tenant_id}
                    </p>
                  </div>
                  <div className={`ml-4 inline-block whitespace-nowrap rounded-[6px] border px-3 py-1.5 text-xs font-medium ${colors.bg} ${colors.text} ${colors.border}`}>
                    {getStateLabel(pushState.state)}
                  </div>
                </div>

                {pushState.pushed_at && (
                  <p className="m-0 mt-2 text-xs text-mute">
                    Pushed {new Date(pushState.pushed_at).toLocaleString()}
                  </p>
                )}

                {pushState.failure_reason && (
                  <div className="mt-2 rounded-[4px] border-l-[3px] border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2">
                    <p className="m-0 text-xs font-medium text-[var(--color-danger-700)]">
                      Failure reason:
                    </p>
                    <p className="m-0 mt-1 text-xs text-ink-2">
                      {pushState.failure_reason}
                    </p>
                  </div>
                )}

                {pushState.detail && (
                  <div className="mt-2 rounded-[4px] border-l-[3px] border-[var(--color-signer-client-ink)] bg-[var(--color-signer-client-bg)] px-3 py-2">
                    <p className="m-0 text-xs font-medium text-[var(--color-signer-client-ink)]">
                      Detail:
                    </p>
                    <p className="m-0 mt-1 text-xs text-ink-2">
                      {pushState.detail}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {notBuilt && (
          <p className="text-center text-meta text-mute py-10 px-5">
            Branding push history is not built yet — nothing records a push, so there is nothing to show.
          </p>
        )}

        {pushStates.length === 0 && !notBuilt && (
          <p className="text-center text-meta text-mute py-10 px-5">
            No branding pushes yet.
          </p>
        )}
      </div>
    </div>
  );
}
