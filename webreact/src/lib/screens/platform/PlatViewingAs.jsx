// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 18 TASK 18.9 — PLATVIEWINGAS: THE SUPPORT-VIEW PAGE
//
// ★★★ THE SUPPORT-VIEW PAGE, WIRED TO THE PLATFORM CHAIN (C-NEW-1)
//
// On mount: `api.supportView({ tenantId, section:"home" })` loads the first section.
// Each section click re-reads that section (intended — each read is one audit row).
// Banner shows: practice name, approval time, end time, "Read only" notice, "everything you open
// is in their log" warning.
// Three blocks: "What you came to look at" (why + 3 buttons), "What you've opened" (audit
// rows), "What you can't do in here" (3 fixed rows verbatim from the frame).
// 401 (expired) → ErrorPanel with server's sentence + back link. 403 (no approval) → same with
// "They haven't said yes."
//
// ★ CALLER: 18.14's "Open" link on the practice record → navigate `/platform/tenants/{tenantId}/look`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function PlatViewingAs({ app, tenantId, onNavigate }) {
  // ★ State for the screen
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [currentSection, setCurrentSection] = useState("home");

  // ★ Section buttons for What you came to look at
  const sections = [
    { key: "home", label: "Home" },
    { key: "billing", label: "Plans and billing" },
    { key: "money", label: "Money settings" },
  ];

  // ★ Fixed rows for What you can't do in here
  const restrictions = [
    {
      title: "Change anything",
      description: "Read only, always, unless they agreed otherwise separately",
    },
    {
      title: "Read session notes",
      description:
        `Never, on any access level. Those are between a coach and a client.`,
    },
    {
      title: "Stay past the hour",
      description: "It ends on its own",
    },
  ];

  // ★ Format time as h:mm in 12-hour format
  function formatTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  // ★ Format answer time with relative day (this morning/this afternoon/on {date})
  function formatAnswerTime(answeredAtString) {
    const answeredAt = new Date(answeredAtString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get start of answered day
    const answeredDay = new Date(
      answeredAt.getFullYear(),
      answeredAt.getMonth(),
      answeredAt.getDate()
    );

    let dayPart = "";
    if (answeredDay.getTime() === today.getTime()) {
      // Today — determine morning (before noon) or afternoon
      if (answeredAt.getHours() < 12) {
        dayPart = " this morning";
      } else {
        dayPart = " this afternoon";
      }
    } else {
      // Any other day — show as "on {date}"
      const dateStr = answeredAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      dayPart = ` on ${dateStr}`;
    }

    const timeStr = formatTime(answeredAtString);
    return `${timeStr}${dayPart}`;
  }

  // ★ Load initial data
  async function loadData(section = "home") {
    setLoading(true);
    setError(null);
    try {
      const result = await api.supportView({ tenantId, section });
      setData(result);
      setCurrentSection(section);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  // ★ Handle section button click
  async function handleSectionClick(section) {
    await loadData(section);
  }

  // ★ Handle Leave now button
  async function handleLeaveNow() {
    try {
      await api.endMyAccess({ tenantId });
      // Navigate back to the practice record
      onNavigate(`/platform/tenants/${tenantId}`);
    } catch (err) {
      console.error("Failed to end access:", err);
      setError(err);
    }
  }

  // ★ Format currency amount
  function formatCurrency(minorAmount, currency = "USD") {
    const majorAmount = minorAmount / 100;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(majorAmount);
  }

  useEffect(() => {
    loadData("home");
  }, []);

  if (loading && !data) {
    return <ScreenState phase="loading" />;
  }

  if (error) {
    // ★ 401 (expired) or 403 (no approval) — show ErrorPanel with back link
    return (
      <div className="flex flex-col gap-1.5">
        <ErrorPanel
          error={error}
          variant="page"
          onRetry={() => loadData(currentSection)}
        />
        <div className="text-center mt-5">
          <Button
            variant="ghost"
            onClick={() => onNavigate(`/platform/tenants/${tenantId}`)}
          >
            Back to practice record
          </Button>
        </div>
      </div>
    );
  }

  if (data) {
    return (
      <div className="flex flex-col gap-[22px] px-[30px] py-[26px] pb-[70px]">
        {/* ★ Banner: ◉ You are inside {name}'s account... */}
        <div className="flex items-center gap-[13px] rounded-[11px] border border-warning-border bg-warning-25 px-[17px] py-[13px] text-[13.5px] text-warning-800">
          <span className="flex-shrink-0 text-base">◉</span>
          <span className="flex-1">
            <b className="font-medium">You are inside {data.practice.name}'s account.</b>
            They said yes at {formatAnswerTime(data.answeredAt)}. Read only, ends at {formatTime(data.endsAt)},
            and everything you open is in their log with your name on it.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="flex-shrink-0"
            onClick={handleLeaveNow}
          >
            Leave now
          </Button>
        </div>

        {/* ★ Practice title and figures */}
        <div className="flex flex-col gap-[6px]">
          <h1 className="m-0 font-serif text-2xl font-medium tracking-tight">
            {data.practice.name}
          </h1>
          <div className="text-[13.5px] text-mute">
            {data.practice.clients} clients, {data.practice.staff} staff, {formatCurrency(data.practice.processedThisMonthMinor, data.practice.currency)} processed this month.
          </div>
        </div>

        {/* ★ Two-column layout: left (What you came to look at + What you've opened), right (What you can't do) */}
        <div className="flex gap-[22px] items-start max-md:flex-col">
          <div className="flex-1 min-w-0">
            {/* ★ What you came to look at */}
            <div className="rounded-card border border-line bg-surface mb-[18px]">
              <div className="flex items-center gap-[10px] px-[17px] py-[14px] border-b border-hair">
                <b className="flex-1 font-medium text-[14.5px]">
                  What you came to look at
                </b>
              </div>
              <div className="px-[17px] py-[14px]">
                <div className="mb-3 text-sm leading-relaxed">
                  {data.cameFor}
                </div>
                <div className="flex flex-wrap gap-2">
                  {sections.map((section) => (
                    <Button
                      key={section.key}
                      variant={currentSection === section.key ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSectionClick(section.key)}
                    >
                      {section.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* ★ What you've opened */}
            <div className="rounded-card border border-line bg-surface mb-[18px]">
              <div className="flex items-center gap-[10px] px-[17px] py-[14px] border-b border-hair">
                <b className="flex-1 font-medium text-[14.5px]">
                  What you've opened
                </b>
              </div>
              <div className="px-[17px] py-[14px]">
                {data.opened && data.opened.length > 0 ? (
                  data.opened.map((entry, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 py-[11px] border-b border-hair text-sm last:border-b-0"
                    >
                      <span className="w-[74px] flex-shrink-0 text-[13px] text-mute font-variant-numeric">
                        {formatTime(entry.at)}
                      </span>
                      <span className="flex-1">{entry.object}</span>
                    </div>
                  ))
                ) : (
                  // ★ On first load, the home read is the first row, so never empty after 200
                  <div className="flex items-center gap-3 py-[11px] border-b border-hair text-sm">
                    <span className="w-[74px] flex-shrink-0 text-[13px] text-mute font-variant-numeric">
                      {formatTime(data.answeredAt)}
                    </span>
                    <span className="flex-1">home</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="w-80 flex-shrink-0 max-md:w-full">
            {/* ★ What you can't do in here */}
            <div className="rounded-card border border-line bg-surface">
              <div className="flex items-center gap-[10px] px-[17px] py-[14px] border-b border-hair">
                <b className="flex-1 font-medium text-[14.5px]">
                  What you can't do in here
                </b>
              </div>
              <div className="px-[17px] py-[14px]">
                {restrictions.map((restriction, idx) => (
                  <div
                    key={idx}
                    className="py-[11px] border-b border-hair text-sm last:border-b-0"
                  >
                    <div className="font-medium">{restriction.title}</div>
                    <div className="text-[12.5px] text-mute leading-1.55 mt-1">
                      {restriction.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
