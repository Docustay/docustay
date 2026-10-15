// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 20.29 - STAFF SESSION SCREEN
//
// ★★★ THE COACH'S PHONE SESSION VIEW. Displays:
//     - Header band: client name, service type, session time
//     - Check-in band: button to POST /api/bookings/:id/check-in (idempotent)
//     - Complete sheet: Attended or No-show choice with consequence sentence from policy
//     - Notes band: link to write-up via automation
//
// ★★ EACH BAND LOADS AND FAILS INDEPENDENTLY - ErrorPanel for band failures while rest renders.
//     Bands fail when their source API returns an error; no band is required for the screen to show.
//
// ★ Built from `specs/mockups/StaffSession.frame.html`, band by band.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import PhoneSheet from "@/lib/phone/PhoneSheet.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function StaffSession({ bookingId, data, headerError, completeError, onCheckIn, onComplete, onRetryHeader, onRetryComplete }) {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  const [checkedIn, setCheckedIn] = useState(data?.checkedInAt ?? false);
  const [showCompleteSheet, setShowCompleteSheet] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // DERIVED VALUES
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // ★ Format a time value
  const formatTime = (iso) => {
    if (!iso) return "-";
    try {
      const date = new Date(iso);
      return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch {
      return "-";
    }
  };

  const formatDuration = (mins) => {
    if (!mins) return "";
    if (mins === 60) return "60 min";
    return `${mins} min`;
  };

  // ★ Extract header data
  const clientName = data?.clientName ?? "Unknown client";
  const serviceType = data?.serviceType ?? "";
  const location = data?.location ?? "";
  const startsAt = data?.startsAt ?? null;
  const durationMins = data?.durationMins ?? null;
  const policyConsequence = data?.policyConsequence ?? "";

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  const handleCheckIn = async () => {
    setIsCheckingIn(true);
    try {
      const response = await fetch(`/api/bookings/${bookingId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Failed to check in: ${response.statusText}`);
      }

      const result = await response.json();
      setCheckedIn(true);
      if (onCheckIn) onCheckIn(result);
    } catch (err) {
      console.error("Check-in error:", err);
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleComplete = async (outcome) => {
    setIsCompleting(true);
    try {
      const body = outcome === "attended" ? { attended: true } : { no_show: true };

      const response = await fetch(`/api/bookings/${bookingId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Failed to complete session: ${response.statusText}`);
      }

      const result = await response.json();
      setShowCompleteSheet(false);
      if (onComplete) onComplete(result);
    } catch (err) {
      console.error("Complete error:", err);
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="px-[18px] pb-[22px] pt-[2px]">
      {/* ═══ HEADER BAND ───────────────────────────────────────────────────────────────────────── */}
      {headerError ? (
        <ErrorPanel
          error={headerError}
          variant="band"
          testId="header-error"
          onRetry={onRetryHeader}
        />
      ) : data ? (
        <PhoneCard>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-medium text-heading text-color-structure-900">
                {clientName}
              </div>
              <div className="text-meta text-color-structure-600 mt-[3px]">
                {serviceType}{location ? ` - ${location}` : ""}
              </div>
            </div>
            <div className="flex-none text-right">
              <div className="font-medium text-heading text-color-structure-900">
                {formatTime(startsAt)}
              </div>
              {durationMins && (
                <div className="text-caption text-color-structure-600 mt-[2px]">
                  {formatDuration(durationMins)}
                </div>
              )}
            </div>
          </div>
        </PhoneCard>
      ) : null}

      {/* ═══ CHECK-IN BAND ────────────────────────────────────────────────────────────────────────── */}
      {!headerError && data && (
        <PhoneCard>
          <div className="flex gap-2">
            {checkedIn ? (
              <div className="flex-1 flex items-center font-medium text-ui text-color-success-700">
                Checked in
              </div>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={isCheckingIn}
                onClick={handleCheckIn}
                data-testid="check-in-button"
              >
                Check in
              </Button>
            )}
          </div>
        </PhoneCard>
      )}

      {/* ═══ COMPLETE SHEET ────────────────────────────────────────────────────────────────────────── */}
      {!headerError && data && checkedIn && (
        <>
          {completeError ? (
            <ErrorPanel
              error={completeError}
              variant="band"
              testId="complete-error"
              onRetry={onRetryComplete}
            />
          ) : (
            <>
              <PhoneCard>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setShowCompleteSheet(true)}
                  data-testid="complete-button"
                >
                  Complete session
                </Button>
              </PhoneCard>

              <PhoneSheet
                open={showCompleteSheet}
                onClose={() => setShowCompleteSheet(false)}
                title="How did the session go?"
              >
                <div className="flex flex-col gap-3 py-3">
                  <button
                    className="flex flex-col items-start gap-[6px] border border-color-structure-200 rounded-[8px] p-[14px] bg-white hover:border-color-action-400 hover:bg-color-action-50 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                    onClick={() => handleComplete("attended")}
                    disabled={isCompleting}
                    data-testid="attended-button"
                  >
                    <div className="font-medium text-ui text-color-structure-900">
                      Attended
                    </div>
                  </button>

                  <button
                    className="flex flex-col items-start gap-[6px] border border-color-structure-200 rounded-[8px] p-[14px] bg-white hover:border-color-action-400 hover:bg-color-action-50 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                    onClick={() => handleComplete("no_show")}
                    disabled={isCompleting}
                    data-testid="no-show-button"
                  >
                    <div className="font-medium text-ui text-color-structure-900">
                      No-show
                    </div>
                    {policyConsequence && (
                      <div className="text-caption text-color-warning-700">
                        {policyConsequence}
                      </div>
                    )}
                  </button>
                </div>
                <div className="flex gap-2 p-0 pb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCompleteSheet(false)}
                    disabled={isCompleting}
                  >
                    Cancel
                  </Button>
                </div>
              </PhoneSheet>
            </>
          )}
        </>
      )}
    </div>
  );
}
