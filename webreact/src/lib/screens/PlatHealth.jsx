// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.053 — PlatHealth: port faithfully
// `/platform/health`. THE PLATFORM'S SYSTEM HEALTH AT A GLANCE.
//
// Five facts rendered from the board object: history (days since down, last cause, migrations,
// failed webhooks), Ours (our services), Theirs (external services), Jobs (background jobs),
// and Worth knowing (platform prompts). Ported from webui/src/lib/screens/PlatHealth.svelte.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";

export default function PlatHealth({ app }) {
  const [health, setHealth] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch health data on mount
  useEffect(() => {
    let live = true;
    const loadHealth = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const r = await api.platformHealth();
        if (live) {
          setHealth(r);
        }
      } catch (err) {
        if (live) {
          if (err instanceof ApiError && err.status === 403) {
            setError({ status: 403 });
          } else {
            setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
          }
        }
      } finally {
        if (live) setIsLoading(false);
      }
    };
    loadHealth();
    return () => { live = false; };
  }, []);

  const board = health?.board;

  const statusBadgeColor = (state) => {
    if (state === "up" || state === "fine") return "bg-[var(--chip-ok-bg)] text-[var(--chip-ok-ink)]";
    if (state === "down") return "bg-[var(--chip-bad-bg)] text-[var(--chip-bad-ink)]";
    if (state === "pending" || state === "waiting") return "bg-[var(--chip-warn-bg)] text-[var(--chip-warn-ink)]";
    return "bg-mute-bg text-mute-decor"; // not_measured
  };

  const statusBadgeText = (state) => {
    if (state === "up") return "Up";
    if (state === "fine") return "Fine";
    if (state === "down") return "Down";
    if (state === "pending") return "Pending";
    if (state === "waiting") return "Waiting";
    return "Not measured";
  };

  // Format the main headline and subtitle
  const headline = (() => {
    if (!board?.history) return { main: "Is everything running", sub: "Loading…" };
    const { daysSinceDown, lastDownCause } = board.history;
    if (daysSinceDown === null || daysSinceDown === undefined) {
      return { main: "Is everything running", sub: "No problems detected." };
    }
    const downCount = (board.ours || []).filter((r) => r.state === "down").length +
                      (board.theirs || []).filter((r) => r.state === "down").length;
    if (downCount > 0) {
      return { main: "Is everything running", sub: `${downCount} thing(s) need looking at.` };
    }
    return { main: "Is everything running", sub: `Yes. Nothing has gone down in ${daysSinceDown} day(s).` };
  })();

  if (isLoading) {
    return <ScreenState phase="loading" />;
  }

  if (error) {
    if (error.status === 403) {
      return <ScreenState phase="denied" />;
    }
    return <ScreenState phase="error" error={new Error(String(error))} />;
  }

  if (!board) {
    return <ScreenState phase="loading" />;
  }

  return (
    <ScreenState phase="ready">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-[18px] px-[30px] pt-[26px]">
        <div className="flex-1">
          <h1 className="m-0 text-[24px] font-medium tracking-[-0.01em] font-display">
            {headline.main}
          </h1>
          <div className="text-[13.5px] text-[var(--ink-muted)] mt-[5px]">
            {headline.sub}
          </div>
        </div>
      </div>

      {/* History trio strip */}
      {board.history && (
        <div className="flex gap-0 bg-white border border-[var(--line)] rounded-[12px] overflow-hidden my-[18px] mx-[30px] mb-[20px]">
          <div className="flex-1 basis-0 px-[22px] py-[20px] border-r border-[var(--line-soft)]">
            <div className="text-[34px] font-normal font-display tracking-[-0.02em] leading-tight">
              {board.history.daysSinceDown ?? "—"}
            </div>
            <div className="text-[13px] text-[var(--ink-muted)] mt-[7px]">
              since anything went down
            </div>
            <div className="text-[12.5px] mt-[5px] text-ok">
              Last was {board.history.lastDownCause || "never"}
            </div>
          </div>
          <div className="flex-1 basis-0 px-[22px] py-[20px] border-r border-[var(--line-soft)]">
            <div className="text-[34px] font-normal font-display tracking-[-0.02em] leading-tight">
              {board.history.migrations ?? "—"}
            </div>
            <div className="text-[13px] text-[var(--ink-muted)] mt-[7px]">
              migrations run
            </div>
            <div className="text-[12.5px] mt-[5px]">All of them applied</div>
          </div>
          <div className="flex-1 basis-0 px-[22px] py-[20px]">
            <div className="text-[34px] font-normal font-display tracking-[-0.02em] leading-tight">
              {board.history.failedWebhooks24h ?? 0}
            </div>
            <div className="text-[13px] text-[var(--ink-muted)] mt-[7px]">
              failed webhooks
            </div>
            <div className="text-[12.5px] mt-[5px] text-ok">
              In the last 24 hours
            </div>
          </div>
        </div>
      )}

      {/* Three columns: Ours/Theirs left, Jobs/Worth knowing right */}
      <div className="flex gap-[22px] items-start px-[30px] pb-[70px]">
        {/* Left column: Ours and Theirs */}
        <div className="flex-1 auto min-w-0">
          {/* Ours block */}
          <div className="bg-white border border-[var(--line)] rounded-[12px] mb-[18px]">
            <div className="flex items-center gap-[10px] px-[17px] py-[14px] border-b border-[var(--line-soft)]">
              <b className="text-[14.5px] font-medium flex-1">Ours</b>
            </div>
            <div className="px-[17px] py-[14px] pt-[6px]">
              {(board.ours || []).map((row, idx) => (
                <div key={row.label} className={`flex items-center gap-[12px] py-[11px] text-[14px] ${idx < (board.ours || []).length - 1 ? 'border-b border-[var(--line-soft)]' : ''}`}>
                  <span className="flex-1">
                    <div className="flex-1">{row.label}</div>
                    <span className="block text-[12.5px] text-[var(--ink-muted)] mt-[2px]">
                      {row.detail}
                    </span>
                  </span>
                  <div className={`inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-[12px] font-medium ${statusBadgeColor(row.state)}`}>
                    {statusBadgeText(row.state)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Theirs block */}
          <div className="bg-white border border-[var(--line)] rounded-[12px]">
            <div className="flex items-center gap-[10px] px-[17px] py-[14px] border-b border-[var(--line-soft)]">
              <b className="text-[14.5px] font-medium flex-1">Theirs</b>
            </div>
            <div className="px-[17px] py-[14px] pt-[6px]">
              {(board.theirs || []).map((row, idx) => (
                <div key={row.label} className={`flex items-center gap-[12px] py-[11px] text-[14px] ${idx < (board.theirs || []).length - 1 ? 'border-b border-[var(--line-soft)]' : ''}`}>
                  {row.state === "not_measured" ? (
                    <>
                      <span className="flex-1">
                        <div className="flex-1">{row.label}</div>
                        <span className="block text-[12.5px] text-[var(--ink-muted)] mt-[2px]">
                          {row.detail}
                        </span>
                      </span>
                      <div className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-[12px] font-medium bg-mute-bg text-mute-decor">
                        Not measured
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="flex-1">
                        <div className="flex-1">{row.label}</div>
                        <span className="block text-[12.5px] text-[var(--ink-muted)] mt-[2px]">
                          {row.detail}
                        </span>
                      </span>
                      <div className={`inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-[12px] font-medium ${statusBadgeColor(row.state)}`}>
                        {statusBadgeText(row.state)}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Jobs and Worth knowing */}
        <div className="w-[320px] flex-shrink-0">
          {/* Jobs block */}
          {board.jobs && board.jobs.length > 0 && (
            <div className="bg-white border border-[var(--line)] rounded-[12px] mb-[18px]">
              <div className="flex items-center gap-[10px] px-[17px] py-[14px] border-b border-[var(--line-soft)]">
                <b className="text-[14.5px] font-medium flex-1">Jobs</b>
              </div>
              <div className="px-[17px] py-[14px] pt-[6px]">
                {board.jobs.map((row, idx) => (
                  <div key={row.label} className={`flex items-center gap-[12px] py-[11px] text-[14px] ${idx < board.jobs.length - 1 ? 'border-b border-[var(--line-soft)]' : ''}`}>
                    <span className="flex-1">
                      <div className="flex-1">{row.label}</div>
                      <span className="block text-[12.5px] text-[var(--ink-muted)] mt-[2px]">
                        {row.detail}
                      </span>
                    </span>
                    <div className={`inline-flex items-center h-[21px] px-[9px] rounded-[5px] text-[12px] font-medium ${statusBadgeColor(row.state)}`}>
                      {statusBadgeText(row.state)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Worth knowing block */}
          <div className="bg-white border border-[var(--line)] rounded-[12px]">
            <div className="flex items-center gap-[10px] px-[17px] py-[14px] border-b border-[var(--line-soft)]">
              <b className="text-[14.5px] font-medium flex-1">Worth knowing</b>
            </div>
            <div className="px-[17px] py-[14px] pt-[6px]">
              <p className="text-[13px] text-[var(--ink-muted)] m-0 py-[10px]">
                Platform prompts would appear here when configured.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ScreenState>
  );
}
