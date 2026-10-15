// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.006 — BookingHistoryLeaf: rebuild from specs/mockups/BookingSettingsHistory.frame.html on
// LedgerPage. Ported from webui/src/lib/screens/engagements/BookingHistoryLeaf.svelte (362 lines,
// 49 of them <style>): same props, testids and copy; markup/data/handlers ported; styles become
// Tailwind utilities + tokens (10 ks-* classes replaced).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import BookingHistoryLeafBookingHistoryTable from "./BookingHistoryLeafBookingHistoryTable.jsx";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/ui/tabs";
import { Input } from "@/lib/components/ui/input.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ExportMenu from "@/lib/lists/ExportMenu.jsx";

const TABS = [
  { key: "calendar", label: "Calendar and booking", href: "/engagements/booking/settings/calendar" },
  { key: "team", label: "Team and website", href: "/engagements/booking/settings/team" },
  { key: "paying", label: "Paying and cancelling", href: "/engagements/booking/settings/paying" },
  { key: "sending", label: "What we send", href: "/engagements/booking/settings/sending" },
  { key: "history", label: "History", href: "/engagements/booking/settings/history" },
];

const WHAT_VALUES = ["Booked", "Cancelled", "Moved", "No-show", "Waitlisted"];
const WHEN_ZONE = "UTC";
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function BookingHistoryLeaf({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [whatFilter, setWhatFilter] = useState("all");
  const [whoFilter, setWhoFilter] = useState("");

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function onTabChange(value) {
    const tab = TABS.find((t) => t.key === value);
    if (tab && tab.key !== "history") go(tab.href);
  }

  function windowParams() {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const to = now.toISOString();
    return { from, to };
  }

  async function load() {
    setPhase("loading");
    setError(null);
    const { from, to } = windowParams();
    const params = new URLSearchParams({ from, to });
    if (whatFilter !== "all") params.set("what", whatFilter);
    if (whoFilter.trim()) params.set("who", whoFilter.trim());
    try {
      const r = await request(`/api/engagements/booking-history?${params.toString()}`);
      setRows(r?.rows ?? []);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }

  // Re-fetch when filters change
  useEffect(() => {
    load();
  }, [whatFilter, whoFilter]);

  // Initial load
  useEffect(() => {
    load();
  }, []);

  // Client-side search over already server-filtered rows
  const filtered = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.who, r.session, r.note].some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  })();

  const isFiltered = whatFilter !== "all" || whoFilter.trim() !== "" || search.trim() !== "";
  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;

  function clearFilters() {
    setWhatFilter("all");
    setWhoFilter("");
    setSearch("");
  }

  function emptyPropFor() {
    if (isFiltered) {
      return {
        kind: "filtered",
        headline: "Nothing matches these filters",
        line: "Try different filters or clear them.",
        action: null,
      };
    }
    return {
      kind: "first-run",
      headline: "Nothing has happened yet",
      line: "A practice with no bookings has no history. Bookings, cancellations, moves and no-shows will show up here as they happen.",
      action: null,
    };
  }

  function whenLabel(at) {
    const d = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(d.getTime())) return "—";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: WHEN_ZONE,
      hour12: false,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(d);
    const got = {};
    for (const p of parts) got[p.type] = p.value;
    const day = String(Number(got.day));
    const hour = String(Number(got.hour) % 24).padStart(2, "0");
    return `${day} ${got.month}, ${hour}:${got.minute}`;
  }

  function whatTone(what) {
    return what === "Cancelled" ? "bad" : "neutral";
  }

  function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "—";
  }

  const EXPORT_FORMATS = [
    {
      key: "csv",
      label: "CSV",
      includes: "When, what, who, which session, where from and note, for the rows currently shown.",
    },
  ];

  function exportFiltered(key) {
    if (key !== "csv") return;
    const cols = ["at", "what", "who", "session", "whereFrom", "note"];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      cols.join(","),
      ...filtered.map((r) =>
        cols.map((c) => escape(c === "at" ? whenLabel(r.at) : r[c])).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `booking-history-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Tabs row */}
      <Tabs value="history" onValueChange={onTabChange} data-testid="booking-settings-tabs">
        <TabsList className="mb-5.5 border-b border-line" variant="line">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} data-testid={`booking-settings-tab-${tab.key}`}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Main ledger page */}
      <LedgerPage
        title="Booking settings"
        summary="Everything that happened, and who did it."
        views={[{ key: "last-30", label: "Last 30 days" }]}
        activeView="last-30"
        onView={() => {}}
        controls={phase === "ready" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-[180px] max-w-[240px]"
              placeholder="Search"
              data-testid="history-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="h-[var(--density-control-h)] max-w-[160px] border border-line bg-surface px-2.5 py-0 text-sm text-ink rounded-sm"
              data-testid="history-filter-what"
              value={whatFilter}
              onChange={(e) => setWhatFilter(e.target.value)}
            >
              <option value="all">What happened: All</option>
              {WHAT_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <Input
              className="max-w-[160px]"
              placeholder="Who"
              data-testid="history-filter-who"
              value={whoFilter}
              onChange={(e) => setWhoFilter(e.target.value)}
            />
            <DisabledWithReason disabled={true} reason="No staff list is available to this screen." testId="history-filter-staff">
              {({ disabled, describedBy }) => (
                <select
                  className="h-[var(--density-control-h)] max-w-[160px] border border-line bg-surface px-2.5 py-0 text-sm text-ink rounded-sm"
                  data-testid="history-filter-staff-select"
                  disabled={disabled}
                  aria-describedby={describedBy}
                >
                  <option>Staff: All</option>
                </select>
              )}
            </DisabledWithReason>
            <div className="flex-1" />
            <ExportMenu formats={EXPORT_FORMATS} onExport={exportFiltered} testId="history-export" />
          </div>
        ) : null}
        testId="booking-history"
      >
        <ScreenState
          phase={displayPhase}
          error={phase === "error" ? error : null}
          reason={phase === "denied" ? error?.message ?? null : null}
          empty={emptyPropFor()}
          onClearFilters={clearFilters}
        >
          {displayPhase === "ready" && (
            <BookingHistoryLeafBookingHistoryTable
              phase={phase}
              error={error}
              filtered={filtered}
              displayPhase={displayPhase}
              clearFilters={clearFilters}
              emptyPropFor={emptyPropFor}
              whenLabel={whenLabel}
              whatTone={whatTone}
              initials={initials}
            />
          )}
        </ScreenState>
      </LedgerPage>
    </div>
  );
}
