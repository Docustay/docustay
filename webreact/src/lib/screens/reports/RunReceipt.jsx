// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 16.55 — RUNRECEIPT. "What we did this month" — the done-for-you monthly receipt, built only from
// logged actions (16.29 `buildReceipt`, `src/reports/receipt.mjs`; 16.30 `GET /api/reports/receipt`,
// `src/routes/reports.mjs:345-360`), rendered through `ReportShell` (16.37).
//
// ★★★ `managed:false` renders the SIXTH `EmptyState` KIND, `pitch` — RULED by the maintainer, 25 Sep 2026
//     (contract OQ-4, RULED 16.18): a value added to the EXISTING `KINDS` list in `phase.js`, never
//     a separate `EmptyPitch` component/file. `EmptyState` itself is untouched: its one
//     icon/headline/line/action pattern renders a sixth kind the moment it is admitted to `KINDS`.
//   ★ Per OQ-16.1 (RULED, the 23 Sep "stripped to the band" ruling wins): the pitch is the plain
//     band — icon, headline, one line, one action ("See what's included") — no illustrated value
//     cards, no proof strip. The copy below describes the done-for-you tier in general terms.
//
// ★ `data` — OPTIONAL PROP FOR TESTING, same convention as `ReportCoaches.jsx:17` /
//   `ReportSessions` ("if provided, skips the fetch").
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ReportShell from "./ReportShell.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";

