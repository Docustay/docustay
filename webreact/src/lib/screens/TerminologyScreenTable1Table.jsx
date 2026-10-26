// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.038.T1 — TerminologyScreen › TerminologyScreenTable1Table: the table as its own component
// (The Identifier column was dropped 23 Oct 2026: a dotted key means nothing to the person editing a word.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Input } from "@/lib/components/ui/input.jsx";

export default function TerminologyScreenTable1Table({ canWrite = false, terms = [], draft = {}, busy = false, onDraftChange = null }) {
  const handleInputChange = (termKey, value) => {
    if (onDraftChange) {
      onDraftChange(termKey, value);
    }
  };

  return (
    <div className="overflow-auto rounded-card border border-line bg-surface">
      <table className="w-full border-collapse" data-testid="terminology-table">
        <thead>
          <tr>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">Default</th>
            <th scope="col" className="h-(--size-row-head) border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">This practice calls it</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((t) => (
            <tr key={t.key} data-testid={`term-row-${t.key}`}>
              <th scope="row" data-testid={`term-default-${t.key}`} className="h-(--size-row) border-b border-hair px-4 text-left text-ui font-medium text-ink">
                {t.fallback}
              </th>
              <td className="h-(--size-row) border-b border-hair px-4 text-ui">
                <Input
                  type="text"
                  data-testid={`term-input-${t.key}`}
                  value={draft[t.key] ?? ""}
                  placeholder={t.fallback}
                  aria-label={`What this practice calls "${t.fallback}"`}
                  disabled={!canWrite || busy}
                  maxLength="60"
                  onChange={(e) => handleInputChange(t.key, e.currentTarget.value)}
                  className="h-8"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
