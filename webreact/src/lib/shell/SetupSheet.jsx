// "Complete your setup" — the checklist as a right-hand sheet, openable from any screen (R3.014, SetupSheet.svelte).
// ★ Every row that is not done and has a fixUrl gets "Do this", which closes the sheet and goes where the step clears.
import { Check } from "lucide-react";
import CreateSheet from "@/lib/forms/CreateSheet.jsx";
import { Button } from "@/lib/components/ui/button";

export default function SetupSheet({ open = false, groups = [], summary = null, onClose = null, onNavigate = null }) {
  if (!open) return null;
  const done = Number(summary?.done) || 0;
  const total = Number(summary?.total) || 0;
  const title = total > 0 ? `Complete your setup · ${done} of ${total}` : "Complete your setup";
  const visible = (groups ?? []).filter((g) => (g.rows?.length ?? 0) > 0);
  const go = (fixUrl) => { onClose?.(); onNavigate?.(fixUrl); };
  return (
    <CreateSheet title={title} saveLabel="Done" onSave={() => onClose?.()} onCancel={() => onClose?.()}>
      {visible.map((group) => (
        <section key={group.key} className="mb-5" data-testid={`setup-sheet-group-${group.key}`}>
          <h3 className="m-0 mb-2 text-heading font-medium text-ink">{group.title}</h3>
          <ul className="m-0 list-none divide-y divide-hair p-0">
            {group.rows.map((row, i) => (
              <li key={row.title + i} className="flex items-center gap-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ui text-ink">{row.title}</span>
                  {row.status !== "done" && (row.whatIsBlocked || row.whatToDo) ? <span className="text-caption text-mute">{row.whatIsBlocked ?? row.whatToDo}</span> : null}
                </div>
                {row.status === "done"
                  ? <><Check className="size-4 text-ok" aria-hidden="true" /><span className="sr-only">Done</span></>
                  : row.fixUrl ? <Button variant="outline" size="sm" data-testid={`setup-sheet-go-${group.key}-${i}`} onClick={() => go(row.fixUrl)}>Do this</Button> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </CreateSheet>
  );
}
