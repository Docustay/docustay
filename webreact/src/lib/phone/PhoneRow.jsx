// PhoneRow / PhoneSectionLabel — the one row shape and one section-heading shape for every phone
// screen. Extracted from PortalProfile.jsx (the first screen rebuilt against the portal design
// critique, 29 Sep 2026) so the other 13 portal screens read as ONE app, not fourteen independent
// guesses at "what a row looks like". A ruling on how a row or a heading looks lands here once.
import { ChevronRight } from "lucide-react";

// ★ Critique #8 — section labels barely differed from the rows under them. Uppercase + letter-
//   spacing makes them read as section headings, not as one more row.
export function PhoneSectionLabel({ children }) {
  return (
    <div
      className="text-[11px] font-semibold uppercase tracking-wide m-0 mt-[22px] mb-2 px-1"
      style={{ color: "var(--color-structure-500)" }}
    >
      {children}
    </div>
  );
}

// ★ Critique #5 ("rows don't match") and #10 (pale grey chevron, low contrast) — one row shape,
//   with a chevron dark enough to actually read as clickable. `trailing` replaces the chevron for
//   a row whose action isn't "go somewhere" (e.g. a switch, a status word).
export function PhoneRow({ title, detail, onClick, trailing, testId }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className="flex items-center justify-between gap-3 py-[13px] w-full text-left bg-transparent border-0 border-b last:border-b-0"
      style={{ borderColor: "var(--color-structure-150)" }}
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-normal m-0 text-ink">{title}</div>
        {detail && (
          <div className="text-[12.5px] mt-1 truncate" style={{ color: "var(--color-structure-600)" }}>
            {detail}
          </div>
        )}
      </div>
      {trailing ?? (onClick && (
        <ChevronRight size={18} strokeWidth={2} style={{ color: "var(--color-structure-500)" }} aria-hidden="true" />
      ))}
    </Tag>
  );
}
