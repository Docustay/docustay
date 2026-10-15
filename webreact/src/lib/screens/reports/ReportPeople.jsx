// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.010 — REPORTPEOPLE. Ported from webui/src/lib/screens/reports/ReportPeople.svelte.
// Self-fetching with a test escape hatch (when report prop is supplied, no fetch runs).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import ReportPeopleWhereNewClientsCameFromTable from "./ReportPeopleWhereNewClientsCameFromTable.jsx";

export default function ReportPeople({
  report = null,
  phase = "ready",
  error = null,
  range = "this-month",
  onRange = null,
  compare = false,
  onCompare = null,
  onRetry = null,
  onNavigate = null,
}) {
  // ★ Internal state for self-fetching when report prop is not supplied
  const [internalPhase, setInternalPhase] = useState(report ? "ready" : "loading");
  const [internalPayload, setInternalPayload] = useState(report);
  const [internalError, setInternalError] = useState(null);
  const [internalRange, setInternalRange] = useState(range);
  const [internalCompare, setInternalCompare] = useState(compare);

  // ★ Compute date ranges for the report query
  const computeDates = useCallback((sel) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (sel === "last-3-months") {
      return {
        from: new Date(y, m - 2, 1),
        to: new Date(y, m + 1, 1),
        compareFrom: new Date(y, m - 5, 1),
        compareTo: new Date(y, m - 2, 1),
      };
    }
    if (sel === "this-quarter") {
      const qStart = Math.floor(m / 3) * 3;
      return {
        from: new Date(y, qStart, 1),
        to: new Date(y, qStart + 3, 1),
        compareFrom: new Date(y, qStart - 3, 1),
        compareTo: new Date(y, qStart, 1),
      };
    }
    return {
      from: new Date(y, m, 1),
      to: new Date(y, m + 1, 1),
      compareFrom: new Date(y, m - 1, 1),
      compareTo: new Date(y, m, 1),
    };
  }, []);

  const isoDate = (d) => d.toISOString().slice(0, 10);

  // ★ Fetch the report — takes an optional range parameter for use when range is about to change
  const load = useCallback(async (rangeOverride) => {
    const currentRange = rangeOverride ?? internalRange;
    setInternalPhase("loading");
    setInternalError(null);
    try {
      const { from, to, compareFrom, compareTo } = computeDates(currentRange);
      const payload = await api.report("people", {
        from: isoDate(from),
        to: isoDate(to),
        compareFrom: isoDate(compareFrom),
        compareTo: isoDate(compareTo),
      });
      setInternalPayload(payload);
      setInternalPhase("ready");
    } catch (err) {
      setInternalError(err);
      setInternalPhase("error");
    }
  }, [computeDates, internalRange]);

  // ★ Load on mount if report prop is not supplied
  useEffect(() => {
    if (!report) {
      load();
    }
  }, [report, load]);

  // ★ Handlers for range, compare, and retry
  const handleRange = useCallback((next) => {
    if (report) {
      if (onRange) onRange(next);
    } else if (internalPhase === "loading" || internalPhase === "ready") {
      setInternalRange(next);
      load(next);  // Pass the new range to load
    }
  }, [report, internalPhase, onRange, load]);

  const handleCompare = useCallback((next) => {
    if (report) {
      if (onCompare) onCompare(next);
    } else if (internalPhase === "loading" || internalPhase === "ready") {
      setInternalCompare(next);
    }
  }, [report, internalPhase, onCompare]);

  const handleRetry = useCallback(() => {
    if (report) {
      if (onRetry) onRetry();
    } else if (internalPhase === "error") {
      load();
    }
  }, [report, internalPhase, onRetry, load]);

  const go = useCallback((href) => {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }, [onNavigate]);

  // ★ Derive display values from props and internal state
  const currentPayload = report ?? internalPayload;
  const displayPhase = report ? phase : (phase !== "ready" ? phase : internalPhase);
  const displayError = report ? error : (phase !== "ready" ? error : internalError);
  const displayRange = report ? range : internalRange;
  const displayCompare = report ? compare : internalCompare;

  // ★ Derive data values
  const clientsNow = currentPayload?.clients_now ?? 0;
  const clientsGained = currentPayload?.clients_gained ?? 0;
  const stopped = Array.isArray(currentPayload?.stopped) ? currentPayload.stopped : [];
  const avgTenureMonths = currentPayload?.avg_tenure_months != null
    ? Number(currentPayload.avg_tenure_months).toFixed(1)
    : "0.0";
  const sources = Array.isArray(currentPayload?.sources) ? currentPayload.sources : [];
  const sourceMissingCount = currentPayload?.source_missing_count ?? 0;
  const frequency = currentPayload?.frequency ?? {
    weekly: 0,
    fortnightly: 0,
    irregular: 0,
    once: 0,
  };
  const rangeUpper = currentPayload?.range?.upper
    ? new Date(currentPayload.range.upper)
    : new Date();

  const enough = currentPayload?.enough_data?.enough ?? false;
  const emptyData = {
    days: currentPayload?.enough_data?.days_going ?? 0,
    n: currentPayload?.enough_data?.payments ?? 0,
  };

  // ★ Headline text
  const headline = (() => {
    const gained = clientsGained > 0
      ? `You gained ${clientsGained} this period`
      : "No new clients this period";
    const lost = stopped.length > 0 ? ` and lost ${stopped.length} without noticing.` : ".";
    return `${clientsNow} client${clientsNow === 1 ? "" : "s"}. ${gained}${lost}`;
  })();

  const formatDate = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  };

  const weeksSince = (iso) => {
    if (!iso) return null;
    const ms = rangeUpper.getTime() - new Date(iso).getTime();
    return Math.max(0, Math.round(ms / (7 * 24 * 60 * 60 * 1000)));
  };

  const sourceRows = sources.map((s, i) => ({
    id: s.source ?? `source-${i}`,
    source: s.source,
    count: s.count,
  }));
  const sourceColumns = [
    { key: "source", label: "Source" },
    { key: "count", label: "Clients" },
  ];

  const frequencyRows = [
    { key: "weekly", label: "Weekly", count: frequency.weekly ?? 0 },
    { key: "fortnightly", label: "Fortnightly", count: frequency.fortnightly ?? 0 },
    { key: "irregular", label: "When they feel like it", count: frequency.irregular ?? 0 },
    { key: "once", label: "Came once", count: frequency.once ?? 0 },
  ];

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // RENDER — loading, denied, error, or the main content
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  if (displayPhase === "loading" || displayPhase === "denied") {
    return (
      <ScreenState
        phase={displayPhase}
        reason="Reports are limited to Owners and Admins."
        testIds={{
          loading: "report-people-loading",
          denied: "report-people-denied",
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {displayPhase === "error" && (
        <ErrorPanel
          error={displayError}
          subject="People"
          onRetry={handleRetry}
          variant="band"
          testId="report-people-error"
        />
      )}

      {displayPhase !== "error" && (
        <div data-testid="report-people">
          {/* ═══ FIGURES (TRIO) ══════════════════════════════════════════════════════════════════ */}
          <div
            className="flex gap-0 overflow-hidden rounded-card border border-line bg-surface"
            data-testid="report-people-figures"
          >
            {/* Clients */}
            <div
              className="flex flex-1 flex-col border-r border-hair px-[22px] py-5"
              data-testid="report-people-figure-clients"
            >
              <Figure size="lg">{clientsNow}</Figure>
              <div className="mt-[7px] text-xs text-mute">clients</div>
              {clientsGained > 0 && (
                <div className="mt-[5px] text-xs text-ok">▲ {clientsGained} gained this period</div>
              )}
            </div>

            {/* Stopped */}
            <div
              className="flex flex-1 flex-col border-r border-hair px-[22px] py-5"
              data-testid="report-people-figure-stopped"
            >
              <Figure size="lg">{stopped.length}</Figure>
              <div className="mt-[7px] text-xs text-mute">stopped coming</div>
              {stopped.length > 0 && (
                <div className="mt-[5px] text-xs text-bad">
                  None of them cancelled — they just stopped
                </div>
              )}
            </div>

            {/* Tenure */}
            <div
              className="flex flex-1 flex-col px-[22px] py-5"
              data-testid="report-people-figure-tenure"
            >
              <Figure size="lg">{avgTenureMonths}</Figure>
              <div className="mt-[7px] text-xs text-mute">months</div>
              <div className="mt-[5px] text-xs text-mute">
                how long the average client stays
              </div>
            </div>
          </div>

          {/* ═══ TWO-COLUMN LAYOUT ════════════════════════════════════════════════════════════════ */}
          <div className="mt-5 flex gap-[22px]">
            {/* LEFT COLUMN */}
            <div className="flex flex-1 flex-col gap-[18px]">
              {/* Stopped Section */}
              <section
                className="rounded-card border border-line bg-surface"
                data-testid="report-people-stopped"
              >
                <div className="border-b border-hair px-[17px] py-[14px]">
                  <b className="text-control font-medium text-ink">Who stopped, and when they last came</b>
                </div>
                <div className="px-[17px] pb-[14px] pt-[6px]">
                  {stopped.length === 0 ? (
                    <p className="m-0 py-3 text-control text-mute">Nobody has stopped coming.</p>
                  ) : (
                    stopped.map((person) => {
                      const weeks = weeksSince(person.last_session_at);
                      const lastCame = formatDate(person.last_session_at);
                      return (
                        <div
                          key={person.person_id}
                          className="flex items-center gap-3 border-b border-hair py-[11px] text-sm"
                          data-testid="report-people-stopped-row"
                        >
                          <span className="flex-1">
                            <div className="text-ink">{person.display_name}</div>
                            <div className="mt-0.5 text-xs text-mute">
                              {lastCame ? `Last came ${lastCame}.` : "No last session on record."}
                            </div>
                          </span>
                          {weeks !== null && (
                            <span
                              className={`inline-flex h-[21px] items-center px-2.25 rounded-chip text-xs font-medium flex-shrink-0 ${
                                weeks >= 6
                                  ? "bg-bad-soft text-bad"
                                  : "bg-warn-soft text-warn"
                              }`}
                            >
                              {weeks} weeks
                            </span>
                          )}
                          <a
                            href={`/record/person/${person.person_id}`}
                            className="flex items-center justify-center h-8 px-[13px] rounded-sm border border-line bg-surface text-mute hover:text-ink text-xs font-medium whitespace-nowrap flex-shrink-0"
                            data-testid={`report-people-message-${person.person_id}`}
                            onClick={(e) => {
                              if (onNavigate) {
                                e.preventDefault();
                                go(`/record/person/${person.person_id}`);
                              }
                            }}
                          >
                            Message them
                          </a>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {/* Sources Table */}
              <section data-testid="report-people-sources">
                <ReportPeopleWhereNewClientsCameFromTable
                  sources={sources}
                  sourceRows={sourceRows}
                  sourceColumns={sourceColumns}
                />
              </section>
            </div>

            {/* RIGHT COLUMN */}
            <div className="w-80 flex-shrink-0 flex flex-col gap-[18px]">
              {/* Worth Knowing Prompt */}
              {sourceMissingCount > 0 && (
                <section
                  className="rounded-card border border-line bg-surface"
                  data-testid="report-people-source-prompt"
                >
                  <div className="border-b border-hair px-[17px] py-[14px]">
                    <b className="text-control font-medium text-ink">Worth knowing</b>
                  </div>
                  <div className="px-[17px] pb-[14px] pt-[6px]">
                    <div className="flex flex-wrap gap-2.5 items-center">
                      <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded text-sm bg-ok-soft text-ok">
                        ◎
                      </span>
                      <div className="flex-1 min-w-[200px]">
                        <div className="text-control font-medium text-ink">
                          {sourceMissingCount} of {clientsNow} never said how they found you
                        </div>
                        <div className="mt-1 text-xs text-mute leading-[1.55]">
                          <b className="text-ink-2 font-medium">Why:</b> the field isn't required. It's the only way to know which source is worth anything.
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center">
                        <DisabledWithReason
                          disabled={true}
                          reason="Required fields aren't built yet — there is no settings screen to make source required."
                          testId="report-people-required-fields"
                        >
                          {({ disabled, describedBy }) => (
                            <Button
                              size="sm"
                              disabled={disabled}
                              aria-describedby={describedBy}
                              data-testid="report-people-required-fields-button"
                            >
                              Make it required
                            </Button>
                          )}
                        </DisabledWithReason>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Frequency Section */}
              <section
                className="rounded-card border border-line bg-surface"
                data-testid="report-people-frequency"
              >
                <div className="border-b border-hair px-[17px] py-[14px]">
                  <b className="text-control font-medium text-ink">How often people come</b>
                </div>
                <div className="px-[17px] pb-[14px] pt-[6px]">
                  {frequencyRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-3 border-b border-hair py-[11px] text-sm last:border-b-0"
                      data-testid="report-people-frequency-row"
                    >
                      <span className="flex-1">
                        <div className="text-ink">{row.label}</div>
                        <div className="mt-0.5 text-xs text-mute">
                          {row.count} client{row.count === 1 ? "" : "s"}
                        </div>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
