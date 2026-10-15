// A program shown as a small pill with its colour dot. `programId` (resolved through the shared list) or an explicit `program` object.
import { usePrograms } from "./programs.js";
import { NO_PROGRAM_COLOUR } from "./programs.js";

export default function ProgramChip({ programId = null, program = null, testId = "program-chip" }) {
  const { byId } = usePrograms();
  const p = program ?? (programId ? byId(programId) : null);
  if (!p) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-2 py-0.5 text-meta text-ink" data-testid={testId} data-program-id={p.id}>
      <span className="size-2 rounded-full" style={{ background: p.colour ?? NO_PROGRAM_COLOUR }} aria-hidden="true" />{p.name}
    </span>
  );
}

/** A row of chips for an id array (`program_ids`). Empty → an em dash, so a cell never reads as broken. */
export function ProgramChips({ ids = [], testId = "program-chips" }) {
  const { programs } = usePrograms();
  const list = (Array.isArray(ids) ? ids : []).filter((id) => id && programs.some((p) => p.id === id));
  if (!list.length) return <span className="text-faint">—</span>;
  return <span className="inline-flex flex-wrap gap-1" data-testid={testId}>{list.map((id) => <ProgramChip key={id} programId={id} />)}</span>;
}
