// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatTiers — platform tiers & capabilities. Ported from
// webui/src/lib/screens/platform/PlatTiers.svelte (524 lines, 251 of them `<style>`).
// Props: app, onNavigate. Loads tiers data via api.platformTiersCapabilities, updates via api.platformUpdateTierCapability.
// Archetype: none (part — composes kit components).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import PlatTiersTable1Table from "./PlatTiersTable1Table.jsx";

const CAPABILITIES = [
  "growth.campaigns",
  "growth.templates",
  "growth.sequences",
  "growth.sms",
  "growth.landing_pages",
  "growth.forms",
  "growth.lead_scoring",
  "run.presence",
  "run.signals",
  "run.reviews",
  "run.listings",
  "run.ads",
  "run.calls",
  "run.competitors",
  "run.ai_visibility",
];

const CAPABILITY_LABELS = {
  "growth.campaigns": "Campaigns",
  "growth.templates": "Templates",
  "growth.sequences": "Sequences",
  "growth.sms": "SMS",
  "growth.landing_pages": "Landing pages",
  "growth.forms": "Forms",
  "growth.lead_scoring": "Lead scoring",
  "run.presence": "Presence",
  "run.signals": "Signals",
  "run.reviews": "Reviews",
  "run.listings": "Listings",
  "run.ads": "Ads",
  "run.calls": "Calls",
  "run.competitors": "Competitors",
  "run.ai_visibility": "AI visibility",
};

function capabilityLabel(key) {
  return CAPABILITY_LABELS[key] || key;
}

