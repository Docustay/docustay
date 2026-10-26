// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 17.28 — HOMEOWNER — THE OWNER/ADMIN HOME BUILT FROM `specs/mockups/HomeOwner.frame.html`.
//
// ★★★ THE FRAME IS THE REFERENCE, NOT THIS COMMENT. Seven bands: Hero (figure + delta + headline
//     with strong ranges) → PromptBand (≤3 cards + see all link) → Today (rows + free slots) →
//     This week (7-day strip) → The money (6-value strip) → How people find you (4 audit lines) →
//     Quick (4 actions). SetupPanel is rendered when blocked status is set. Every band that can
//     error independently does so with ErrorPanel.
//
// ★★★ EVERY FIGURE, NAME AND TIME ON THIS SCREEN COMES FROM THE SERVER. `/api/home` supplies
//     `hero`, `headline`, `prompts`, `today`, `week`, `money`, `found` and their errors — nothing
//     here invents a row or a number.
//
// ★ MONEY NEVER REACHES A COACH'S BROWSER — the server filters the `money` band out for
//   non-Owner/Admin (src/routes/index.mjs, `isOwnerOrAdmin`); this file never re-derives the
//   check, it only renders what arrived.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { request } from "@/lib/api.js";

export default function Home({ data = null, onOpen = null, onDismiss = null }) {
  const motion = 220; // Animation duration in ms

  // ★ The greeting uses the clock, and nothing else — "Good afternoon" is a fact about the time
  //   of day on the reader's own machine.
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const todayLong = new Date().toLocaleDateString(undefined,
    { weekday: "long", day: "numeric", month: "long" });

  // ★ Render headline with strong ranges applied
  const headlineWithStrong = useMemo(() => {
    if (!data?.headline) return [];
    const text = data.headline.text;
    const strong = data.headline.strong || [];
    if (!strong.length) return [{ text, strong: false }];

    const parts = [];
    let lastEnd = 0;
    for (const range of strong) {
      if (range.start > lastEnd) {
        parts.push({ text: text.slice(lastEnd, range.start), strong: false });
      }
      parts.push({ text: text.slice(range.start, range.end), strong: true });
      lastEnd = range.end;
    }
    if (lastEnd < text.length) {
      parts.push({ text: text.slice(lastEnd), strong: false });
    }
    return parts;
  }, [data?.headline]);

  // ★ Check if blocked status is set (for SetupPanel)
  const isBlocked = useMemo(() => data?.found?.needsSetup === true, [data?.found]);

  const timeOf = (iso) => {
    try {
      return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const dayName = (iso) => {
    // a bare YYYY-MM-DD parses as UTC midnight — the previous weekday west of Greenwich; noon local
    const d =
      typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)
        ? `${iso}T12:00:00`
        : iso;
    try {
      return new Date(d).toLocaleDateString(undefined, { weekday: "short" });
    } catch {
      return "";
    }
  };

  // ★ /api/home sends `week` as the 7-row array (the shape HomeStaff reads), or {error}; this read
  //   `week.days`, which never exists — the owner's week never drew a bar (26 Sep 2026).
  const weekDays = useMemo(
    () => (Array.isArray(data?.week) ? data.week : data?.week?.days ?? []),
    [data?.week]
  );
  // ★ F153 (23 Oct 2026) — /api/home sends `today` as the array of rows (with `state`), or {error}; this read `today.rows`
  //   and `row.status`, which never exist, so the owner's Today always said "Nothing booked today".
  const todayRows = useMemo(() => {
    const rows = Array.isArray(data?.today) ? data.today : data?.today?.rows ?? [];
    const LABEL = { confirmed: "Confirmed", pending_signature: "Unsigned", pending_consent: "Waiting for consent", pending_payment: "Waiting for payment", completed: "Done", no_show: "No-show" };
    return rows.map((r) => {
      const status = r.status ?? (r.state === "pending_signature" ? "unsigned" : r.state);
      return { ...r, status, statusLabel: r.statusLabel ?? LABEL[r.state] ?? null };
    });
  }, [data?.today]);
  const weekTotal = useMemo(() => weekDays.reduce((a, d) => a + (d.n ?? 0), 0), [weekDays]);
  const weekMax = useMemo(() => Math.max(1, ...weekDays.map((d) => d.n ?? 0)), [weekDays]);
  const barHeight = (n) => Math.max(6, Math.round(6 + (n / weekMax) * 50));

  const formatCurrency = (amount, currency = "USD") => {
    if (amount === null || amount === undefined) return null;
    return (amount / 100).toLocaleString("en-US", { style: "currency", currency });
  };

  // ★ Dismiss a prompt card and call the dismiss action. MEASURED 27 Sep (F804/F-BUILD-2): the
  //   ported Svelte source called a per-instance `/api/prompts/{kind}/{subjectId}/dismiss` route
  //   with a `dismissKey` body that does not exist — the real, only route is the flat
  //   `POST /api/prompts/dismiss`, body `{kind, subjectId}` (src/routes/prompts.mjs:67-83).
  async function dismissPrompt(prompt) {
    if (!prompt.kind) return;
    try {
      await request("/api/prompts/dismiss", {
        method: "POST",
        body: { kind: prompt.kind, subjectId: prompt.subjectId ?? null },
      });
      onDismiss?.();
    } catch (err) {
      console.error("Failed to dismiss prompt:", err);
    }
  }

  return (
    <section className="flex flex-col gap-5.5" data-testid="home">
      {/* ═══ BAND 1: HERO ─────────────────────────────────────────────────────────────────────── */}
      {data?.hero && (
        <div className="flex flex-col gap-3.5 mb-6.5">
          <div className="flex items-end gap-5">
            {(data.view === "owner" || data.view === "admin") && (
              <>
                <div className="flex flex-col">
                  <div className="text-5xl font-normal -tracking-tight leading-none">
                    {data.hero.amountMinor != null ? formatCurrency(data.hero.amountMinor) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">taken this month</div>
                  {data.hero.sinceStarted && (
                    <div className="text-xs text-muted-foreground">since you started</div>
                  )}
                </div>
              </>
            )}
            {data.view === "staff" && (
              <>
                <div className="flex flex-col">
                  <div className="text-5xl font-normal -tracking-tight leading-none">
                    {data.hero.sessions ?? null}
                  </div>
                  <div className="text-sm text-muted-foreground">sessions this week</div>
                  {data.hero.sinceStarted && (
                    <div className="text-xs text-muted-foreground">since you started</div>
                  )}
                </div>
              </>
            )}
            {/* Delta (change from last period) */}
            <div className="text-xs text-green-700" data-testid="home-hero-delta">
              {data.hero.deltaSentence}
            </div>
          </div>

          {/* Headline with strong ranges */}
          {data?.headline && (
            <p className="text-sm text-muted-foreground leading-1.6 max-w-[78ch] my-3.5" data-testid="home-summary">
              {headlineWithStrong.map((part, idx) =>
                part.strong ? (
                  <strong key={idx} className="font-medium text-foreground">
                    {part.text}
                  </strong>
                ) : (
                  <span key={idx}>{part.text}</span>
                )
              )}
            </p>
          )}
        </div>
      )}

      {/* ═══ SETUP PANEL (if blocked) ───────────────────────────────────────────────────────── */}
      {isBlocked && data?.found?.blocker && (
        <div className="mb-6.5" data-testid="home-blocked">
          <div className="bg-white border border-line rounded-lg p-3.5">
            <div className="text-center py-7 px-6">
              <h2 className="font-medium text-lg mb-1.75">{data.found.blocker.headline}</h2>
              <p className="text-sm text-muted-foreground mb-4.5 max-w-[46ch]">
                {data.found.blocker.description}
              </p>
              {data.found.blocker.action && (
                <button
                  type="button"
                  className="px-4 py-2 bg-primary text-white rounded-lg font-medium text-sm"
                  onClick={() => onOpen?.(data.found.blocker.action.href)}
                >
                  {data.found.blocker.action.label}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ BAND 2: PROMPTS ──────────────────────────────────────────────────────────────────── */}
      {data?.prompts && !isBlocked && (
        <div className="flex flex-col gap-2.5 mb-7.5">
          {data.prompts.items?.map((prompt) => (
            <div key={prompt.id} className="flex gap-3.5 bg-white border border-line rounded-lg p-3.75">
              <div
                className="w-7.5 h-7.5 rounded-lg flex items-center justify-center flex-shrink-0 text-sm"
                style={{
                  backgroundColor: prompt.iconBg || "var(--color-stage)",
                  color: prompt.iconColor || "var(--color-mute-decor)",
                }}
              >
                {prompt.icon}
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm leading-relaxed">{prompt.headline}</div>
                {prompt.why && (
                  <div className="text-xs text-muted-foreground mt-1 leading-1.55">
                    <strong className="font-medium text-foreground">Why:</strong> {prompt.why}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {prompt.action && (
                  <button
                    type="button"
                    className="px-3 py-1.5 border border-line rounded-lg text-xs font-medium bg-white"
                    onClick={() => onOpen?.(prompt.action.href)}
                  >
                    {prompt.action.label}
                  </button>
                )}
                <button
                  type="button"
                  className="text-lg text-muted-foreground"
                  onClick={() => dismissPrompt(prompt)}
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {data.prompts.moreCount > 0 && (
            <div className="text-xs text-muted-foreground pl-0.5">
              <a href="#" className="text-primary no-underline">
                {data.prompts.moreCount} more thing{data.prompts.moreCount !== 1 ? "s" : ""} need you
              </a>
            </div>
          )}
        </div>
      )}

      {/* ═══ THREE COLUMNS LAYOUT ───────────────────────────────────────────────────────────── */}
      {/* F147 — stack below lg: the fixed 320px right column sat on top of the main column at phone width */}
      {!isBlocked && (
        <div className="flex flex-col gap-5.5 mt-6.5 lg:flex-row lg:items-start" style={{ minWidth: 0 }}>
          {/* LEFT COLUMN: Today, This week, The money */}
          <div className="flex-1 min-w-0">
            {/* TODAY SECTION */}
            {data?.today && (
              <section className="bg-white border border-line rounded-lg mb-4.5 p-3.5" data-testid="home-today">
                <div className="flex items-center justify-between mb-3.5 border-b border-hair pb-3.5">
                  <h2 className="font-medium text-sm m-0">Today</h2>
                  <a
                    href="#"
                    className="text-xs text-primary no-underline"
                    data-testid="home-open-calendar"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen?.("/engagements/calendar");
                    }}
                  >
                    Open the calendar
                  </a>
                </div>
                {data.today.error ? (
                  <div className="text-sm text-red-600">{data.today.error}</div>
                ) : todayRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground mt-3">Nothing booked today.</p>
                ) : (
                  <ul className="list-none m-0 p-0">
                    {todayRows.filter((r) => !r.free).map((row, idx) => (
                      <li
                        key={row.id}
                        className="flex items-center gap-3 px-0 py-2.75 border-t border-hair first:border-t-0 first:pt-0 text-sm"
                      >
                        <span className="text-sm tabular-nums flex-shrink-0 w-18.5">
                          {timeOf(row.starts_at)}
                        </span>
                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <button
                            type="button"
                            className="p-0 border-0 bg-none text-left font-medium text-base text-foreground overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer hover:text-primary m-0"
                            onClick={() => onOpen?.(`/record/booking/${row.id}`)}
                          >
                            {row.who ?? "No one added yet"}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {row.service_name ?? "Session"}
                          </span>
                        </span>
                        {row.status && (
                          <span
                            className="px-2 py-0.5 text-xs font-medium rounded text-white flex-shrink-0"
                            style={{
                              backgroundColor:
                                row.status === "confirmed"
                                  ? "var(--color-ok)"
                                  : row.status === "unsigned"
                                    ? "var(--color-warn)"
                                    : "var(--color-mute-decor)",
                            }}
                          >
                            {row.statusLabel ?? row.status}
                          </span>
                        )}
                      </li>
                    ))}

                    {/* Free slots */}
                    {todayRows
                      .filter((r) => r.free)
                      .map((slot) => (
                        <li
                          key={slot.id}
                          className="flex items-center gap-3 px-0 py-2.75 border-t border-hair text-sm"
                        >
                          <span className="text-sm tabular-nums flex-shrink-0 w-18.5">
                            {timeOf(slot.starts_at)}
                          </span>
                          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <span className="font-medium text-base text-foreground">Free</span>
                            <span className="text-xs text-muted-foreground">
                              Nobody booked this one
                            </span>
                          </span>
                          <span className="px-2 py-0.5 text-xs font-medium rounded text-muted-foreground bg-gray-100 flex-shrink-0">
                            Open
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            )}

            {/* THIS WEEK SECTION */}
            {data?.week && (
              <section
                className="bg-white border border-line rounded-lg mb-4.5 p-3.5"
                data-testid="home-week"
              >
                <h2 className="font-medium text-sm m-0 mb-2.5">This week</h2>
                {data.week.error ? (
                  <div className="text-sm text-red-600">{data.week.error}</div>
                ) : weekDays.length > 0 ? (
                  <>
                    <div className="flex gap-1.5 items-end h-24 overflow-hidden p-0 pb-1.5 border-b border-hair mb-0">
                      {weekDays.map((d, i) => (
                        <button
                          key={d.date ?? i}
                          type="button"
                          className="flex-1 flex flex-col items-center gap-1.5 border-0 bg-transparent p-0 cursor-pointer"
                          onClick={() => onOpen?.("/engagements/calendar")}
                          title={`${dayName(d.date)} · ${d.n} ${d.n === 1 ? "session" : "sessions"}`}
                        >
                          <span
                            className="w-6.5 rounded-t"
                            style={{ height: `${barHeight(d.n)}px`, backgroundColor: "var(--color-brand-soft)" }}
                          ></span>
                          <span className="text-2.875 text-muted-foreground">{dayName(d.date)}</span>
                        </button>
                      ))}
                    </div>
                    {data?.headline?.text && (
                      <p className="text-xs text-muted-foreground mt-2 m-0">
                        {data.headline.text}
                      </p>
                    )}
                  </>
                ) : null}
              </section>
            )}

            {/* THE MONEY SECTION (owner/admin only) */}
            {data?.money && (data.view === "owner" || data.view === "admin") && (
              <section
                className="bg-white border border-line rounded-lg mb-4.5 p-3.5"
                data-testid="home-money"
              >
                <div className="flex items-center justify-between mb-3.5 border-b border-hair pb-3.5">
                  <h2 className="font-medium text-sm m-0">The money</h2>
                  <a
                    href="#"
                    className="text-xs text-primary no-underline"
                    data-testid="home-open-money"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen?.("/money/invoices");
                    }}
                  >
                    Open money
                  </a>
                </div>
                {data.money.error ? (
                  <div className="text-sm text-red-600">{data.money.error}</div>
                ) : (
                  <div className="flex flex-wrap gap-0">
                    <div className="flex-1 min-w-1/3 p-3.25 border-b border-hair">
                      <div className="text-sm font-normal tabular-nums">
                        {formatCurrency(data.money.owedMinor ?? 0)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">owed to you</div>
                    </div>
                    <div className="flex-1 min-w-1/3 p-3.25 border-b border-hair">
                      <div className="text-sm font-normal tabular-nums">
                        {formatCurrency(data.money.lateMinor ?? 0)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">past due</div>
                    </div>
                    <div className="flex-1 min-w-1/3 p-3.25 border-b border-hair">
                      <div className="text-sm font-normal tabular-nums">
                        {formatCurrency(data.money.thisMonthMinor ?? 0)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">this month</div>
                    </div>
                    <div className="flex-1 min-w-1/3 p-3.25 border-b border-hair">
                      <div className="text-sm font-normal tabular-nums">
                        {data.money.sessions ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">sessions this week</div>
                    </div>
                    <div className="flex-1 min-w-1/3 p-3.25 border-b border-hair">
                      <div className="text-sm font-normal tabular-nums">
                        {data.money.drifting ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">haven't rebooked</div>
                    </div>
                    <div className="flex-1 min-w-1/3 p-3.25 border-b border-hair">
                      <div className="text-sm font-normal tabular-nums">
                        {data.money.unsigned ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">documents unsigned</div>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* RIGHT COLUMN: How people find you + Quick */}
          <div className="w-full lg:w-80 lg:flex-shrink-0">
            {/* HOW PEOPLE FIND YOU (audit lines) */}
            {data?.found && !data.found.needsSetup && data.found.audit && (
              <section
                className="bg-white border border-line rounded-lg mb-4.5 p-3.5"
                data-testid="home-found"
              >
                <div className="flex items-center justify-between mb-3.5 border-b border-hair pb-3.5">
                  <h2 className="font-medium text-sm m-0">How people find you</h2>
                  <a
                    href="#"
                    className="text-xs text-primary no-underline"
                    data-testid="home-open-run"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen?.("/run");
                    }}
                  >
                    Open Run
                  </a>
                </div>
                <div className="flex flex-col gap-0">
                  {data.found.audit.map((line) => (
                    <div
                      key={line.id}
                      className="flex gap-3 py-3 border-b border-hair last:border-b-0 text-xs"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                        style={{ backgroundColor: line.color ?? "#808080" }}
                      ></span>
                      <div className="flex-1 flex flex-col gap-0.75 leading-1.5">
                        <span className="block text-foreground font-medium">{line.headline}</span>
                        {line.detail && (
                          <span className="block text-muted-foreground text-2.5">{line.detail}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* QUICK ACTIONS */}
            <section className="bg-white border border-line rounded-lg p-3.5" data-testid="home-quick">
              <h2 className="font-medium text-sm m-0 mb-2">Quick</h2>
              <div className="flex flex-col gap-0">
                <a
                  href="#"
                  className="flex items-center py-2.75 border-b border-hair text-sm text-foreground no-underline cursor-pointer hover:text-primary"
                  data-testid="home-take-payment"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen?.("/money/payments?new=1");
                  }}
                >
                  Take a payment
                </a>
                <a
                  href="#"
                  className="flex items-center py-2.75 border-b border-hair text-sm text-foreground no-underline cursor-pointer hover:text-primary"
                  data-testid="home-send-invoice"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen?.("/money/invoices?new=1");
                  }}
                >
                  Send an invoice
                </a>
                <a
                  href="#"
                  className="flex items-center py-2.75 border-b border-hair text-sm text-foreground no-underline cursor-pointer hover:text-primary"
                  data-testid="home-add-client"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen?.("/people?new=1");
                  }}
                >
                  Add a client
                </a>
                <a
                  href="#"
                  className="flex items-center py-2.75 text-sm text-foreground no-underline cursor-pointer hover:text-primary"
                  data-testid="home-book-session"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen?.("/engagements/calendar?new=1");
                  }}
                >
                  Book a session
                </a>
              </div>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
