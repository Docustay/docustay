// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 16.49 — MONEY REPORT. Built inside `LedgerPage` from `keystone.report_money(...)`'s
// real shape (`db/migrations/0448_report_money.sql`, `src/routes/reports.mjs`'s `/api/reports/:name`
// dispatch): { range, compare, enough_data:{enough,days_going,payments}, collected_minor,
// collected_compare_minor, by_month:[{month,collected_minor}], by_item:[{item_name,kind,count,
// amount_minor}], costs:{card_fees_minor,bank_fees_minor,ads_minor,workbench_minor} (ALL NULL today —
// Stage 15's Stripe balance-transaction mirror, PC-6, is what fills them), still_owed_minor,
// credits_liability_minor, earned_minor, owed_in_work_minor, owed_by_person:[{person_id,
// display_name,owed_minor}] }.
//
// ★★★ SELF-FETCHING, WITH A TEST ESCAPE HATCH. When the `report` prop is null/undefined (normal case
//     when mounted directly from a route), `api.report("money", …)` is called on mount, same shape
//     as `ReportSessions.svelte`. When the `report` prop IS supplied (as the existing DOM tests do),
//     behavior is byte-for-byte identical to today — no fetch, use the prop directly. This preserves
//     existing tests as-is.
//
// ★★★ EVERY `costs.*` NULL RENDERS "Not available yet" — NEVER A BLANK, NEVER $0. A missing figure
//     and an actual zero are different facts; collapsing them into "$0" would tell an owner their
//     card fees were free when the truth is the platform hasn't measured them yet.
//
// ★★★ THE BANK-TRANSFER PROMPT (`Worth knowing`) RENDERS ONLY WHEN `report.bank_transfer` EXISTS.
//     `0448_report_money.sql` never puts that key in the payload — it is a Stage 15 dependency
//     (the Stripe balance-transaction mirror) — so today this panel is ALWAYS absent, never an
//     empty band. The moment Stage 15 adds the field, this renders with no further change here.
//
// ★★★ "EARNED AGAINST COLLECTED" (F11 §2.2 / `StripeRevenueRecognition.frame.html`) — the "Why
//     this matters" three rows are PORTED VERBATIM. Row 2's headline substitutes the REAL
//     `owed_in_work_minor` figure for the frame's example "$4,875" — the wording is verbatim, the
//     number is live, matching how every other sentence on this screen interpolates real data.
//     `owed_by_person` — literally "owed BY person" in the SQL (open-invoice debt) — is the field
//     the plan names for this section's per-person rows; used as named, not re-derived.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, Suspense } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import Chart from "./Chart.jsx";
import ReportMoneyWhereItCameFromTable from "./ReportMoneyWhereItCameFromTable.jsx";
import ReportMoneyWhatYouOweInWorkByPersonTable from "./ReportMoneyWhatYouOweInWorkByPersonTable.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { usePrograms, NO_PROGRAM_COLOUR } from "@/lib/programs/programs.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★ MONEY FORMATTING — whole dollars, the frame's own convention ($4,820, never $4,820.00).
// ═══════════════════════════════════════════════════════════════════════════════════════════
function fmt(minor) {
  if (minor === null || minor === undefined) return null;
  const sign = minor < 0 ? "−" : "";
  return `${sign}$${Math.round(Math.abs(minor) / 100).toLocaleString("en-US")}`;
}
function fmtOrZero(minor) {
  return fmt(minor) ?? "$0";
}
// ★★★ THE "NOT AVAILABLE YET" RULE — never a blank, never a zero, for a cost figure Stage 15
//     has not filled in yet.
function fmtCost(minor) {
  return fmt(minor) ?? "Not available yet";
}

function monthLabel(ym) {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1))
    .toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

