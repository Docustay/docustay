// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatUsage — platform usage view. Ported from
// webui/src/lib/screens/platform/PlatUsage.svelte (270 lines).
// Props: app, onNavigate. Loads usage data via api.platformUsageList and tells via api.platformUsageTell.
// Archetype: none (part — composes kit components).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function PlatUsage({ app, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usage, setUsage] = useState({});
  const [tellMessage, setTellMessage] = useState("");
  const [tellInProgress, setTellInProgress] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.platformUsageList();
      setUsage(result.usage || {});
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

  const handleTell = async (tenantId, metric) => {
    if (!tellMessage.trim()) {
      setError({ message: "A message is required — 1 to 500 characters", kind: "invalid" });
      return;
    }

    setTellInProgress(true);
    try {
      const result = await api.platformUsageTell(tenantId, metric, tellMessage);
      if (result.ok) {
        // Reload and clear message
        await loadData();
        setTellMessage("");
      }
    } catch (err) {
      if (err instanceof ApiError && err.kind === "already_told") {
        setError({ message: "You've already told this practice about this metric this period", kind: "conflict" });
      } else {
        setError(err instanceof ApiError ? err : { message: String(err?.message ?? err) });
      }
    } finally {
      setTellInProgress(false);
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
        <div className="mb-[18px]">
          <h1 className="m-0 mb-[6px] font-serif text-2xl font-medium tracking-[-0.01em]">
            What everyone's using
          </h1>
          <p className="m-0 text-[13.5px] text-mute">
            Eleven practices. Two are over on texts and don't know.
          </p>
        </div>

        <div className="rounded-[12px] border border-line bg-white overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--paper)]">
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line">Practice</th>
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line">Plan</th>
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line">AI drafts</th>
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line">Texts</th>
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line">Documents</th>
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line">Staff</th>
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line">Over?</th>
                <th className="h-[38px] px-4 text-left text-[12.5px] font-medium text-mute border-b border-line"></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(usage).map(([tenantId, metrics]) => (
                <tr key={tenantId} className="border-b border-hair last:border-b-0">
                  <td className="h-[46px] px-4 text-sm">{metrics.practice_name || "Unnamed practice"}</td>
                  <td className="h-[46px] px-4 text-sm">{metrics.plan_name || "—"}</td>
                  <td className="h-[46px] px-4 text-sm tabular-nums">
                    {metrics.ai_drafts ? `${metrics.ai_drafts.count} / ${metrics.ai_drafts.limit}` : "—"}
                  </td>
                  <td className="h-[46px] px-4 text-sm tabular-nums">
                    {metrics.texts ? `${metrics.texts.count} / ${metrics.texts.limit}` : "—"}
                  </td>
                  <td className="h-[46px] px-4 text-sm tabular-nums">
                    {metrics.documents ? `${metrics.documents.count} / ${metrics.documents.limit}` : "—"}
                  </td>
                  <td className="h-[46px] px-4 text-sm tabular-nums">
                    {metrics.staff ? `${metrics.staff.count} / ${metrics.staff.limit}` : "—"}
                  </td>
                  <td className="h-[46px] px-4 text-sm">
                    {metrics.ai_drafts?.overage || metrics.texts?.overage || metrics.documents?.overage || metrics.staff?.overage ? (
                      <span className="inline-flex items-center gap-1 rounded-[5px] px-[9px] py-[3px] text-[12px] font-medium bg-[var(--warn-soft)] text-[var(--warn)]">
                        {metrics.texts?.overage && "Texts, $6.30"}
                        {metrics.ai_drafts?.overage && !metrics.texts?.overage && "AI, $2.40"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-[5px] px-[9px] py-[3px] text-[12px] font-medium bg-[var(--ok-soft)] text-[var(--ok)]">
                        Fine
                      </span>
                    )}
                  </td>
                  <td className="h-[46px] px-4 text-right text-mute">⋯</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-[20px]">
          <div className="rounded-[12px] border border-line bg-white p-4">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-base flex-shrink-0 text-[var(--warn)]">$</span>
              <div className="flex-1 min-w-0">
                <h3 className="m-0 mb-1 text-[14.5px] font-medium">Two practices are over and haven't been told</h3>
                <p className="m-0 text-[13px] text-mute mb-3 leading-[1.5]">
                  <strong className="font-medium">Why:</strong> nothing stops working when someone goes over — we bill the difference. But finding out on the invoice is a bad way to find out.
                </p>
                <button className="px-3 py-2 text-[13px] font-medium bg-white border border-line rounded-[7px] hover:bg-hair">
                  Tell them both
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
