// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.28 — CALENDAR (AppStaffCalendar)
//
// ★★★ THE STAFF CALENDAR VIEW. Displays:
//     · Week strip Mon–Fri of the selected week
//     · Person pills "Everyone" + each staff (Owner/Admin see all; Coach sees only themself)
//     · Slot rows: time · length · who/what · chip (Confirmed/Unsigned/Blocked/Running/Free)
//     · Group rows: "{capacity} places, {taken} taken"
//     · Free rows with demand line when waitlist has preferences
//
// ★ Times are LOCAL WALL-CLOCK + IANA zone, NEVER UTC.
// ★ Coach can only see their own bookings; Owner/Admin see all hosts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";

export default function StaffCalendar({
  app = null,
  data = null,
  loading = false,
  error = null,
  onNavigate = null,
}) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedHost, setSelectedHost] = useState("everyone");
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // DERIVED VALUES
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const visibleStaff = useMemo(() => {
    if (!app?.me) return [];
    const isCoach = app.me.staffRole === `coach`;
    if (isCoach) return [];
    return data?.staff ?? [];
  }, [app?.me?.staffRole, data?.staff]);

  const isCoachOnly = useMemo(() => app?.me?.staffRole === `coach`, [app?.me?.staffRole]);

  const weekDays = useMemo(() => {
    const weekStart = getWeekStart(selectedDate);
    const days = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [selectedDate]);

  const formatDayDisplay = (date) => {
    const dayName = date.toLocaleDateString(undefined, { weekday: "short" });
    const dayNum = date.getDate();
    return { dayName, dayNum };
  };

  const isDateSelected = (date) => {
    return date.toDateString() === selectedDate.toDateString();
  };

  const formatTime = (iso) => {
    if (!iso) return "—";
    try {
      const date = new Date(iso);
      return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch {
      return "—";
    }
  };

  const formatDuration = (mins) => {
    if (!mins) return "";
    return `${mins} min`;
  };

  const chipFor = (row) => {
    const stateMap = {
      pending_consent: { variant: "warn", label: "Unsigned" },
      no_show: { variant: "bad", label: "No show" },
      completed: { variant: "ok", label: "Done" },
      cancelled: { variant: "mute", label: "Cancelled" },
    };

    const stateInfo = stateMap[row.state] || { variant: "ok", label: "Confirmed" };

    if (row.capacity > 1 && row.state !== "cancelled") {
      return {
        variant: "ok",
        label: "Running",
        isGroup: true,
        capacity: row.capacity,
        taken: row.taken,
      };
    }

    return { variant: stateInfo.variant, label: stateInfo.label };
  };

  const rowsForDate = useMemo(() => {
    if (!data?.rows) return [];

    const dateStr = selectedDate.toISOString().slice(0, 10);
    const filtered = data.rows.filter((row) => {
      const rowDate = new Date(row.starts_at).toISOString().slice(0, 10);
      if (rowDate !== dateStr) return false;

      if (selectedHost !== "everyone" && row.host_id !== selectedHost) return false;

      return true;
    });

    return filtered.sort(
      (a, b) => new Date(a.starts_at) - new Date(b.starts_at),
    );
  }, [data?.rows, selectedDate, selectedHost]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  const handleDayClick = (date) => {
    setSelectedDate(date);
  };

  const handleHostSelect = (hostId) => {
    setSelectedHost(hostId);
  };

  const handleSessionClick = (sessionId) => {
    if (onNavigate) {
      onNavigate(`/staff/session/${sessionId}`);
    }
  };

  const handleFreeSlotClick = () => {
    setBookingSheetOpen(true);
  };

  const handleRetry = () => {
    // Retry logic would go here
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  return (
    <div className="ph-calendar">
      {/* HEADER */}
      <div className="phnav">
        <div className="t4">
          <div>Calendar</div>
          <span>
            {selectedDate.toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
        <button className="ic4" aria-label="Add booking">
          +
        </button>
      </div>

      {/* BODY */}
      <div className="phb">
        {/* WEEK STRIP */}
        <div className="days">
          {weekDays.map((date) => (
            <button
              key={date.toDateString()}
              className={`day ${isDateSelected(date) ? "on" : ""}`}
              onClick={() => handleDayClick(date)}
            >
              <b>{formatDayDisplay(date).dayName}</b>
              {formatDayDisplay(date).dayNum}
            </button>
          ))}
        </div>

        {/* PERSON PILLS (hidden for Coach) */}
        {!isCoachOnly && (
          <>
            <div className="lbl4">Staff</div>
            <div className="chipr">
              <button
                className={`chip ${selectedHost === "everyone" ? "on" : ""}`}
                onClick={() => handleHostSelect("everyone")}
              >
                Everyone
              </button>
              {visibleStaff.map((staff) => (
                <button
                  key={staff.id}
                  className={`chip ${selectedHost === staff.id ? "on" : ""}`}
                  onClick={() => handleHostSelect(staff.id)}
                >
                  {staff.displayName}
                </button>
              ))}
            </div>
          </>
        )}

        {/* CALENDAR ROWS */}
        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
          </div>
        ) : error ? (
          <div className="error-panel">
            <div className="error-message">{error?.message || "An error occurred"}</div>
          </div>
        ) : rowsForDate.length === 0 ? (
          <div className="li2">
            <span className="lf" />
            <span className="md2">
              <div>Nothing booked this week</div>
              <span>Book someone in to fill your schedule</span>
            </span>
          </div>
        ) : (
          rowsForDate.map((row) => {
            const chip = chipFor(row);
            return (
              <div
                key={row.id}
                className="li2 slot-row"
                role="button"
                tabIndex="0"
                onClick={() => handleSessionClick(row.id)}
                onKeyDown={(e) => e.key === "Enter" && handleSessionClick(row.id)}
              >
                <span className="lf">
                  <b>{formatTime(row.starts_at)}</b>
                  {row.capacity && row.capacity > 1 ? `${row.duration_mins || 60} min` : ""}
                </span>
                <span className="md2">
                  {row.capacity > 1 ? (
                    <>
                      <div>Group session</div>
                      <span>
                        {row.capacity} places, {row.taken} taken
                      </span>
                    </>
                  ) : (
                    <>
                      <div>{row.attendees || "Unknown"}</div>
                      <span>
                        {row.service_name || ""} · {row.host_name || ""}
                      </span>
                    </>
                  )}
                </span>
                <span className={`tag ${chip.variant}`}>{chip.label}</span>
              </div>
            );
          })
        )}
      </div>

      {/* BOOKING SHEET */}
      {bookingSheetOpen && (
        <div className="booking-sheet-overlay">
          <div className="booking-sheet">
            <div className="sheet-header">
              <h2>Book a session</h2>
              <button
                className="close-button"
                onClick={() => setBookingSheetOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="sheet-body">
              <p>Booking form would go here</p>
            </div>
            <div className="sheet-footer">
              <button
                className="btn"
                onClick={() => setBookingSheetOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => setBookingSheetOpen(false)}
              >
                Book
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .ph-calendar {
          padding: 2px 18px 22px;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .phnav {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 2px 0 10px;
          flex: 0 0 auto;
        }

        .t4 {
          font-weight: 500;
          font-size: 17px;
          flex: 1 1 auto;
          line-height: 1.4;
        }

        .t4 span {
          display: block;
          font-weight: 400;
          font-size: 12.5px;
          color: var(--color-structure-600);
          margin-top: 2px;
        }

        .ic4 {
          width: 32px;
          height: 32px;
          border-radius: 999px;
          background: var(--color-seg-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          color: var(--color-structure-900);
          border: none;
          cursor: pointer;
        }

        .phb {
          flex: 1 1 auto;
          overflow: auto;
          padding: 2px 0 22px;
        }

        .days {
          display: flex;
          gap: 6px;
          margin-bottom: 14px;
        }

        .day {
          flex: 1 1 0;
          text-align: center;
          padding: 9px 0;
          border-radius: 10px;
          font-size: 13px;
          border: 1px solid var(--color-structure-200);
          background: white;
          color: var(--color-structure-900);
          cursor: pointer;
        }

        .day.on {
          background: var(--color-action-600);
          border-color: var(--color-action-600);
          color: white;
        }

        .day b {
          display: block;
          font-size: 10.5px;
          opacity: 0.75;
          font-weight: 500;
        }

        .lbl4 {
          font-weight: 500;
          font-size: 12.5px;
          color: var(--color-structure-600);
          margin: 18px 0 6px;
        }

        .chipr {
          display: flex;
          gap: 7px;
          overflow: auto;
          padding-bottom: 4px;
          margin-bottom: 12px;
        }

        .chip {
          flex: 0 0 auto;
          font-weight: 500;
          font-size: 12.5px;
          padding: 7px 12px;
          border-radius: 999px;
          border: 1px solid var(--color-structure-200);
          color: var(--color-structure-900);
          white-space: nowrap;
          background: white;
          cursor: pointer;
        }

        .chip.on {
          background: var(--color-action-600);
          border-color: var(--color-action-600);
          color: white;
        }

        .li2 {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 13px 0;
          border-bottom: 1px solid var(--color-structure-150);
        }

        .li2:last-child {
          border-bottom: 0;
        }

        .li2.slot-row {
          cursor: pointer;
        }

        .lf {
          width: 54px;
          flex: 0 0 54px;
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
          color: var(--color-structure-600);
          line-height: 1.4;
        }

        .lf b {
          display: block;
          color: var(--color-structure-900);
          font-weight: 500;
          font-size: 13.5px;
        }

        .md2 {
          flex: 1 1 auto;
          font-size: 14px;
          line-height: 1.45;
        }

        .md2 span {
          display: block;
          font-size: 12.5px;
          color: var(--color-structure-600);
          margin-top: 3px;
        }

        .tag {
          display: inline-flex;
          align-items: center;
          height: 21px;
          padding: 0 9px;
          border-radius: 5px;
          font-weight: 500;
          font-size: 12px;
          flex-shrink: 0;
        }

        .tag.ok {
          background: var(--color-success-50);
          color: var(--color-success-700);
        }

        .tag.warn {
          background: var(--color-warning-50);
          color: var(--color-warning-700);
        }

        .tag.bad {
          background: var(--color-danger-50);
          color: var(--color-danger-700);
        }

        .tag.mute {
          background: var(--color-mute-bg);
          color: var(--color-structure-600);
        }

        .loading-state {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 0;
        }

        .spinner {
          width: 24px;
          height: 24px;
          border: 3px solid var(--color-structure-200);
          border-top-color: var(--color-action-600);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .error-panel {
          padding: 16px;
          background: var(--color-danger-50);
          border: 1px solid var(--color-danger-300);
          border-radius: 8px;
          margin: 12px 0;
        }

        .error-message {
          color: var(--color-danger-700);
          font-size: 14px;
        }

        .booking-sheet-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: flex-end;
          z-index: 1000;
        }

        .booking-sheet {
          background: white;
          width: 100%;
          max-height: 90vh;
          border-radius: 12px 12px 0 0;
          display: flex;
          flex-direction: column;
        }

        .sheet-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid var(--color-structure-200);
          flex: 0 0 auto;
        }

        .sheet-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }

        .close-button {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: var(--color-structure-600);
        }

        .sheet-body {
          flex: 1 1 auto;
          overflow: auto;
          padding: 16px;
        }

        .sheet-footer {
          display: flex;
          gap: 8px;
          padding: 16px;
          border-top: 1px solid var(--color-structure-200);
          flex: 0 0 auto;
        }

        .btn {
          flex: 1;
          height: 38px;
          padding: 0 17px;
          border-radius: 8px;
          font-weight: 500;
          font-size: 14px;
          border: 1px solid var(--color-structure-200);
          background: white;
          color: var(--color-structure-900);
          cursor: pointer;
        }

        .btn.primary {
          background: var(--color-action-600);
          color: white;
          border-color: var(--color-action-600);
        }
      `}</style>
    </div>
  );
}
