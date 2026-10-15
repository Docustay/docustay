// ProgramPicker — pick MANY programs (a person can be in several) as toggle chips. Controlled: `value` is an array of ids.
// Hidden when the practice has no programs; with ONE program it still shows (a person can be in it or not).
import { usePrograms, NO_PROGRAM_COLOUR } from "./programs.js";

export default function ProgramPicker({ value = [], onChange, disabled = false, label = "Programs", testId = "program-picker" }) {
  const { programs, loading } = usePrograms();
  if (loading || programs.length === 0) return null;
  const set = new Set(value);
  const toggle = (id) => { const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); onChange?.([...next]); };
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      {label && <span className="text-meta text-mute">{label}</span>}
      <div className="flex flex-wrap gap-1.5">
        {programs.map((p) => {
          const on = set.has(p.id);
          return (
            <button key={p.id} type="button" disabled={disabled} aria-pressed={on} data-testid={`${testId}-${p.id}`} onClick={() => toggle(p.id)}
                    className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-control ${on ? "border-brand bg-brand-soft text-ink" : "border-line bg-surface text-mute hover:text-ink"}`}>
              <span className="size-2 rounded-full" style={{ background: p.colour ?? NO_PROGRAM_COLOUR }} aria-hidden="true" />{p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
