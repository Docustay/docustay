// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PauseDialog — P3.U6 (W2). Built FROM specs/mockups/SubscriptionPause.frame.html's `.modal`: pause a
// subscription either until a chosen date or until the Owner/Admin presses Resume themselves. The write
// is Stripe-first (WIRING-MAP §3.3): a Stripe refusal rolls the whole thing back and this surface stays
// open, showing Stripe's own reason and reference (write.error) — never a re-worded one (api.js's own rule).
// ★ The request body is exactly CONTRACTS.md §4's `{ subscriptionId }` (F804 corrected path, gate K12) —
//   the resume date chosen below is UI-only until a later task carries it onto the wire.
// ★ `useWrite` decides the permission, not this component: hidden (no `invoice.edit`) renders NOTHING,
//   the same as WriteButton — a control asking a permission it doesn't have IS the defect (CLAUDE.md).
// ★ A missing prerequisite (e.g. Stripe not connected) is `write.blocked`: DisabledWithReason renders
//   the reason and the submit stays disabled, never hidden — a blocked write is not a denied one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import { RadioGroup, RadioGroupItem } from "@/lib/components/ui/radio-group.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";

const MODES = [
  { value: "until_date", label: "Until a date", hint: "Resumes by itself on the date you pick." },
  { value: "until_resume", label: "Until I resume it", hint: "Stays paused until you press Resume." },
];

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * @param subscription { id, personFirstName, blockedReason? } — the host screen's subscription record;
 *   `blockedReason` is the missing prerequisite, if any — a permission (`invoice.edit`) is decided by
 *   `useWrite` itself, never by this prop.
 * @param open, onOpenChange — the surface is only ever shown while `open`; `onOpenChange(false)` on
 *   cancel/close/Escape/after a successful write (ActionSurface owns the busy lock and the discard guard).
 * @param onPaused — called after the subscription is paused, so the host screen can refetch.
 */
export default function PauseDialog({ subscription, open, onOpenChange, onPaused }) {
  const write = useWrite("pauseSubscription", { blockedReason: subscription?.blockedReason ?? null });

  const [mode, setMode] = useState("until_date");
  const [resumeOn, setResumeOn] = useState(tomorrowISO());

  // Reset to this subscription's own defaults every time the surface opens.
  useEffect(() => {
    if (!open) return;
    setMode("until_date");
    setResumeOn(tomorrowISO());
  }, [open, subscription?.id]);

  if (!open || write.hidden) return null;

  const resumeInvalid = mode === "until_date" && (!resumeOn || resumeOn < tomorrowISO());

  async function handleSubmit() {
    if (resumeInvalid || write.blocked) return;
    try {
      await write.run({ subscriptionId: subscription.id });
      onPaused?.();
      onOpenChange?.(false);
    } catch {
      // write.error is already set by useWrite — the surface stays open and shows it (below).
    }
  }

  return (
    <ActionSurface
      kind="dialog"
      testId="pause-dialog"
      title={`Pause ${subscription?.personFirstName ?? ""}’s subscription`}
      busy={write.busy}
      busyLabel="Pausing…"
      submitLabel="Pause"
      cancelLabel="Cancel"
      submitDisabled={resumeInvalid || !!write.blocked}
      onCancel={() => onOpenChange?.(false)}
      onSubmit={handleSubmit}
      error={write.error ? (
        <>
          <span data-testid="pause-dialog-error-message">{write.error.message}</span>
          {write.error.requestId && (
            <>
              <br />
              <span className="text-mute" data-testid="pause-dialog-error-reference">Reference: {write.error.requestId}</span>
            </>
          )}
        </>
      ) : null}
    >
      <p className="m-0 mb-4 text-ui leading-relaxed text-ink-2">
        Nothing is billed while it&rsquo;s paused, and no invoices are drafted.
      </p>

      <RadioGroup value={mode} onValueChange={setMode} data-testid="pause-dialog-mode" className="mb-4 gap-2.5">
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2.5 rounded-control border border-line p-3">
            <RadioGroupItem value={m.value} data-testid={`pause-dialog-mode-${m.value}`} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-field font-medium text-ink">{m.label}</span>
              <span className="text-meta text-mute">{m.hint}</span>
            </span>
          </label>
        ))}
      </RadioGroup>

      {mode === "until_date" && (
        <SheetRow label="Resume on" hint={resumeInvalid ? "Pick a date after today." : null}>
          <DatePicker id="pause-dialog-resume-date" testId="pause-dialog-resume-date" value={resumeOn}
                      minValue={tomorrowISO()} onValueChange={setResumeOn} />
        </SheetRow>
      )}

      {write.blocked && (
        <DisabledWithReason disabled reason={write.blocked.reason} testId="pause-dialog-blocked">
          Pause needs one more thing before it can run.
        </DisabledWithReason>
      )}
    </ActionSurface>
  );
}
