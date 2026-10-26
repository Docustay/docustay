// ListSkeleton — the list's loading state (the StateListLoading frame draws a skeleton, so R-41's spinner
// yields here). Ported from webui/src/lib/lists/ListSkeleton.svelte: same testid and hidden "Loading…".
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";

export default function ListSkeleton({ columns = [], rows = 6 }) {
  const cols = columns.length ? columns : Array(3).fill(null);
  const grid = { gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, 1fr)` };
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="list-loading-skeleton" aria-busy="true">
      <p role="status" className="sr-only">Loading…</p>
      <div className="grid h-(--size-row-head) items-center gap-4 border-b border-line bg-surface-2 px-4" style={grid}>
        {cols.map((_, i) => <Skeleton key={i} className="h-3 w-1/2" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid h-(--size-row) items-center gap-4 border-b border-hair px-4 last:border-b-0" style={grid}>
          {cols.map((_, i) => <Skeleton key={i} className={i === 0 ? "h-3.5 w-[70%]" : "h-3.5 w-full"} />)}
        </div>
      ))}
    </div>
  );
}
