// ProgramSelect — pick ONE program (a service / package / plan belongs to one). `value` is an id or "" / null for none.
import { usePrograms } from "./programs.js";

export default function ProgramSelect({ value = null, onChange, disabled = false, allowNone = true, noneLabel = "No program", testId = "program-select", id }) {
  const { programs, loading } = usePrograms();
  if (loading || programs.length === 0) return null;
  return (
    <select id={id} data-testid={testId} disabled={disabled} value={value ?? ""} onChange={(e) => onChange?.(e.target.value || null)}
            className="h-(--size-filter) rounded-control border border-line bg-surface px-2.75 text-control text-ink">
      {allowNone && <option value="">{noneLabel}</option>}
      {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
