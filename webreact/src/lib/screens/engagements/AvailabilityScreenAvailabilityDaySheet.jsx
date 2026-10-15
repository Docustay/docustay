// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AvailabilityScreenAvailabilityDaySheet — the right-hand sheet for editing one day's availability
// Ported from webui/src/lib/screens/engagements/AvailabilityScreen.svelte:306-324
// Props: error, day, daySaving, dayError, saveDay (from parent scope per task)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";

export default function AvailabilityScreenAvailabilityDaySheet({
  error, day, daySaving, dayError, saveDay, onCancel
}) {
  if (!day) return null;

  const [localDay, setLocalDay] = useState(day);

  const handleDateChange = (e) => {
    const newDay = { ...localDay, onDate: e.target.value };
    setLocalDay(newDay);
    day.onDate = e.target.value;
  };

  const handleAvailableChange = (isAvailable) => {
    const newDay = { ...localDay, isAvailable };
    setLocalDay(newDay);
    day.isAvailable = isAvailable;
  };

  const handleStartChange = (e) => {
    const newDay = { ...localDay, start: e.target.value };
    setLocalDay(newDay);
    day.start = e.target.value;
  };

  const handleEndChange = (e) => {
    const newDay = { ...localDay, end: e.target.value };
    setLocalDay(newDay);
    day.end = e.target.value;
  };

  const handleReasonChange = (e) => {
    const newDay = { ...localDay, reason: e.target.value };
    setLocalDay(newDay);
    day.reason = e.target.value;
  };

  return (
    <SideSheet
      title="Change one day"
      onCancel={onCancel}
      onSave={saveDay}
      busy={daySaving}
      error={dayError}
      testId="availability-day-sheet"
    >
      {/* Which day section */}
      <section className="border-b border-hair py-4 last:border-b-0">
        <h3 className="m-0 mb-3.5 text-ui font-medium text-ink">Which day</h3>
        <SheetRow label="Date" htmlFor="av-date" required>
          <input
            id="av-date"
            type="date"
            value={localDay.onDate}
            onChange={handleDateChange}
            required
            className="w-full px-3 py-2 border border-line rounded-control text-ui text-ink bg-surface"
          />
        </SheetRow>
      </section>

      {/* That day section */}
      <section className="border-b border-hair py-4 last:border-b-0">
        <h3 className="m-0 mb-3.5 text-ui font-medium text-ink">That day</h3>
        <div className="space-y-2">
          <label className="flex gap-3 p-3 border border-line rounded-control cursor-pointer hover:bg-paper">
            <input
              type="radio"
              name="av-kind"
              checked={localDay.isAvailable}
              onChange={() => handleAvailableChange(true)}
            />
            <div className="flex-1">
              <div className="font-medium text-ink">Custom hours</div>
              <div className="text-xs text-mute mt-1">Only these hours. Replaces the usual day for this date.</div>
            </div>
          </label>
          <label className="flex gap-3 p-3 border border-line rounded-control cursor-pointer hover:bg-paper">
            <input
              type="radio"
              name="av-kind"
              checked={!localDay.isAvailable}
              onChange={() => handleAvailableChange(false)}
            />
            <div className="flex-1">
              <div className="font-medium text-ink">Not working</div>
              <div className="text-xs text-mute mt-1">Nobody can book this day. Sessions already booked stay put.</div>
            </div>
          </label>
        </div>
      </section>

      {/* Hours - only shown when isAvailable */}
      {localDay.isAvailable && (
        <section className="border-b border-hair py-4 last:border-b-0">
          <h3 className="m-0 mb-3.5 text-ui font-medium text-ink">Hours</h3>
          <SheetRow label="Hours">
            <div className="flex gap-2.5">
              <input
                type="time"
                step="300"
                value={localDay.start}
                onChange={handleStartChange}
                aria-label="From"
                className="flex-1 px-3 py-2 border border-line rounded-control text-ui text-ink bg-surface"
              />
              <input
                type="time"
                step="300"
                value={localDay.end}
                onChange={handleEndChange}
                aria-label="To"
                className="flex-1 px-3 py-2 border border-line rounded-control text-ui text-ink bg-surface"
              />
            </div>
          </SheetRow>
        </section>
      )}

      {/* Note section */}
      <section className="border-b border-hair py-4 last:border-b-0">
        <SheetRow label="Note" htmlFor="av-note" optional>
          <input
            id="av-note"
            type="text"
            value={localDay.reason}
            onChange={handleReasonChange}
            placeholder="Optional"
            className="w-full px-3 py-2 border border-line rounded-control text-ui text-ink bg-surface placeholder:text-mute"
          />
          <p className="mt-1.5 text-meta leading-normal text-mute">Only you see this.</p>
        </SheetRow>
      </section>
    </SideSheet>
  );
}
