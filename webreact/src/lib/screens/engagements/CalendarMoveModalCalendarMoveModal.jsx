// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.014.M1 — CalendarMoveModalCalendarMoveModal. The modal as its own component, built on DecisionModal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";

export default function CalendarMoveModalCalendarMoveModal({
  open,
  onOpenChange,
  clash,
  label,
  toLabel,
  firstName,
  hostName,
  title,
  subtitle,
  tellClient,
  onTellClientChange,
  sayWhy,
  onSayWhyChange,
  note,
  onNoteChange,
  busy,
  error,
  cancel,
  submit,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={subtitle}
      cancelLabel="Leave it where it was"
      confirmLabel={clash ? "Leave it where it was" : "Move it"}
      toggle={clash ? null : {
        label: `Tell ${firstName}`,
        why: "They get the new time and a fresh reminder. Their old calendar invite is updated.",
        checked: tellClient,
        onToggle: onTellClientChange,
      }}
      busy={busy}
      error={error}
      onCancel={cancel}
      onConfirm={clash ? cancel : submit}
      testId="calendar-move"
    >
      {!clash && (
        <>
          <p
            className="m-0 rounded-sm border border-primary-edge bg-primary-wash p-[--pad-card] text-sm leading-[1.6] text-ink"
            data-testid="calendar-move-free"
          >
            <b className="font-semibold">{toLabel ? toLabel.time : "That time"} is free.</b>
            {" "}Nothing clashes, and it's inside {hostName}'s hours.
          </p>

          <div className="flex flex-col gap-[--gap]" data-testid="calendar-move-saywhy">
            <div className="flex items-start gap-[--gap]">
              <span className="flex flex-1 flex-col gap-0.5 text-ink">
                Say why
                <span className="text-sm text-ink-muted leading-[1.5]">
                  A line from you, in the same message.
                </span>
              </span>
              <Switch
                checked={sayWhy}
                disabled={busy}
                data-testid="calendar-move-saywhy-switch"
                onCheckedChange={onSayWhyChange}
              />
            </div>
            {sayWhy && (
              <Textarea
                data-testid="calendar-move-note"
                maxLength={500}
                placeholder="A line from you, in the same message."
                value={note}
                onChange={(e) => onNoteChange?.(e.target.value)}
              />
            )}
          </div>
        </>
      )}
    </DecisionModal>
  );
}
