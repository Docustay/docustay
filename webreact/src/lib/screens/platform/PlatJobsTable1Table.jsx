// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.045.T1 — PlatJobs › PlatJobsTable1Table: the table as its own component
//
// Ported from webui/src/lib/screens/platform/PlatJobs.svelte:134-173 — the `<table>` element and
// everything inside it. Built on DataTable (kit).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import PlatformJobActions from "../PlatformJobActions.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function PlatJobsTable1Table({ data, formatDuration, formatLastRun }) {
  return (
    <div className="overflow-auto rounded-[12px] border border-line bg-white">
      <table className="w-full border-collapse" data-testid="platform-jobs-table">
        <thead>
          <tr>
            <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Job
            </th>
            <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              How often
            </th>
            <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Last run
            </th>
            <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              How long
            </th>
            <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              Did what
            </th>
            <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
              State
            </th>
            <th className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute"></th>
          </tr>
        </thead>
        <tbody>
          {data?.jobs?.map((job) => (
            <tr key={job.task} className="border-b border-hair last:[&>td]:border-b-0 h-(--size-row)">
              <td className="border-b border-hair px-4 text-ui text-ink">{job.label}</td>
              <td className="border-b border-hair px-4 text-ui text-ink">{job.cadence}</td>
              <td className="border-b border-hair px-4 text-ui text-ink">{formatLastRun(job.lastRun)}</td>
              <td className="border-b border-hair px-4 text-ui text-ink tabular-nums">
                {formatDuration(job.durationMs)}
              </td>
              <td className="border-b border-hair px-4 text-ui text-ink">{job.summary ?? "—"}</td>
              <td className="border-b border-hair px-4 text-ui text-ink">
                {job.state === "Failed" ? (
                  <StatusBadge label="Failed" tone="bad" testId={`job-state-${job.task}`} />
                ) : job.state === "Waiting" ? (
                  <StatusBadge label="Waiting" tone="neutral" testId={`job-state-${job.task}`} />
                ) : (
                  <StatusBadge label="Fine" tone="ok" testId={`job-state-${job.task}`} />
                )}
              </td>
              <td className="border-b border-hair px-4 text-ui text-row-action text-right">
                {job.state === "Failed" && (
                  <PlatformJobActions row={job} failureId={job.failureId} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
