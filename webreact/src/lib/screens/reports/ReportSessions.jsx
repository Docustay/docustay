// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.011 — SESSIONS REPORT. Figures, day bars, no-show rows, the Friday/evenings prompt, and
// "Where sessions happen" — inside `LedgerPage`. Ported structurally from
// `specs/mockups/ReportSessions.frame.html` and `webui/src/lib/screens/reports/ReportSessions.svelte`.
//
// ★★★ CRITICAL CORRECTNESS RULE — DO NOT PORT THE FRAME'S "Once. You waived it." LINE.
//     `keystone.report_sessions()` (`db/migrations/0450_report_sessions.sql:187-194`, MEASURED)
//     returns `no_show_rows` as `[{ person_id, display_name, count }]` ONLY — there is no
//     `waived_count` field anywhere in that payload, and no per-person waiver concept exists in
//     this product at all. The frame's third row ("Tom Beck · Once. You waived it.") describes a
//     fact the system does not record. A no-show row here renders ONLY `display_name` and `count`,
//     formatted "{name} · {count}" — nothing more. See `noShowRows` below.
//
// ★ MONEY FIGURE IS CONDITIONAL ON THE PAYLOAD, NOT ON THE VIEWER'S ROLE. The function
//   (`0450_report_sessions.sql:207-240`) OMITS the `no_show_value_minor` key entirely — not
//   `null`, ABSENT — when the viewer is scoped to their own bookings (a Coach). `hasMoney` below
//   checks for the KEY'S PRESENCE (`hasOwnProperty`), never a role name the client would have to
//   guess at, so a Coach viewer never sees a dollar figure for no-shows.
//
// ★ THE FRIDAY/EVENINGS PROMPT ONLY RENDERS WHEN THE DATA ACTUALLY SUPPORTS IT (Friday's count is
//   the lowest, or near it, against the payload's own `by_weekday`) — same discipline as the
//   no-show fix above. The frame's copy also claims "four people are on the waitlist for evenings
//   you don't offer", which is not a field `report_sessions` returns; that clause is not ported.
//   `PromptCard` itself refuses to render without a `why` — a prompt built from data that isn't
//   there is exactly what that guard exists to catch, so the guard here does the same job one
//   level up: no supporting numbers, no prompt.
//
// ★ SELF-FETCHING, WITH A TEST ESCAPE HATCH. `api.report("sessions", …)` is called on mount, same
//   shape as other screens — EXCEPT an optional `data` prop, when supplied, is used as the payload
//   directly and the fetch is skipped. That is what lets the DOM test drive every branch (money
//   present/absent, first-run empty, no-show rows) without a network call.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import Chart from "./Chart.jsx";
import ReportSessionsDidnTTurnUpOrCancelledLateTable from "./ReportSessionsDidnTTurnUpOrCancelledLateTable.jsx";
import ReportSessionsWhereSessionsHappenTable from "./ReportSessionsWhereSessionsHappenTable.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// ★ Full names for prose ("21 on Thursdays") — the abbreviated `WEEKDAY_LABELS` above cannot be
//   pluralized by appending "s" ("Thu" + "s" = "Thus", not "Thursdays").
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LOCATION_LABELS = { in_person: "In person", video: "Video call", phone: "Phone", other: "Other" };