export default function PlatTiers({ app, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [grid, setGrid] = useState({});
  const [cellError, setCellError] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [confirmPending, setConfirmPending] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.platformTiersCapabilities();
      setTiers(result.tiers || []);
      setGrid(result.grid || {});
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

  const handleTick = async (tierId, capKey) => {
    const currentValue = grid[tierId]?.[capKey];
    const newValue = !currentValue;

    // If turning OFF, fetch impact counts and show confirmation modal
    if (!newValue) {
      setConfirmModal({
        tierId,
        capKey,
        practiceCount: null,
        recentCount: null,
        scheduledCount: null,
        editedCount: null,
        loading: true,
        error: null,
      });

      try {
        const impact = await api.tierCapabilityImpact(tierId, capKey);
        setConfirmModal((prev) => ({
          ...prev,
          practiceCount: impact.practiceCount ?? null,
          recentCount: impact.recentCount ?? null,
          scheduledCount: impact.scheduledCount ?? null,
          editedCount: impact.editedCount ?? null,
          loading: false,
        }));
      } catch (err) {
        setConfirmModal((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof ApiError ? err.message : String(err?.message ?? err),
        }));
      }
      return;
    }

    // Turning ON — proceed directly
    await applyChange(tierId, capKey, newValue);
  };

  const confirmOff = async () => {
    if (!confirmModal) return;
    setConfirmPending(true);
    try {
      await applyChange(confirmModal.tierId, confirmModal.capKey, false);
      setConfirmModal(null);
    } finally {
      setConfirmPending(false);
    }
  };

  const applyChange = async (tierId, capKey, newValue) => {
    setCellError(null);
    const oldValue = grid[tierId]?.[capKey];

    // Optimistic update
    setGrid((prev) => ({
      ...prev,
      [tierId]: {
        ...(prev[tierId] || {}),
        [capKey]: newValue,
      },
    }));

    try {
      const result = await api.platformUpdateTierCapability(tierId, capKey, newValue);
      // Re-render from response
      if (result.grid && result.grid[tierId]) {
        setGrid((prev) => ({
          ...prev,
          [tierId]: {
            ...(prev[tierId] || {}),
            [capKey]: result.grid[tierId][capKey],
          },
        }));
      }
    } catch (err) {
      // Revert and show error
      setGrid((prev) => ({
        ...prev,
        [tierId]: {
          ...(prev[tierId] || {}),
          [capKey]: oldValue,
        },
      }));
      const errorMsg = err instanceof ApiError
        ? (err.body?.error?.message || err.message)
        : String(err?.message ?? err);
      setCellError({
        tierId,
        capKey,
        message: errorMsg || "Failed to update",
      });
      // Clear error after 5 seconds
      setTimeout(() => {
        setCellError(null);
      }, 5000);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (error) {
    return <ErrorPanel error={error} onRetry={loadData} />;
  }

  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex-1 overflow-auto p-[26px_30px_70px]">
        <h1 className="m-0 font-fraunces text-[24px] font-medium leading-none tracking-[-0.01em] mb-[6px]">
          Tiers
        </h1>
        <p className="font-inter text-[13.5px] font-normal text-mute m-0 mb-[18px]">
          Tick boxes write tier_capability. Changing a tick changes every practice on that tier, now — no deploy. Per-practice exceptions live on the practice record.
        </p>

        <PlatTiersTable1Table
          error={null}
          tiers={tiers}
          grid={grid}
          cellError={cellError}
          CAPABILITIES={CAPABILITIES}
          capabilityLabel={capabilityLabel}
          handleTick={handleTick}
        />

        <p className="font-inter text-[12.5px] font-normal text-mute m-[14px_0_0]">
          A locked screen never goes dark: it shows the practice's real findings with upgrade as the fix — the Run pattern, everywhere.
        </p>
      </div>

      {confirmModal && (
        <div className="fixed inset-0 bg-[rgba(20,20,25,0.42)] flex items-center justify-center z-100">
          <div className="w-[520px] bg-white rounded-[16px] shadow-[0_24px_60px_rgba(20,20,25,0.22)] overflow-hidden flex flex-col">
            <div className="p-[22px_24px_6px]">
              <h2 className="m-0 font-inter text-[18px] font-medium">
                Turn {capabilityLabel(confirmModal.capKey)} off for the {tiers.find((t) => t.id === confirmModal.tierId)?.name} tier?
              </h2>
              <p className="m-[8px_0_0] text-[13.5px] text-mute leading-[1.6]">
                This is not a quiet change. Practices are using it right now.
              </p>
            </div>
            <div className="p-[12px_24px_6px] font-inter text-[14px] leading-[1.6] max-h-[400px] overflow-auto">
              {confirmModal.loading ? (
                <p className="text-mute">Loading impact details...</p>
              ) : confirmModal.error ? (
                <p className="text-bad">Error: {confirmModal.error}</p>
              ) : (
                <>
                  {confirmModal.practiceCount !== null && (
                    <>
                      <p>
                        <strong>{confirmModal.practiceCount}</strong> practices on {tiers.find((t) => t.id === confirmModal.tierId)?.name} have {capabilityLabel(confirmModal.capKey)} today. Of those:
                      </p>
                      <ul className="m-[0_0_10px_18px] p-0">
                        {confirmModal.recentCount !== null && (
                          <li className="mb-[4px]">
                            <strong>{confirmModal.recentCount}</strong> sent {capabilityLabel(confirmModal.capKey).toLowerCase()} in the last 30 days
                          </li>
                        )}
                        {confirmModal.scheduledCount !== null && (
                          <li className="mb-[4px]">
                            <strong>{confirmModal.scheduledCount}</strong> have a send <strong>scheduled</strong> — those sends will not go out
                          </li>
                        )}
                        {confirmModal.editedCount !== null && (
                          <li className="mb-[4px]">
                            <strong>{confirmModal.editedCount}</strong> have edited templates — kept, but locked until they upgrade
                          </li>
                        )}
                      </ul>
                      <p className="m-0">
                        Their screens switch to the locked view: real findings, upgrade as the fix. Nothing is deleted. Per-practice exceptions on the practice record still win.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-[9px] justify-end p-[18px_24px_22px] border-t border-hair">
              <button
                className="inline-flex items-center justify-center h-[38px] px-[17px] rounded-[8px] font-inter text-[14px] font-medium border border-line bg-white text-ink2 cursor-pointer transition-all"
                onClick={() => setConfirmModal(null)}
                disabled={confirmPending || confirmModal.loading}
              >
                Leave it on
              </button>
              <button
                className="inline-flex items-center justify-center h-[38px] px-[17px] rounded-[8px] font-inter text-[14px] font-medium border border-line bg-bad text-white cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={confirmOff}
                disabled={confirmPending || confirmModal.loading}
              >
                {confirmModal.loading
                  ? "Loading..."
                  : confirmModal.practiceCount !== null
                    ? `Turn it off for ${confirmModal.practiceCount} practices`
                    : "Turn it off"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
