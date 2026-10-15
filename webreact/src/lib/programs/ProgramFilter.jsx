// ProgramFilter — "All programs / <each> / No program" for a list or report. `value` is "all" | "none" | a program id.
// Renders nothing when the practice has fewer than two programs (nothing to filter by).
import { usePrograms } from "./programs.js";

export const matchesProgram = (filter, ids) => {
  if (!filter || filter === "all") return true;
  const list = Array.isArray(ids) ? ids.filter(Boolean) : (ids ? [ids] : []);
  return filter === "none" ? list.length === 0 : list.includes(filter);
};

export default function ProgramFilter({ value = "all", onChange, testId = "program-filter" }) {
  const { programs } = usePrograms();
  if (programs.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 text-control text-mute">
      <span className="sr-only">Filter by program</span>
      <select data-testid={testId} value={value} onChange={(e) => onChange?.(e.target.value)} aria-label="Filter by program"
              className="h-(--size-filter) rounded-control border border-line bg-surface px-2.75 text-control text-ink" data-active={value !== "all" ? "true" : undefined}>
        <option value="all">All programs</option>
        {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="none">No program</option>
      </select>
    </label>
  );
}
