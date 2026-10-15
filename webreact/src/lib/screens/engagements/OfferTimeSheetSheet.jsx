import { request, ApiError } from "@/lib/api.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";

export default function OfferTimeSheetSheet({
  open,
  onOpenChange,
  entry,
  hosts,
  onCancel,
  testId,
  hostOptions,
  hostId,
  setHostId,
  date,
  setDate,
  slots,
  slotsPhase,
  slotsError,
  chosen,
  setChosen,
  busy,
  setBusy,
  error,
  setError,
  localTimeLabel,
  onOffered,
}) {
  async function handleSave() {
    setError(null);
    if (!hostId) {
      setError("Pick a host — slots are for one person's calendar.");
      return;
    }
    if (!chosen) {
      setError("Pick a time to offer.");
      return;
    }
    setBusy(true);
    try {
      await request("/api/engagements/waitlist/offer", {
        method: "POST",
        body: { entryId: entry.id, startsAt: chosen.startsAt, hostId },
      });
      onOffered?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
          : String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SideSheet
      title="Offer a time"
      subtitle={entry?.displayName ?? null}
      onCancel={() => onCancel?.()}
      onSave={handleSave}
      busy={busy}
      error={error}
      testId={testId}
    >
      {hostOptions.length === 0 ? (
        <p data-testid={`${testId}-no-hosts`} style={{ fontSize: "14px", color: "var(--ink-muted)", margin: 0 }}>
          No host is available to check — ask an admin to add team members, or open this from your own calendar.
        </p>
      ) : (
        <>
          <Field orientation="horizontal" data-testid={`${testId}-row-host`}>
            <FieldLabel htmlFor={`${testId}-host`}>Host</FieldLabel>
            <FieldContent>
              <NativeSelect
                id={`${testId}-host`}
                data-testid={`${testId}-host`}
                value={hostId}
                onChange={(e) => setHostId(e.target.value)}
                required
              >
                {hostOptions.map((h) => (
                  <NativeSelectOption key={h.id} value={h.id}>
                    {h.displayName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FieldContent>
          </Field>

          <Field orientation="horizontal" data-testid={`${testId}-row-date`}>
            <FieldLabel htmlFor={`${testId}-date`}>Day</FieldLabel>
            <FieldContent>
              <Input
                id={`${testId}-date`}
                type="date"
                data-testid={`${testId}-date`}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </FieldContent>
          </Field>

          <Field orientation="horizontal" data-testid={`${testId}-row-slots`}>
            <FieldLabel>Time</FieldLabel>
            <FieldContent>
              {slotsPhase === "loading" ? (
                <p data-testid={`${testId}-slots-loading`} style={{ fontSize: "14px", color: "var(--ink-muted)", margin: 0 }}>
                  Loading…
                </p>
              ) : slotsPhase === "error" ? (
                <p data-testid={`${testId}-slots-error`} style={{ fontSize: "14px", color: "var(--ink-muted)", margin: 0 }}>
                  {slotsError}
                </p>
              ) : slots.length === 0 ? (
                <p data-testid={`${testId}-slots-empty`} style={{ fontSize: "14px", color: "var(--ink-muted)", margin: 0 }}>
                  Nothing free that day.
                </p>
              ) : (
                <div data-testid={`${testId}-slots`} style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {slots.map((slot) => (
                    <Button
                      key={slot.startsAt}
                      type="button"
                      size="sm"
                      variant={chosen?.startsAt === slot.startsAt ? "default" : "outline"}
                      data-testid={`${testId}-slot-${slot.startsAt}`}
                      onClick={() => setChosen(slot)}
                    >
                      {localTimeLabel(slot)}
                    </Button>
                  ))}
                </div>
              )}
            </FieldContent>
          </Field>
        </>
      )}
    </SideSheet>
  );
}