export default function ReportSessions({ app = null, onNavigate = null, data = null }) {
  const [payload, setPayload] = useState(data);
  const [screenPhase, setScreenPhase] = useState(data ? "ready" : "loading");
  const [errorInfo, setErrorInfo] = useState(null);
  const [range, setRange] = useState("this-month");
  const [compare, setCompare] = useState(false);

  function computeDates(sel) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (sel === "last-3-months") {
      return {
        from: new Date(y, m - 2, 1), to: new Date(y, m + 1, 1),
        compareFrom: new Date(y, m - 5, 1), compareTo: new Date(y, m - 2, 1),
      };
    }
    if (sel === "this-quarter") {
      const qStart = Math.floor(m / 3) * 3;
      return {
        from: new Date(y, qStart, 1), to: new Date(y, qStart + 3, 1),
        compareFrom: new Date(y, qStart - 3, 1), compareTo: new Date(y, qStart, 1),
      };
    }
    // "this-month" and "custom" (no custom picker on this screen yet) both fall back to this month.
    return {
      from: new Date(y, m, 1), to: new Date(y, m + 1, 1),
      compareFrom: new Date(y, m - 1, 1), compareTo: new Date(y, m, 1),
    };
  }

  const isoDate = (d) => d.toISOString().slice(0, 10);

  async function load() {
    setScreenPhase("loading");
    setErrorInfo(null);
    try {
      const { from, to, compareFrom, compareTo } = computeDates(range);
      const result = await api.report("sessions", {
        from: isoDate(from), to: isoDate(to),
        compareFrom: isoDate(compareFrom), compareTo: isoDate(compareTo),
      });
      setPayload(result);
      setScreenPhase("ready");
    } catch (err) {
      setErrorInfo(err);
      setScreenPhase("error");
    }
  }

  useEffect(() => {
    if (!data) load();
  }, []);

  function handleRange(next) {
    setRange(next);
    if (!data) load();
  }

  function handleCompare(next) {
    setCompare(next);
  }

  // ── DERIVED VIEW DATA ─────────────────────────────────────────────────────────────────────────
  const enoughData = payload?.enough_data ?? { enough: false, days_going: 0, payments: 0 };
  const enough = enoughData.enough === true;

  // ★★★ KEY PRESENCE, NOT ROLE — see header note.
  const hasMoney = !!payload && Object.prototype.hasOwnProperty.call(payload, "no_show_value_minor");

  const formatMoney = (minor) =>
    `$${Math.round((minor ?? 0) / 100).toLocaleString("en-US")}`;

  const held = payload?.held ?? 0;
  const heldDelta = held - (payload?.held_compare ?? 0);
  const heldDeltaText = (() => {
    if (heldDelta > 0) return `${heldDelta} more than last period`;
    if (heldDelta < 0) return `${Math.abs(heldDelta)} fewer than last period`;
    return "Same as last period";
  })();

  const noShows = payload?.no_shows ?? 0;
  const noShowDetail = (() => {
    const charged = payload?.no_show_charged_count ?? 0;
    if (hasMoney) {
      return `Worth ${formatMoney(payload?.no_show_value_minor)} — you charged for ${charged}`;
    }
    return `You charged for ${charged}`;
  })();

  const bookedSharePct = payload?.booked_share_pct ?? 0;
  const bookedShareComparePct = payload?.booked_share_compare_pct ?? 0;
  const bookedShareDeltaText = (() => {
    if (bookedSharePct > bookedShareComparePct) return `Up from ${bookedShareComparePct}%`;
    if (bookedSharePct < bookedShareComparePct) return `Down from ${bookedShareComparePct}%`;
    return "Same as last period";
  })();

  // ★ Day bars — Chart draws the bars; Busy/Busiest/Quiet is this screen's own label, computed from
  //   the same counts, never invented.
  const dayBars = (() => {
    const rows = Array.isArray(payload?.by_weekday) ? payload.by_weekday : [];
    const max = rows.reduce((m, r) => Math.max(m, r.count ?? 0), 0);
    return rows.map((r) => {
      const count = r.count ?? 0;
      let label = "Quiet";
      if (max > 0 && count === max) label = "Busiest";
      else if (max > 0 && count >= max * 0.6) label = "Busy";
      return { dow: r.dow, day: WEEKDAY_LABELS[r.dow] ?? String(r.dow), count, label };
    });
  })();

  // ★★★ THE CORRECTED ROW — display_name and count, joined, and nothing else. See header note.
  const noShowRows = (() => {
    const rows = Array.isArray(payload?.no_show_rows) ? payload.no_show_rows : [];
    return rows.map((r) => ({ row: `${r.display_name} · ${r.count}` }));
  })();

  const locationRows = (() => {
    const rows = Array.isArray(payload?.by_location) ? payload.by_location : [];
    return rows.map((r) => ({
      where: LOCATION_LABELS[r.location_kind] ?? r.location_kind ?? "Not set",
      sessions: r.count ?? 0,
    }));
  })();

  // ★ Friday/evenings prompt — only when the payload's own numbers back the claim.
  const fridayPrompt = (() => {
    const bars = dayBars;
    if (!bars.length) return null;
    const friday = bars.find((d) => d.dow === 5);
    if (!friday || friday.label === "Busy" || friday.label === "Busiest") return null;
    const busiest = bars.reduce((a, b) => (b.count > (a?.count ?? -1) ? b : a), null);
    if (!busiest || busiest.count <= friday.count) return null;
    return {
      headline: "Fridays are your quietest day",
      why: `${friday.count} sessions on Fridays against ${busiest.count} on ${WEEKDAY_FULL[busiest.dow]}s.`,
    };
  })();

  const headlineText = (() => {
    if (!payload) return "";
    let text = `${held} session${held === 1 ? "" : "s"} this period.`;
    if (noShows > 0) text += ` ${noShows} went unattended.`;
    return text;
  })();

  if (screenPhase === "loading") {
    return <ScreenState phase="loading" testIds={{ loading: "report-sessions-loading" }} />;
  }

  if (screenPhase === "error") {
    return <ScreenState phase="error" error={errorInfo} testIds={{ error: "report-sessions-error" }} />;
  }

  // Ready state — render the report content
  return (
    <LedgerPage title="Sessions" summary={headlineText}>
      <div className="flex min-h-full flex-col" data-testid="report-sessions">
        {/* FIGURES — no money figure when the key is absent from the payload (Coach). */}
        <div className="mb-5 flex gap-0 overflow-hidden rounded-card border border-line bg-surface" data-testid="sessions-figures">
          <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
            <Figure size="lg">{held}</Figure>
            <div className="text-xs text-mute mt-1.75">sessions</div>
            <div className="text-2xs mt-1.25 text-mute">{heldDeltaText}</div>
          </div>
          <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
            <Figure size="lg">{noShows}</Figure>
            <div className="text-xs text-mute mt-1.75">nobody turned up</div>
            <div className="text-2xs mt-1.25 text-mute" data-testid="sessions-no-show-detail">
              {noShowDetail}
            </div>
          </div>
          <div className="flex-1 px-5.5 py-5 last:border-r-0">
            <Figure size="lg">{bookedSharePct}%</Figure>
            <div className="text-xs text-mute mt-1.75">of your bookable hours were booked</div>
            <div className="text-2xs mt-1.25 text-mute">{bookedShareDeltaText}</div>
          </div>
        </div>

        <div className="flex gap-5.5">
          {/* LEFT COLUMN */}
          <div className="flex-1 min-w-0">
            {/* DAY BARS — Chart draws the bars; Busy/Busiest/Quiet is this screen's own label. */}
            <div className="mb-4.5 rounded-card border border-line bg-surface">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-sm font-semibold">When people actually book</b>
              </div>
              <div className="px-4.25 py-3.5">
                <div className="mb-3.5 h-36" data-testid="sessions-day-chart">
                  <Chart type="bar" data={dayBars} xKey="day" yKey="count" />
                </div>
                <div className="flex flex-col" data-testid="sessions-day-labels">
                  {dayBars.map((d) => (
                    <div key={d.dow} className="flex items-center gap-3 border-b border-hair py-2.75 text-sm last:border-b-0">
                      <span className="w-10 flex-shrink-0 text-xs text-mute">{d.day}</span>
                      <span className="flex-1">{d.count} sessions</span>
                      <span
                        className={`inline-flex items-center h-5.25 px-2.25 rounded-sm text-2xs font-medium ${
                          d.label === "Quiet"
                            ? "bg-warning-50 text-warning-700"
                            : "bg-success-50 text-success-700"
                        }`}
                      >
                        {d.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* NO-SHOW ROWS — display_name and count ONLY. See header note. */}
            <div className="rounded-card border border-line bg-surface" data-testid="sessions-no-show-panel">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-sm font-semibold">Didn't turn up, or cancelled late</b>
              </div>
              <div className="px-4.25 py-3.5">
                <ReportSessionsDidnTTurnUpOrCancelledLateTable noShowRows={noShowRows} />
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="w-80 flex-shrink-0">
            {/* FRIDAY/EVENINGS PROMPT */}
            {fridayPrompt && (
              <div className="mb-4.5 rounded-card border border-line bg-surface" data-testid="sessions-friday-prompt">
                <div className="border-b border-hair px-4.25 py-3.5">
                  <b className="text-sm font-semibold">Worth knowing</b>
                </div>
                <div className="px-4.25 py-3.5">
                  <PromptCard
                    icon="▦"
                    tone="act"
                    headline={fridayPrompt.headline}
                    why={fridayPrompt.why}
                    action={{ label: "Adjust your hours", href: "/engagements/booking/settings" }}
                    onDismiss={() => {}}
                    testId="prompt-card-friday-hours"
                  />
                </div>
              </div>
            )}

            {/* WHERE SESSIONS HAPPEN */}
            <div className="rounded-card border border-line bg-surface" data-testid="sessions-locations-panel">
              <div className="border-b border-hair px-4.25 py-3.5">
                <b className="text-sm font-semibold">Where sessions happen</b>
              </div>
              <div className="px-4.25 py-3.5">
                <ReportSessionsWhereSessionsHappenTable locationRows={locationRows} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </LedgerPage>
  );
}