export default function RunReceipt({ onNavigate = null, data = null, month = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);
  const [payload, setPayload] = useState(null);

  const hasFixture = data !== null && data !== undefined;

  function currentMonth() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  async function load() {
    if (hasFixture) return;
    try {
      setLoading(true);
      setError(null);
      setDenied(false);
      setPayload(await api.reportReceipt(month ?? currentMonth()));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (hasFixture) {
      setPayload(data);
      setLoading(false);
      setError(null);
      setDenied(false);
    } else {
      load();
    }
  }, [hasFixture, data]);

  // ★★★ `managed` DRIVES THE WHOLE SCREEN. `false` → the pitch band; `true` → the receipt itself.
  //     `src/routes/reports.mjs:355-358` returns `{managed:false}` ONLY when the flag is off — no
  //     other keys — so nothing here reads `figures`/`sections` unless `managed` is `true`.
  const managed = payload?.managed === true;

  const monthLabel = (() => {
    const m = payload?.month ?? month ?? currentMonth();
    const d = new Date(`${m}-01T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return "this month";
    return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(d);
  })();

  const figures = payload?.figures ?? { things_done: 0, told_clients: 0, tasks_opened: 0 };

  // ★★★ EMPTY SECTIONS ARE OMITTED ENTIRELY, NOT RENDERED AS AN EMPTY BAND. A "Money we stopped
  //     wasting" card with nothing under it reads as "we found nothing to say", which is a worse
  //     dead end than not showing the card at all.
  const sectionBlocks = (() => {
    const s = payload?.sections ?? {};
    const defs = [
      { key: "stopped_wasting", title: "Money we stopped wasting" },
      { key: "fixed", title: "Things we fixed" },
      { key: "wrote", title: "Things we wrote" },
      { key: "moved", title: "Where you moved" },
    ];
    return defs
      .map((d) => ({ ...d, rows: Array.isArray(s[d.key]) ? s[d.key] : [] }))
      .filter((d) => d.rows.length > 0);
  })();

  const nextMonth = Array.isArray(payload?.next_month) ? payload.next_month : [];

  const totalThingsDone = figures.things_done ?? 0;
  // ★ "Managed but zero rows" — every bucket empty, whatever `things_done` says — reads as
  //   "Nothing logged this month yet" rather than a figures strip full of zeroes and no cards under it.
  const hasAnyRows = sectionBlocks.length > 0;

  function formatRowDate(row) {
    const raw = row?.date ?? row?.run_at ?? null;
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(d);
  }

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (denied) {
    return (
      <ScreenState
        phase="denied"
        reason="Reports are practice policy — ask an owner or admin for access."
      />
    );
  }

  if (error) {
    return <ScreenState phase="error" error={error} />;
  }

  return (
    <div data-testid="run-receipt" className="flex flex-col w-full">
      <ReportShell
        title={`What we did in ${monthLabel}`}
        headline={managed && hasAnyRows ? `${totalThingsDone} thing${totalThingsDone === 1 ? "" : "s"}. Here they are, with what each one did.` : ""}
        name="receipt"
        range="this-month"
        exportName="receipt"
        enough={true}
      >
        {!managed ? (
          <EmptyState
            kind="pitch"
            icon="IconFileAnalytics"
            headline="See what we'd be doing for you"
            line="On the done-for-you tier, we write up a monthly account of what changed — money we stopped wasting, listings and details we fixed, reviews and posts we wrote, and where you moved in search — every line backed by something we actually logged, never a guess."
            action={{ label: "See what's included", href: "/settings/plans" }}
            onNavigate={onNavigate}
          />
        ) : !hasAnyRows ? (
          <div className="text-sm text-mute px-4 py-3.5" data-testid="run-receipt-nothing">
            Nothing logged this month yet.
          </div>
        ) : (
          <>
            <div className="flex gap-0 bg-surface border border-line rounded-card overflow-hidden mb-6" data-testid="run-receipt-figures">
              <div className="flex-1 px-4 py-3.5 border-r border-line-soft last:border-r-0">
                <Figure size="md" as="div" data-testid="run-receipt-things-done">{figures.things_done ?? 0}</Figure>
                <div className="text-sm text-mute mt-1.75">things we did</div>
              </div>
              <div className="flex-1 px-4 py-3.5 border-r border-line-soft last:border-r-0">
                <Figure size="md" as="div" data-testid="run-receipt-told-clients">{figures.told_clients ?? 0}</Figure>
                <div className="text-sm text-mute mt-1.75">told your clients about</div>
              </div>
              <div className="flex-1 px-4 py-3.5 border-r border-line-soft last:border-r-0">
                <Figure size="md" as="div" data-testid="run-receipt-tasks-opened">{figures.tasks_opened ?? 0}</Figure>
                <div className="text-sm text-mute mt-1.75">became a task for you</div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              {sectionBlocks.map((block) => (
                <div key={block.key} className="bg-surface border border-line rounded-card" data-testid={`run-receipt-section-${block.key}`}>
                  <div className="text-sm font-medium text-ink px-4 py-3.5 border-b border-line-soft">{block.title}</div>
                  <div className="px-4 pt-1.5 pb-3.5">
                    {block.rows.map((row, i) => (
                      <div key={row.id ?? row.source_id ?? i} className="flex items-center gap-3 py-2.75 border-b border-line-soft last:border-b-0 text-sm">
                        <span className="flex-1 block">
                          <span className="block">
                            {row.label ?? row.action ?? row.key ?? ""}
                            {(row.detail || formatRowDate(row)) && (
                              <span className="block text-[12.5px] text-mute mt-0.5">
                                {row.detail ?? ""}{row.detail && formatRowDate(row) ? " " : ""}{formatRowDate(row)}
                              </span>
                            )}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {nextMonth.length > 0 && (
                <div className="bg-surface border border-line rounded-card" data-testid="run-receipt-next-month">
                  <div className="text-sm font-medium text-ink px-4 py-3.5 border-b border-line-soft">Next month</div>
                  <div className="px-4 pt-1.5 pb-3.5">
                    {nextMonth.map((row, i) => (
                      <div key={row.id ?? i} className="flex items-center gap-3 py-2.75 border-b border-line-soft last:border-b-0 text-sm">
                        <span className="flex-1 block">
                          <span className="block">
                            {row.label ?? ""}
                            {row.detail && (
                              <span className="block text-[12.5px] text-mute mt-0.5">{row.detail}</span>
                            )}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </ReportShell>
    </div>
  );
}
