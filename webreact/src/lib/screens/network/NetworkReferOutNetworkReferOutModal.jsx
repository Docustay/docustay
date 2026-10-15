// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.020.M1 — NetworkReferOut › NetworkReferOutNetworkReferOutModal — the modal as its own component
// Ported from webui/src/lib/screens/network/NetworkReferOut.svelte:139-220 (the DecisionModal element
// and everything inside it). Built on DecisionModal (kit2 archetype).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function NetworkReferOutNetworkReferOutModal({
  open,
  onOpenChange,
  onCancel,
  personId,
  onPersonIdChange,
  selectedPartyId,
  onSelectedPartyIdChange,
  reason,
  onReasonChange,
  toldPerson,
  onToldPersonChange,
  copyPerson,
  onCopyPersonChange,
  busy,
  error,
  reasonError,
  peopleOptions,
  partyOptions,
  personLabel,
  partyLabel,
  title,
  confirm,
}) {
  return (
    <DecisionModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle="They get their name and why. Nothing else leaves your practice — no notes, no history, no records."
      cancelLabel="Cancel"
      confirmLabel="Send the referral"
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={confirm}
      toggle={{
        label: `Tell ${personLabel ?? "them"} you've done it`,
        why: "They should hear it from you first. Referring someone without telling them is how trust goes.",
        checked: toldPerson,
        onToggle: onToldPersonChange,
      }}
      testId="network-refer-out"
    >
      <div className="flex flex-col gap-4 pb-3">
        <Field orientation="horizontal" className="pb-1.5">
          <FieldLabel htmlFor="refer-who">Who</FieldLabel>
          <FieldContent>
            <Combobox
              id="refer-who"
              testId="refer-who"
              options={peopleOptions}
              value={personId}
              onValueChange={onPersonIdChange}
              placeholder="Search people"
              emptyText="No people yet."
              disabled={busy}
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal" className="pb-1.5">
          <FieldLabel htmlFor="refer-to">To</FieldLabel>
          <FieldContent>
            <Combobox
              id="refer-to"
              testId="refer-to"
              options={partyOptions}
              value={selectedPartyId}
              onValueChange={onSelectedPartyIdChange}
              placeholder="Search your network"
              emptyText="No practices yet."
              disabled={busy}
            />
          </FieldContent>
        </Field>

        <Field orientation="horizontal" className="pb-1.5">
          <FieldLabel htmlFor="refer-why">Why</FieldLabel>
          <FieldContent>
            <Textarea
              id="refer-why"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="What they need, and why this is a fit"
              maxLength="2000"
              data-testid="refer-why"
              disabled={busy}
            />
            <p className="mt-1.5 text-meta text-mute" data-testid="refer-why-hint">
              {partyLabel} reads this. {personLabel ?? "They"} doesn't, unless you copy them in.
            </p>
            {reasonError && (
              <p className="mt-1.5 text-meta text-bad" data-testid="refer-why-error" role="alert">
                {reasonError}
              </p>
            )}
            <DisabledWithReason
              disabled={true}
              reason="AI drafting isn't built yet."
              testId="refer-write-ai"
            >
              {({ disabled, describedBy }) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  aria-describedby={describedBy}
                  data-testid="refer-write-ai-button"
                  className="mt-2"
                >
                  Write with AI
                </Button>
              )}
            </DisabledWithReason>
          </FieldContent>
        </Field>

        <div
          className="flex items-start gap-3 py-2"
          data-testid="refer-copy-toggle"
        >
          <span className="flex-1 flex flex-col gap-0.5 text-ui text-ink">
            <span>Copy them in on the message</span>
            <span className="text-meta text-mute">So they see exactly what was said about them.</span>
          </span>
          <Switch
            checked={copyPerson}
            disabled={busy}
            data-testid="refer-copy-switch"
            onCheckedChange={onCopyPersonChange}
            className="mt-0.5 flex-shrink-0"
          />
        </div>

        <div
          className="mt-3 rounded-sm bg-brand-soft p-3 text-sm text-ink leading-relaxed"
          data-testid="refer-consequence"
        >
          <b>What {partyLabel} gets.</b> Their name, their email, and what you wrote. Not their notes,
          not their sessions, not their invoices, not their documents. Those never leave.
        </div>
      </div>
    </DecisionModal>
  );
}