export default function ReportMoney({
  report = null,
  phase = "ready",
  error = null,
  range = "this-month",
  onRange = null,
  compare = false,
  onCompare = null,
  onRetry = null,
  onNavigate = null,
  onMakeBankTransferDefault = null,
  onDismissBankTransferPrompt = null,
}) {
  // ★ When report prop is supplied, use it directly. When not supplied, manage state internally.
  const [internalPhase, setInternalPhase] = useState(report ? "ready" : "loading");
  const [internalPayload, setInternalPayload] = useState(report);
  const [internalError, setInternalError] = useState(null);
  const [internalRange, setInternalRange] = useState(range);
  const [internalCompare, setInternalCompare] = useState(compare);
  // "By program" — a separate admin-only fetch over the same date range; never blocks the rest of the report.
  const [byProgram, setByProgram] = useState(null);
  const { programs } = usePrograms();

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
    return {
      from: new Date(y, m, 1), to: new Date(y, m + 1, 1),
      compareFrom: new Date(y, m - 1, 1), compareTo: new Date(y, m, 1),
    };
  }

  const isoDate = (d) => d.toISOString().slice(0, 10);

  async function load() {
    setInternalPhase("loading");
    setInternalError(null);
    try {
      const { from, to, compareFrom, compareTo } = computeDates(internalRange);
      const payload = await api.report("money", {
        from: isoDate(from), to: isoDate(to),
        compareFrom: isoDate(compareFrom), compareTo: isoDate(compareTo),
      });
      setInternalPayload(payload);
      setInternalPhase("ready");
      api.reportByProgram(isoDate(from), isoDate(to)).then(setByProgram).catch(() => setByProgram(null));
    } catch (err) {
      setInternalError(err);
      setInternalPhase("error");
    }
  }

  useEffect(() => {
    if (!report) load();
  }, []);

  function handleRange(next) {
    if (report) {
      if (onRange) onRange(next);
    } else if (internalPhase === "loading" || internalPhase === "ready") {
      setInternalRange(next);
      load();
    }
  }

  function handleCompare(next) {
    if (report) {
      if (onCompare) onCompare(next);
    } else if (internalPhase === "loading" || internalPhase === "ready") {
      setInternalCompare(next);
    }
  }

  function handleRetry() {
    if (report) {
      if (onRetry) onRetry();
    } else if (internalPhase === "error") {
      load();
    }
  }

  const currentPayload = report ?? internalPayload;
  const displayPhase = report ? phase : (phase !== "ready" ? phase : internalPhase);
  const displayError = report ? error : (phase !== "ready" ? error : internalError);
  const displayRange = report ? range : internalRange;
  const displayCompare = report ? compare : internalCompare;

  const byMonth = currentPayload?.by_month ?? [];
  const byItem = currentPayload?.by_item ?? [];
  const owedByPerson = currentPayload?.owed_by_person ?? [];
  const costs = currentPayload?.costs ?? {};
  const bankTransfer = currentPayload?.bank_transfer ?? null;

  const enough = currentPayload?.enough_data?.enough ?? false;
  const emptyData = {
    days: currentPayload?.enough_data?.days_going ?? 0,
    n: currentPayload?.enough_data?.payments ?? 0,
  };

  const totalCollected = byMonth.reduce((s, r) => s + (r.collected_minor ?? 0), 0);

  const bestMonth = byMonth.length
    ? byMonth.reduce((a, b) => ((b.collected_minor ?? 0) > (a.collected_minor ?? 0) ? b : a))
    : null;
  const secondBestMinor = byMonth.length < 2
    ? null
    : (() => {
        const sorted = [...byMonth].sort((a, b) => (b.collected_minor ?? 0) - (a.collected_minor ?? 0));
        return sorted[1]?.collected_minor ?? null;
      })();
  const quietestMonth = byMonth.length
    ? byMonth.reduce((a, b) => ((b.collected_minor ?? 0) < (a.collected_minor ?? 0) ? b : a))
    : null;
  const averageMonthMinor = byMonth.length ? Math.round(totalCollected / byMonth.length) : 0;

  const growthPct = (() => {
    if (byMonth.length < 2) return null;
    const first = byMonth[0]?.collected_minor ?? 0;
    const last = byMonth[byMonth.length - 1]?.collected_minor ?? 0;
    if (!first) return null;
    const periods = byMonth.length - 1;
    return Math.round((Math.pow(last / first, 1 / periods) - 1) * 100);
  })();
  const growthLabel = growthPct === null ? null : (growthPct >= 0 ? "Growing" : "Shrinking");

  const headline = (() => {
    if (!byMonth.length || !bestMonth) return "";
    const n = byMonth.length;
    const notClose = secondBestMinor === null || (bestMonth.collected_minor ?? 0) > secondBestMinor * 1.15;
    return `${n} month${n === 1 ? "" : "s"}. ${monthLabel(bestMonth.month)} is your best${notClose ? ", and it isn't close" : ""}.`;
  })();

  const earnedHeadline = currentPayload
    ? `You took ${fmtOrZero(currentPayload.collected_minor)} this period. You earned ${fmtOrZero(currentPayload.earned_minor)} of it.`
    : "";

  const owedInWorkNotYoursYet = `${fmtOrZero(currentPayload?.owed_in_work_minor)} is not yours yet`;

  const itemRows = byItem.map((it, i) => ({
    id: i,
    item_name: it.item_name ?? "Unknown",
    kind: it.kind ?? "other",
    count: it.count ?? 0,
    amount: fmtOrZero(it.amount_minor),
  }));
  const itemColumns = [
    { key: "item_name", label: "Item" },
    { key: "kind", label: "Kind" },
    { key: "count", label: "Count" },
    { key: "amount", label: "Amount" },
  ];

  const owedRows = owedByPerson.map((p, i) => ({
    id: p.person_id ?? i,
    display_name: p.display_name ?? "Unknown",
    owed: fmtOrZero(p.owed_minor),
  }));
  const owedColumns = [
    { key: "display_name", label: "Who" },
    { key: "owed", label: "Owed" },
  ];

  // ★ BY PROGRAM — hidden when the practice has fewer than two programs AND nothing is under "No program".
  const programRows = (byProgram?.rows ?? []).map((r) => ({ ...r, key: r.programId ?? "none" }));
  const noProgramRow = programRows.find((r) => !r.programId);
  const noProgramHasRevenue = !!noProgramRow && ((noProgramRow.invoicedMinor ?? 0) > 0 || (noProgramRow.paidMinor ?? 0) > 0);
  const showByProgram = !!byProgram && (programs.length >= 2 || noProgramHasRevenue);
  const byProgramShown = programRows.filter((r) => r.programId || noProgramHasRevenue);

  function noop() {}

  if (displayPhase === "loading") {
    return <ScreenState phase="loading" testIds={{ loading: "report-money-loading" }} />;
  }

  if (displayPhase === "denied") {
    return (
      <ScreenState
        phase="denied"
        reason="Money is owner-only. An owner or admin of this practice can see it."
        testIds={{ denied: "report-money-denied" }}
      />
    );
  }

  return (
    <LedgerPage title="Money" summary={displayPhase === "error" ? "" : headline} testId="report-money">
      {displayPhase === "error" ? (
        <ErrorPanel error={displayError} subject="Money" onRetry={handleRetry} variant="band" testId="report-money-error" />
      ) : (
        <div data-testid="report-money" className="flex flex-col gap-4.5">
          {/* WHAT YOU TOOK — month bars via Chart */}
          <section data-testid="rm-chart" className="rounded-card border border-line bg-surface p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium text-ink">What you took</h2>
              <span className="text-sm text-mute">{fmtOrZero(totalCollected)} over {byMonth.length} month{byMonth.length === 1 ? "" : "s"}</span>
            </div>
            <div className="h-[150px]">
              {byMonth.length ? (
                <Chart type="bar" data={byMonth} xKey="month" yKey="collected_minor" />
              ) : (
                <p className="text-sm text-mute">No months to chart yet.</p>
              )}
            </div>
          </section>

          {/* BY PROGRAM */}
          {showByProgram && (
            <section data-testid="rm-by-program" className="rounded-card border border-line bg-surface p-4">
              <div className="mb-4 border-b border-hair pb-3">
                <h2 className="font-medium text-ink">By program</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hair text-left text-xs text-mute">
                    <th className="py-2 font-medium">Program</th>
                    <th className="py-2 text-right font-medium">Invoiced</th>
                    <th className="py-2 text-right font-medium">Paid</th>
                    <th className="py-2 text-right font-medium">Invoices</th>
                    <th className="py-2 text-right font-medium">Sessions</th>
                    <th className="py-2 text-right font-medium">People</th>
                  </tr>
                </thead>
                <tbody>
                  {byProgramShown.map((r) => (
                    <tr key={r.key} className="border-b border-hair last:border-b-0" data-testid={`rm-by-program-row-${r.key}`}>
                      <td className="py-2.75">
                        <span className="mr-2 inline-block size-2.5 rounded-full align-middle"
                              style={{ backgroundColor: r.programId ? (r.colour || NO_PROGRAM_COLOUR) : NO_PROGRAM_COLOUR }} aria-hidden="true" />
                        {r.programId ? r.name : "No program"}
                      </td>
                      <td className="py-2.75 text-right font-fraunces">{fmtOrZero(r.invoicedMinor)}</td>
                      <td className="py-2.75 text-right font-fraunces">{fmtOrZero(r.paidMinor)}</td>
                      <td className="py-2.75 text-right">{r.invoices ?? 0}</td>
                      <td className="py-2.75 text-right">{r.sessions ?? 0}</td>
                      <td className="py-2.75 text-right">{r.people ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-medium" data-testid="rm-by-program-totals">
                    <td className="py-2.75">Total</td>
                    <td className="py-2.75 text-right font-fraunces">{fmtOrZero(byProgram?.totals?.invoicedMinor)}</td>
                    <td className="py-2.75 text-right font-fraunces">{fmtOrZero(byProgram?.totals?.paidMinor)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </section>
          )}

          <div className="flex gap-5.5 max-lg:flex-col">
            <div className="flex-1">
              {/* WHERE IT CAME FROM */}
              <section data-testid="rm-where" className="mb-4.5 rounded-card border border-line bg-surface p-4">
                <ReportMoneyWhereItCameFromTable itemRows={itemRows} itemColumns={itemColumns} />
              </section>

              {/* WHAT IT COST YOU */}
              <section data-testid="rm-cost" className="rounded-card border border-line bg-surface p-4">
                <div className="mb-4 border-b border-hair pb-3">
                  <h2 className="font-medium text-ink">What it cost you</h2>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                    <span className="text-sm">Card fees</span>
                    <span className="font-fraunces" data-testid="rm-cost-card">{fmtCost(costs.card_fees_minor)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                    <span className="text-sm">Bank transfer fees</span>
                    <span className="font-fraunces" data-testid="rm-cost-bank">{fmtCost(costs.bank_fees_minor)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                    <span className="text-sm">Ads</span>
                    <span className="font-fraunces" data-testid="rm-cost-ads">{fmtCost(costs.ads_minor)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                    <span className="text-sm">Workbench</span>
                    <span className="font-fraunces" data-testid="rm-cost-workbench">{fmtCost(costs.workbench_minor)}</span>
                  </div>
                </div>
              </section>
            </div>

            <div className="w-80 flex-shrink-0 max-lg:w-full">
              {/* WORTH KNOWING — bank-transfer prompt, Stage 15 dependency */}
              {bankTransfer && (
                <section data-testid="rm-worth-knowing" className="mb-4.5 rounded-card border border-line bg-surface p-4">
                  <div className="mb-4 border-b border-hair pb-3">
                    <h2 className="font-medium text-ink">Worth knowing</h2>
                  </div>
                  <PromptCard
                    icon="$"
                    tone="warn"
                    headline={`Bank transfer saved you ${fmtOrZero(bankTransfer.savings_minor)} this month`}
                    why={bankTransfer.why ?? ""}
                    action={{
                      label: bankTransfer.action_label ?? "Make it the default on big invoices",
                      onClick: onMakeBankTransferDefault ?? noop,
                    }}
                    onDismiss={onDismissBankTransferPrompt ?? noop}
                    testId="rm-bank-transfer-prompt"
                  />
                </section>
              )}

              {/* STILL OWED + CREDITS LIABILITY */}
              <section data-testid="rm-still-owed" className="rounded-card border border-line bg-surface p-4">
                <div className="mb-4 border-b border-hair pb-3">
                  <h2 className="font-medium text-ink">Still owed</h2>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                    <span className="text-sm">Still owed</span>
                    <span className="font-fraunces" data-testid="rm-still-owed-fig">{fmtOrZero(currentPayload?.still_owed_minor)}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                    <div className="text-sm">
                      <p>Credits liability</p>
                      <p className="text-xs text-mute">Sessions and packages people have paid for and not yet had.</p>
                    </div>
                    <span className="font-fraunces" data-testid="rm-credits-liability-fig">{fmtOrZero(currentPayload?.credits_liability_minor)}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* MONEY OVER TIME */}
          <section data-testid="rm-over-time" className="rounded-card border border-line bg-surface p-4">
            <div className="mb-4 border-b border-hair pb-3">
              <h2 className="font-medium text-ink">Money over time</h2>
            </div>
            <div className="space-y-2">
              {bestMonth && (
                <div className="flex items-center justify-between border-b border-hair py-2.75 first:border-t-0 last:border-b-0">
                  <div>
                    <p className="text-sm font-medium">Best month</p>
                    <p className="text-xs text-mute">{monthLabel(bestMonth.month)}, {fmtOrZero(bestMonth.collected_minor)}</p>
                  </div>
                </div>
              )}
              {quietestMonth && (
                <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                  <div>
                    <p className="text-sm font-medium">Quietest</p>
                    <p className="text-xs text-mute">{monthLabel(quietestMonth.month)}, {fmtOrZero(quietestMonth.collected_minor)}</p>
                  </div>
                </div>
              )}
              {byMonth.length > 0 && (
                <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                  <div>
                    <p className="text-sm font-medium">Average</p>
                    <p className="text-xs text-mute">{fmtOrZero(averageMonthMinor)}</p>
                  </div>
                </div>
              )}
              {growthLabel && (
                <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                  <div>
                    <p className="text-sm font-medium">{growthLabel}</p>
                    <p className="text-xs text-mute">About {Math.abs(growthPct)}% a month across {byMonth.length} months</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between border-b border-hair py-2.75 last:border-b-0">
                <div>
                  <p className="text-sm font-medium">Seasonality</p>
                  <p className="text-xs text-mute">Ask again in January. Most coaching practices are quiet in the new year and busy in September — you will want to know your own shape.</p>
                </div>
              </div>
            </div>
          </section>

          {/* EARNED AGAINST COLLECTED */}
          <section data-testid="rm-earned" className="rounded-card border border-line bg-surface p-4">
            <div className="mb-4 border-b border-hair pb-3">
              <h2 className="font-medium text-ink">Earned against collected</h2>
            </div>
            <p className="mb-2 text-sm" data-testid="rm-earned-headline">{earnedHeadline}</p>
            <p className="mb-4 text-xs text-mute leading-relaxed">
              These are two different numbers and your accountant needs both. Money from a
              six-session block arrives on day one, but you earn it a session at a time. Until
              then it is money you owe in work, not profit.
            </p>

            {/* Three-column breakdown */}
            <div className="mb-4 flex gap-4 rounded-card border border-line overflow-hidden bg-surface">
              <div className="flex-1 border-r border-hair p-5.5 last:border-r-0">
                <div className="font-fraunces text-5xl font-light leading-none">{fmtOrZero(currentPayload?.collected_minor)}</div>
                <p className="mt-2 text-xs text-mute">collected</p>
                <p className="mt-2.5 text-xs leading-relaxed">What actually arrived in your account.</p>
              </div>
              <div className="flex-1 border-r border-hair p-5.5 last:border-r-0">
                <div className="font-fraunces text-5xl font-light leading-none">{fmtOrZero(currentPayload?.earned_minor)}</div>
                <p className="mt-2 text-xs text-mute">earned</p>
                <p className="mt-2.5 text-xs leading-relaxed">Sessions delivered, plus a month of each plan.</p>
              </div>
              <div className="flex-1 border-r border-hair p-5.5 last:border-r-0">
                <div className="font-fraunces text-5xl font-light leading-none">{fmtOrZero(currentPayload?.owed_in_work_minor)}</div>
                <p className="mt-2 text-xs text-mute">owed in work</p>
                <p className="mt-2.5 text-xs leading-relaxed">Sessions people have paid for and not yet had. This is a liability.</p>
              </div>
            </div>

            {/* Table for owed by person */}
            <div className="mb-4">
              <ReportMoneyWhatYouOweInWorkByPersonTable owedRows={owedRows} owedColumns={owedColumns} />
            </div>

            {/* Why this matters */}
            <div className="border-t border-hair pt-4">
              <h3 className="font-medium text-ink">Why this matters</h3>
              <div className="mt-3 space-y-2">
                <div className="border-b border-hair py-2.75 last:border-b-0">
                  <p className="text-sm font-medium">A good month can be a borrowed one</p>
                  <p className="text-xs text-mute">Sell four blocks in September and October looks terrible — the work is done but the money already came.</p>
                </div>
                <div className="border-b border-hair py-2.75 last:border-b-0">
                  <p className="text-sm font-medium">{owedInWorkNotYoursYet}</p>
                  <p className="text-xs text-mute">If everyone asked for a refund tomorrow, that is the number.</p>
                </div>
                <div className="border-b border-hair py-2.75 last:border-b-0">
                  <p className="text-sm font-medium">Expiring credits become earned</p>
                  <p className="text-xs text-mute">When a block expires unused, it moves from owed to earned that day.</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </LedgerPage>
  );
}
