// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatJobs — platform jobs view. Ported from
// webui/src/lib/screens/platform/PlatJobs.svelte (387 lines).
// Props: none. Loads jobs data via api.platformJobs and runs jobs via api.runJobNow.
// Archetype: none (part — composes kit primitives).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import PlatJobsTable1Table from "./PlatJobsTable1Table.jsx";

export default function PlatJobs() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [selectedRunTask, setSelectedRunTask] = useState(null);
  const [runNowLoading, setRunNowLoading] = useState(false);

  const loadJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.platformJobs();
      setData(result);
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

  const handleRunNow = async (taskName) => {
    setRunNowLoading(true);
    try {
      await api.runJobNow({ task: taskName });
      // Reload the jobs list
      await loadJobs();
    } catch (err) {
      setError(err instanceof ApiError ? err : { message: String(err?.message ?? err) });
    } finally {
      setRunNowLoading(false);
      setSelectedRunTask(null);
    }
  };

  function formatDuration(ms) {
    if (ms === null || ms === undefined) return "—";
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = seconds / 60;
    return `${Math.floor(minutes)}m ${Math.floor(seconds % 60)}s`;
  }

  function formatLastRun(timestamp) {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? "minute" : "minutes"} ago`;
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
    if (diffDays === 1) return "Yesterday";
    return date.toLocaleDateString();
  }

  function countRunning() {
    if (!data?.jobs) return 0;
    return data.jobs.filter((j) => j.state === "Waiting").length;
  }

  function countFailed() {
    if (!data?.jobs) return 0;
    return data.jobs.filter((j) => j.state === "Failed").length;
  }

  function getDaysSinceFailed() {
    if (!data?.failures || data.failures.length === 0) return null;
    const latestFailure = data.failures[0];
    const date = new Date(latestFailure.lastSeenAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / 86400000);
  }

  useEffect(() => {
    loadJobs();
  }, []);

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (error?.kind === "denied") {
    return <ScreenState phase="denied" testIds={{ denied: "screen-denied" }} />;
  }

  if (error) {
    return <ScreenState phase="error" error={error} onRetry={loadJobs} />;
  }

  if (!data?.jobs || data.jobs.length === 0) {
    return <EmptyState kind="first-run" icon="IconServer" headline="Nothing has run yet." />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-auto px-[30px] pt-[26px] pb-[70px]">
        <div className="mb-[18px] flex items-end justify-between gap-4">
          <div className="flex-1">
            <h1 className="m-0 mb-[6px] font-serif text-2xl font-medium tracking-[-0.01em]">
              Jobs
            </h1>
            <div className="text-mute text-[13.5px]">
              {countRunning() > 0 && <span>{countRunning()} running. </span>}
              {countFailed() > 0 ? (
                <span>{countFailed()} failed.</span>
              ) : getDaysSinceFailed() !== null ? (
                <span>Nothing has failed in {getDaysSinceFailed()} days.</span>
              ) : (
                <span>All clear.</span>
              )}
            </div>
          </div>
          <div className="relative">
            <Button
              disabled={runNowLoading}
              onClick={() => setSelectedRunTask(selectedRunTask ? null : "menu")}
              variant="outline"
            >
              Run one now
            </Button>
            {selectedRunTask && (
              <div className="absolute right-0 top-full mt-2 min-w-[200px] rounded-lg border border-line bg-white shadow-lg z-50">
                {data.jobs
                  .filter((j) => j.state !== "Running")
                  .map((job) => (
                    <button
                      key={job.task}
                      className="block w-full px-4 py-3 text-left text-sm hover:bg-hair disabled:opacity-50 disabled:cursor-not-allowed border-b border-hair last:border-b-0"
                      onClick={() => handleRunNow(job.task)}
                      disabled={runNowLoading}
                    >
                      {job.label}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        <PlatJobsTable1Table
          data={data}
          formatDuration={formatDuration}
          formatLastRun={formatLastRun}
        />

        <div className="mt-[30px]">
          <div className="rounded-lg border border-line bg-white p-4">
            <h3 className="m-0 mb-[14px] font-medium">If a job fails</h3>
            <ul className="m-0 list-none p-0">
              <li className="flex flex-col gap-[3px] border-b border-hair py-[11px] first:pt-0 last:border-b-0">
                It retries five times
                <span className="text-mute text-[12.5px]">Backing off each time</span>
              </li>
              <li className="flex flex-col gap-[3px] border-b border-hair py-[11px] first:pt-0 last:border-b-0">
                Then it stops and tells you
                <span className="text-mute text-[12.5px]">Rather than silently doing nothing for a week</span>
              </li>
              <li className="flex flex-col gap-[3px] border-b border-hair py-[11px] first:pt-0 last:border-b-0">
                Nothing is sent twice
                <span className="text-mute text-[12.5px]">Every job records what it did before it does the next one</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
