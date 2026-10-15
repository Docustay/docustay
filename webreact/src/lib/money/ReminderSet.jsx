// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ReminderSet — Shows a list of scheduled reminders with delete affordances.
// Ported from webui/src/lib/money/ReminderSet.svelte — same props, testids, and behavior.
// Purely presentational + emits change events; the parent owns the save call.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Trash2 } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { ICON_STROKE } from "@/lib/empty/icons.js";

export default function ReminderSet({ reminders = [], onRemove = null, testId = "money-reminder-set" }) {
  return (
    <div className="w-full" data-testid={testId}>
      {reminders.length === 0 ? (
        <p className="text-meta text-mute m-0 py-2">No reminders scheduled.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {reminders.map((reminder) => (
            <div
              key={reminder.id}
              className="flex items-center justify-between py-2.5 text-ui border-b border-hair last:border-b-0"
            >
              <span className="text-ink flex-1">{reminder.label}</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => onRemove?.(reminder.id)}
                aria-label="Delete reminder"
              >
                <Trash2 strokeWidth={ICON_STROKE} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
