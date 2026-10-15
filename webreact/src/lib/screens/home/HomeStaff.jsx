// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 17.29 — HOMESTAFF. A coach's Home: sessions hero, staff prompts, Today, This week, Your people.
// No money, no Run, no payment verbs.
//
// BUILT FROM `specs/mockups/HomeStaff.frame.html`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo, useCallback } from "react";
import HeroNumber from "@/lib/components/kit/HeroNumber.jsx";
import PromptBand from "@/lib/prompts/PromptBand.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

export default function HomeStaff({ data = {}, onOpen = null, onDismiss = null }) {
  const motion = 220; // Animation duration in ms

  // Derive data shape for coach
  const hero = useMemo(() => data.hero ?? {}, [data.hero]);
  const people = useMemo(() => data.people ?? {}, [data.people]);
  const prompts = useMemo(() => data.prompts ?? {}, [data.prompts]);
  const today = useMemo(() => data.today ?? [], [data.today]);
  const week = useMemo(() => data.week ?? [], [data.week]);
  const headline = useMemo(() => data.headline ?? {}, [data.headline]);

  // Compute week stats
  const weekTotal = useMemo(() => (week ?? []).reduce((a, d) => a + (d.n ?? 0), 0), [week]);
  const weekMax = useMemo(() => Math.max(1, ...(week ?? []).map((d) => d.n ?? 0)), [week]);
  const barHeight = useCallback((n) => Math.max(6, Math.round(6 + (n / weekMax) * 74)), [weekMax]);

  // Format time (HH:MM)
  const timeOf = useCallback((isoString) => {
    if (!isoString) return "";
    try {
      return new Date(isoString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }, []);

  // Format day name (Mon, Tue, etc.)
  const dayName = useCallback((dateStr) => {
    if (!dateStr) return "";
    // a bare YYYY-MM-DD parses as UTC midnight — the previous weekday west of Greenwich; noon local is safe
    const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00` : dateStr;
    try {
      return new Date(d).toLocaleDateString("en-US", { weekday: "short" });
    } catch {
      return "";
    }
  }, []);

  // Map status to tone for StatusBadge
  const getTone = useCallback((status) => {
    if (status === "confirmed") return "ok";
    if (status === "unsigned") return "warn";
    if (status === "open") return "neutral";
    return "neutral";
  }, []);

  return (
    <section className="flex flex-col gap-0" data-testid="home">
      {/* HERO NUMBER: Sessions this week with delta */}
      {hero && hero.sessions !== undefined && (
        <div className="bg-surface border-b border-line p-4">
          <HeroNumber
            figure={hero.sessions}
            label="sessions this week"
            sub={hero.deltaSentence ?? ""}
            testId="hero-sessions"
          />
        </div>
      )}

      {/* PROMPT BAND: Staff prompts (up to 3, then "N more things need you") */}
      {prompts && prompts.items && (
        <div className="px-6 pt-7.5 pb-0">
          <PromptBand
            prompts={prompts.items}
            limit={3}
            moreCount={prompts.moreCount ?? 0}
            moreHref="/home/prompts"
            onDismiss={onDismiss}
          />
        </div>
      )}

      {/* THREE COLUMNS: Today (left) / This week (left) / Your people (right) */}
      <div className="flex gap-5.5 items-start px-6 py-6.5" style={{ minWidth: 0 }}>
        <div className="flex-1 min-w-0">
          {/* TODAY BAND */}
          {today && today.length > 0 && (
            <section className="bg-surface border border-line rounded-lg mb-4.5" data-testid="home-today">
              <div className="flex items-center justify-between p-3.5 border-b border-hair">
                <h2 className="font-500 text-sm m-0">Today</h2>
                <button
                  type="button"
                  className="text-xs text-primary no-underline cursor-pointer border-0 bg-none p-0 hover:underline"
                  data-testid="home-open-calendar"
                  onClick={() => onOpen?.("/engagements/calendar")}
                >
                  Open calendar
                </button>
              </div>
              <ul className="list-none m-0 p-1.5 px-4.25 pb-3.5">
                {today.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm">
                    <span className="w-18.5 flex-shrink-0 font-fraunces tabular-nums text-xs text-muted-foreground">
                      {timeOf(s.starts_at)}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <button
                        type="button"
                        className="p-0 border-0 bg-none text-left text-sm text-foreground overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer hover:text-primary m-0"
                        onClick={() => onOpen?.(`/record/booking/${s.id}`)}
                      >
                        {s.who ?? "No one added yet"}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {s.service_name ?? "Session"}
                      </span>
                    </span>
                    {s.tag && (
                      <StatusBadge
                        label={s.tag.label}
                        tone={getTone(s.tag.value)}
                        testId={`tag-${s.tag.value}`}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {today !== undefined && today.length === 0 && (
            <section className="bg-surface border border-line rounded-lg mb-4.5" data-testid="home-today">
              <div className="p-3.5 border-b border-hair">
                <h2 className="font-500 text-sm m-0">Today</h2>
              </div>
              <div className="p-6">
                <EmptyState
                  kind="first-run"
                  headline="Nothing booked today"
                  line=""
                  testId="home-today-empty"
                />
              </div>
            </section>
          )}

          {/* THIS WEEK BAND */}
          {week && week.length > 0 && (
            <section className="bg-surface border border-line rounded-lg mb-4.5" data-testid="home-week">
              <div className="p-3.5 border-b border-hair">
                <h2 className="font-500 text-sm m-0">This week</h2>
              </div>
              <div className="px-4.25 py-2">
                <div className="flex gap-1.5 items-end h-20 py-2">
                  {week.map((day) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${barHeight(day.n)}px`,
                          backgroundColor: day.n > 0 ? "var(--color-brand)" : "var(--color-brand-soft)",
                        }}
                      ></div>
                      <div className="text-2.875 text-muted-foreground">{dayName(day.date)}</div>
                    </div>
                  ))}
                </div>
              </div>
              {headline && headline.text && (
                <p className="text-sm text-muted-foreground m-0 px-4.25 pb-1.5 leading-relaxed">
                  {headline.text}
                </p>
              )}
            </section>
          )}
        </div>

        {/* RIGHT COLUMN: Your people */}
        {people && (
          <div className="w-80 flex-shrink-0">
            <section className="bg-surface border border-line rounded-lg" data-testid="home-people">
              <div className="p-3.5 border-b border-hair">
                <h2 className="font-500 text-sm m-0">Your people</h2>
              </div>
              <ul className="list-none m-0 p-1.5 px-4.25 pb-3.5">
                {people.clients !== undefined && (
                  <li className="flex flex-col py-2.75 border-b border-hair last:border-b-0">
                    <span className="font-fraunces text-5.5 font-400 tabular-nums text-ink">
                      {people.clients}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">clients</span>
                  </li>
                )}
                {people.drifting !== undefined && (
                  <li className="flex flex-col py-2.75 border-b border-hair last:border-b-0">
                    <span className="font-fraunces text-5.5 font-400 tabular-nums text-ink">
                      {people.drifting}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">haven't rebooked</span>
                  </li>
                )}
                {people.notesToWrite !== undefined && (
                  <li className="flex flex-col py-2.75 border-b border-hair last:border-b-0">
                    <span className="font-fraunces text-5.5 font-400 tabular-nums text-ink">
                      {people.notesToWrite}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">notes to write</span>
                  </li>
                )}
              </ul>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
