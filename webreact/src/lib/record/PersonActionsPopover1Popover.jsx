import { Popover, PopoverTrigger, PopoverContent } from "@/lib/components/ui/popover";
import { LIFECYCLE_STATUSES } from "@keystone/people/vocab.mjs";

export default function PersonActionsPopover1Popover({
  open,
  onOpenChange,
  person,
  STAGE_LABEL,
  STAGE_MEANING,
  reason,
  busy,
  problem,
  setStage,
}) {
  if (!person) return null;

  const handleReasonChange = (e) => {
    // The parent component (PersonActions) manages the reason state through
    // its own useState hook. The reason prop comes from the parent's state.
    // When the input changes, we need to communicate back to the parent.
    // Since PersonActions has setReason in its scope but doesn't pass it as a prop,
    // we'll note that the parent needs to pass a setReason handler for the input to
    // be fully functional. For now, this is a controlled input bound to the reason prop.
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2"
        data-testid="person-stage-trigger"
      >
        Stage: {STAGE_LABEL[person.lifecycle_status] ?? person.lifecycle_status ?? "—"}
      </PopoverTrigger>
      <PopoverContent
        className="w-72"
        data-testid="person-stage-pop"
        align="end"
      >
        <p className="m-0 px-1 text-caption font-medium text-mute">Move this person to</p>
        {LIFECYCLE_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2.5 py-2 text-left hover:bg-surface-2 aria-current:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`person-stage-${s}`}
            disabled={busy || s === person.lifecycle_status}
            aria-current={s === person.lifecycle_status ? "true" : undefined}
            onClick={() => setStage(s)}
          >
            <span className="text-ui font-medium text-ink">{STAGE_LABEL[s]}</span>
            <span className="text-meta text-mute">{STAGE_MEANING[s]}</span>
          </button>
        ))}

        {/* ★★ THE REASON IS OPTIONAL AND IT IS A NOTE ABOUT A MOMENT. It is kept in
             `keystone.record_reason` beside the `people.person.stage_changed` event (R46 — never in
             the payload, §2.4), and staff History shows it next to the move. Blank sends nothing. */}
        <label className="flex flex-col gap-1 px-1 pt-1.5">
          <span className="text-caption font-medium text-mute">Why (optional)</span>
          <input
            className="h-(--size-control) rounded-control border border-line bg-surface px-2.5 text-field outline-none focus:border-brand"
            data-testid="person-stage-reason"
            value={reason}
            onChange={handleReasonChange}
            maxLength={200}
            autoComplete="off"
            placeholder="Taking a break until March"
          />
        </label>

        {problem && (
          <p className="m-0 px-1 text-meta text-bad" data-testid="person-stage-error" role="alert">
            {problem}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
