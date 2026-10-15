// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R5.018 — OnlineBookingScreen: rebuild from specs/mockups/EngOnlineBooking.frame.html on
// LedgerPage. Ported from webui/src/lib/screens/engagements/OnlineBookingScreen.svelte (381 lines,
// 50 of them <style>): same props, testids and copy; markup/data/handlers ported; styles become
// Tailwind utilities + tokens (19 ks-* classes replaced).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import OnlineBookingScreenOnlineBookingPageTable from "./OnlineBookingScreenOnlineBookingPageTable.jsx";

const NUMBER_WORDS = [null, "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

function numberWord(n) {
  return n >= 1 && n <= 12 ? NUMBER_WORDS[n] : String(n);
}

function formatMinutes(mins) {
  if (!Number.isFinite(mins)) return null;
  if (mins % 60 === 0) {
    const h = mins / 60;
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  return `${mins} ${mins === 1 ? "minute" : "minutes"}`;
}

export default function OnlineBookingScreen({ onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [bookingSettings, setBookingSettings] = useState(null);
  const [prompts, setPrompts] = useState([]);

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function openService() {
    go("/items/services");
  }

  function openPreview() {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open("/book", "_blank", "noopener");
    }
  }

  async function dismissPromptNow(p) {
    try {
      await api.dismissPrompt(p.kind, p.subjectId ?? null);
      setPrompts(prompts.filter((x) => x.dismissKey !== p.dismissKey));
    } catch {
      // Left on screen on failure — a prompt that vanished on a failed dismiss would be a
      // dismiss that silently didn't happen
    }
  }

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const [ob, bs] = await Promise.all([
        request("/api/engagements/online-booking"),
        request("/api/engagements/booking-settings"),
      ]);
      setView(ob);
      setBookingSettings(bs);
      const publicCount = (ob?.services ?? []).filter((s) => s.publicBookable).length;
      setPhase(publicCount === 0 ? "empty" : "ready");
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

  // Load prompts independently
  useEffect(() => {
    let live = true;
    api.prompts("online_booking").then((r) => { if (live) setPrompts(r?.prompts ?? []); })
      .catch(() => { if (live) setPrompts([]); });
    return () => { live = false; };
  }, []);

  // Initial load of main data
  useEffect(() => {
    load();
  }, []);

  const services = view?.services ?? [];
  const rules = view?.rules ?? null;
  const lastChanged = bookingSettings?.lastChanged ?? null;
  const onlineEnabled = bookingSettings?.keys?.["booking.online_enabled"] !== false;

  const summary = (() => {
    const pub = services.filter((s) => s.publicBookable).length;
    const hidden = services.length - pub;
    if (pub === 0) return null;
    const first = `${numberWord(pub)} ${pub === 1 ? "service is" : "services are"} public.`;
    if (hidden === 0) return first;
    const second = hidden === 1 ? "One is deliberately not." : `${numberWord(hidden)} are deliberately not.`;
    return `${first} ${second}`;
  })();

  function bookedLabel(n) {
    const count = Number.isFinite(n) ? n : 0;
    return `${count} booked`;
  }

  const ruleRows = (() => {
    if (!rules) return [];
    const notice = formatMinutes(rules.noticeMinutes);
    const days = rules.windowDays;
    return [
      {
        id: "notice",
        headline: notice ? `At least ${notice} ahead` : "A minimum notice window applies",
        sub: "Nobody books you at the last minute.",
      },
      {
        id: "window",
        headline: Number.isFinite(days)
          ? `No further than ${days} ${days === 1 ? "day" : "days"} out`
          : "A booking window applies",
        sub: "Your calendar stops there.",
      },
      {
        id: "card",
        headline: rules.cardRequiredExceptFree
          ? "A card on file, except for the free one"
          : "No card is required to book",
        sub: rules.cardRequiredExceptFree
          ? "Nothing is charged at booking — it's there in case a late cancellation is charged."
          : "Anyone can book without a card on file.",
      },
      {
        id: "staff",
        headline: rules.showStaffChoice
          ? "They pick a person, or leave it to us"
          : "We choose who they see",
        sub: rules.showStaffChoice
          ? '"Anyone" gets whoever is free.'
          : "The coach list is hidden — every booking goes to whoever's free.",
      },
    ];
  })();

  return (
    <LedgerPage
      title="Online booking"
      summary={summary}
      primary={{
        label: "Preview your page",
        onClick: openPreview,
        disabled: !onlineEnabled,
        disabledReason: !onlineEnabled
          ? "Online booking is off — turn it on in booking settings to preview your page."
          : undefined,
      }}
      testId="online-booking-page"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        empty={{
          kind: "blocked",
          headline: "Nothing is public yet",
          line: "Strangers can't book anything until at least one service is public.",
          action: { label: "Make a service public", href: "/items/services" },
        }}
        onNavigate={go}
        testIds={{ empty: "online-booking-empty", error: "online-booking-error", denied: "online-booking-denied" }}
      >
        <OnlineBookingScreenOnlineBookingPageTable
          onNavigate={go}
          phase={phase}
          error={phase === "error" ? error : null}
          services={services}
          lastChanged={lastChanged}
          onlineEnabled={onlineEnabled}
          prompts={prompts}
          dismissPromptNow={dismissPromptNow}
          summary={summary}
          bookedLabel={bookedLabel}
          openService={openService}
          openPreview={openPreview}
          ruleRows={ruleRows}
        />
      </ScreenState>
    </LedgerPage>
  );
}
