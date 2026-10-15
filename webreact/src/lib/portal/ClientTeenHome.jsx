// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.38 — TEEN HOME (AppClientTeen) — NO MONEY, THE 988 LINE ALWAYS
//
// ★★★ THE ADOLESCENT CLIENT'S HOME: next session, privacy card explaining what guardians can see,
//     sign card for agreements, coming up sessions, "if you need to" actions, and ALWAYS the
//     crisis line (988) — including when data is loading or errored.
//
// ★★★ NO MONEY. The teen payload carries zero money keys. This component imports NO money-related
//     functions like formatValue, and renders no money UI, not even disabled. The crisis line is
//     rendered from the server's CRISIS_LINE constant.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import { CRISIS_LINE } from "@keystone/app/crisisLine.mjs";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import { PhoneRow, PhoneSectionLabel } from "@/lib/phone/PhoneRow.jsx";

export default function ClientTeenHome({ data = null, role = null, onNavigate = null }) {
  // ★ Data flows from 18.35's teenHome() payload.
  const payload = useMemo(() => data?.data ?? data ?? {}, [data]);
  const next = useMemo(() => payload.next ?? null, [payload]);
  const toSign = useMemo(() => payload.toSign ?? null, [payload]);
  const guardianWord = useMemo(() => payload.guardianWord ?? "parent", [payload]);
  const move = useMemo(() => payload.move ?? null, [payload]);
  const comingUp = useMemo(
    () => (Array.isArray(payload.comingUp) ? payload.comingUp : []),
    [payload]
  );
  const crisisLine = useMemo(() => payload.crisisLine ?? CRISIS_LINE, [payload]);

  // ★ Screen state: loading, error, ready. The crisis line appears in all states.
  const phase = useMemo(() => {
    if (data?.error) return "error";
    if (payload.next === undefined && payload.toSign === undefined) return "loading";
    return "ready";
  }, [data, payload]);

  // ★ NAVIGATE HELPERS — each button wires to its real surface via onNavigate.
  function goToMessages() {
    if (onNavigate) {
      // ★ The teen messages the host; no hostId needed in the query since the route scopes it.
      onNavigate("/app/messages");
    }
  }

  function goToDocuments(docId) {
    if (onNavigate) onNavigate("/app/documents?id=" + docId);
  }

  // ★ FORMAT HELPERS
  function formatSessionDate(startsAt) {
    const d = new Date(startsAt);
    const day = d.toLocaleDateString("en-US", { weekday: "short" });
    const date = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "short" });
    return `${day}${date} ${month}`;
  }

  function formatSessionTime(startsAt) {
    const d = new Date(startsAt);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  // ★ PRONOUN RESOLUTION for privacy card
  function pronounFor(guardianWordIn) {
    if (guardianWordIn === "mum") return "she";
    if (guardianWordIn === "dad") return "he";
    return "they";
  }

  // ★ CRISIS CARD — always rendered in all states
  function CrisisCard() {
    return (
      <div className="text-[12.5px] text-mute text-center py-[14px] px-0 mt-[18px]">
        <div className="mb-2">{crisisLine}</div>
        <div className="flex gap-3 justify-center">
          <a href="tel:988" className="text-brand no-underline font-medium text-sm hover:underline">
            Call 988
          </a>
          <a href="sms:988" className="text-brand no-underline font-medium text-sm hover:underline">
            Text 988
          </a>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <>
        <ScreenState phase="error" error={data?.error} subject="Your home" />
        <CrisisCard />
      </>
    );
  }

  if (phase === "loading") {
    return (
      <>
        <ScreenState phase="loading" />
        <CrisisCard />
      </>
    );
  }

  // ★★★ READY STATE — the full teen home with next session, privacy, agreements, and crisis line
  return (
    <div className="flex flex-col">
      {/* ★ HERO SECTION — next session time and location */}
      {next && (
        <div className="py-1 pb-2 mb-2">
          <div className="text-4xl font-normal tracking-[-0.02em] leading-tight text-ink m-0">
            {(() => {
              const d = new Date(next.startsAt);
              const day = d.toLocaleDateString("en-US", { weekday: "long" });
              const time = d.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              });
              return `${day}, ${time}`;
            })()}
          </div>
          <div className="text-[13.5px] text-mute mt-1.5 leading-relaxed">
            With {next.hostName?.split(" ")[0] || `your coach`} &mdash;{" "}
            {next.place?.detail || "TBA"}, {next.durationMinutes} minutes
          </div>
        </div>
      )}

      {/* ★ PRIVACY CARD — what the guardian can see */}
      <PhoneCard variant="act" label={`What your ${guardianWord} can see`}>
        <div className="text-sm text-mute mt-1.5 leading-relaxed">
          That you turned up, and{" "}
          {guardianWord === "parent"
            ? "what they owe."
            : `what ${pronounFor(guardianWord)} owes.`}
          <b className="font-bold"> Not what you talk about, and not your notes.</b>{" "}
          {next?.hostName?.split(" ")[0] || `Your coach`} can explain how that works if you want.
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => goToMessages()}
            className="flex-1 h-8 px-[13px] text-sm border border-line rounded-lg bg-white text-mute font-medium cursor-pointer hover:bg-surface whitespace-nowrap"
          >
            Ask {next?.hostName?.split(" ")[0] || "them"} about it
          </button>
        </div>
      </PhoneCard>

      {/* ★ SIGN CARD — documents waiting for signature */}
      {toSign && (
        <PhoneCard variant="warm" label="One thing to sign">
          <div className="text-sm text-mute mt-1.5 leading-relaxed">{toSign.sentence}</div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => goToDocuments(toSign.documentId)}
              className="flex-1 h-8 px-[13px] text-sm border border-brand rounded-lg bg-brand text-white font-medium cursor-pointer hover:bg-[#4339b8] whitespace-nowrap"
            >
              Read it
            </button>
          </div>
        </PhoneCard>
      )}

      {/* ★ COMING UP — next sessions */}
      {comingUp.length > 0 && (
        <div className="mt-[18px]">
          <PhoneSectionLabel>Coming up</PhoneSectionLabel>
          <PhoneCard>
            {comingUp.map((booking, idx) => (
              <div key={idx} className="flex items-start gap-3 py-[13px] border-b last:border-b-0" style={{ borderColor: "var(--color-structure-150)" }}>
                <div className="w-[54px] flex-shrink-0 tabular-nums text-[12.5px] leading-relaxed" style={{ color: "var(--color-structure-600)" }}>
                  <strong className="block text-ink font-medium text-[13.5px]">
                    {formatSessionDate(booking.date).split(" ")[0]}
                  </strong>
                  {formatSessionDate(booking.date).split(" ").slice(1).join(" ")}
                </div>
                <div className="flex-1">
                  <div className="text-[14px] text-ink leading-relaxed">{booking.service}</div>
                  <div className="text-[12.5px] mt-[3px] leading-relaxed" style={{ color: "var(--color-structure-600)" }}>
                    {formatSessionTime(booking.time)} &middot; {booking.place?.detail || "TBA"}
                  </div>
                </div>
                <Badge variant="outline">{booking.state}</Badge>
              </div>
            ))}
          </PhoneCard>
        </div>
      )}

      {/* ★ IF YOU NEED TO — actions the teen can take */}
      <div className="mt-[18px]">
        <PhoneSectionLabel>If you need to</PhoneSectionLabel>
        <PhoneCard>
          {move?.allowed && (
            <PhoneRow title="Move a session" detail="Free up to 24 hours before" />
          )}
          {/* ★ the maintainer, 29 Sep 2026 — FOUND LIVE: this row named "Message {coach}" had no onClick at
              all, a row that looks actionable and does nothing (CLAUDE.md's "built and wired to
              nothing"). Wired to the same messages surface every other "Message" control uses. */}
          <PhoneRow
            title={`Message ${next?.hostName?.split(" ")[0] || "your coach"}`}
            detail="They usually get back within a few hours"
            onClick={goToMessages}
            testId="teen-message-coach"
          />
        </PhoneCard>
      </div>

      {/* ★★★ CRISIS LINE — ALWAYS RENDERED, sits outside data-dependent bands */}
      <CrisisCard />
    </div>
  );
}
