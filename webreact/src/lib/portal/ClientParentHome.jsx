// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.37 — PARENT HOME (AppClientParent)
//
// ★★★ FAMILY MONEY AND ATTENDANCE ONLY. A parent sees their children's attendance and the
//     family money, co-sign documents, and can pay both in one payment. They see NOTHING about
//     what was said in sessions — that stays with the child.
//
// ★ Every control is wired to a real call: Pay (to /app/payments), Pay both (to api.appPay),
//   and the flow dispatches through the existing payment route to the Stripe element flow.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import { formatValue } from "@/lib/format.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import { PhoneSectionLabel } from "@/lib/phone/PhoneRow.jsx";

export default function ClientParentHome({ data = null, role = null, onNavigate = null }) {
  // Derive payload, family, children, and cosign from data
  const payload = useMemo(() => data?.data ?? data ?? {}, [data]);
  const family = useMemo(() => payload.family ?? {}, [payload]);
  const children = useMemo(() => (Array.isArray(family.children) ? family.children : []), [family]);
  const cosign = useMemo(() => (Array.isArray(family.cosign) ? family.cosign : []), [family]);

  // Determine phase from data structure
  const phase = useMemo(() => {
    if (data?.error) return "error";
    if (family.totalDueMinor === undefined) return "loading";
    return "ready";
  }, [data, family]);

  // Navigate helpers
  function goToPayments() {
    if (onNavigate) onNavigate("/app/payments");
  }

  // Format helpers
  function formatMoney(amountMinor, currency) {
    return formatValue(amountMinor, "money", { currency });
  }

  function invoicesInWords(n) {
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    return words[Math.min(n, 10)] || String(n);
  }

  function childNamesJoined(childArray) {
    if (childArray.length === 0) return "";
    if (childArray.length === 1) return childArray[0].firstName;
    const names = childArray.map((c) => c.firstName);
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  function formatSessionTime(startsAt) {
    const d = new Date(startsAt);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  function formatSessionDate(startsAt) {
    const d = new Date(startsAt);
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }

  function formatDueDate(dueAt) {
    const d = new Date(dueAt);
    const day = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "long" });
    return `${day} ${month}`;
  }

  function formatExpiryDate(expiresAt) {
    const d = new Date(expiresAt);
    const day = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "long" });
    return `${day} ${month}`;
  }

  function sessionCountText(child) {
    if (child.expiresAt) {
      return `${child.remaining} left, expiring ${formatExpiryDate(child.expiresAt)}`;
    } else if (child.sinceMonth) {
      const monthDate = new Date(child.sinceMonth + "-01");
      const month = monthDate.toLocaleDateString("en-US", { month: "long" });
      return `${child.total} sessions since ${month}`;
    }
    return "";
  }

  // Helper to build the total due text
  function totalDueText() {
    if (!family.openInvoices) return "Nothing owed right now.";
    const total = formatMoney(family.totalDueMinor, family.currency);
    const invoiceCount = invoicesInWords(family.openInvoices);
    const dueText = family.latestDueAt ? `due ${formatDueDate(family.latestDueAt)}` : "due";
    return `${total} — ${invoiceCount} invoice${family.openInvoices === 1 ? "" : "s"}, ${dueText}`;
  }

  // Helper to build boundary text
  function boundaryText() {
    const names = childNamesJoined(children);
    return `You see when ${names} come, and what's owed. You don't see their notes or what they talk about — that's theirs.`;
  }

  // Pay both at once is only shown when there are 2+ open invoices
  const showPayBoth = useMemo(() => family.openInvoices > 1, [family]);

  // Navigate to pay both
  async function handlePayBoth() {
    if (!onNavigate || family.openInvoices === 0) return;
    goToPayments();
  }

  if (phase === "error") {
    return <ScreenState phase="error" error={data?.error} subject="Your family account" />;
  }

  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  return (
    <div className="flex flex-col">
      {/* Hero card — family total and invoice count */}
      <div className="pb-[14px] mb-2">
        <div className="text-[34px] font-normal tracking-[-0.02em] leading-[1.05] text-ink m-0">
          {family.totalDueMinor ? formatMoney(family.totalDueMinor, family.currency) : "$0"}
        </div>
        <div className="text-[13.5px] text-mute mt-1.5 leading-[1.5]">
          {totalDueText()}
        </div>
      </div>

      {/* Boundary card — what parent can and can't see */}
      <PhoneCard variant="act" label="What you can and can't see">
        <div className="text-[13px] text-mute mt-[5px] leading-[1.55]">
          {boundaryText()}
        </div>
      </PhoneCard>

      {/* Per-child cards — attendance and money only */}
      {children.map((child) => (
        <div key={child.childId} className="mt-[18px]">
          <PhoneSectionLabel>
            {child.firstName}
            {child.age != null ? `, ${child.age}` : ""}
          </PhoneSectionLabel>
          <PhoneCard>
            {/* Next session */}
            {child.next && (
              <div className="flex items-start gap-3 py-[13px] border-b" style={{ borderColor: "var(--color-structure-150)" }}>
                <span className="flex-1 block font-medium text-[13.5px] text-ink">
                  Next: {formatSessionDate(child.next.startsAt)} {formatSessionTime(child.next.startsAt)}
                  <span className="block text-[12.5px] mt-[3px]" style={{ color: "var(--color-structure-600)" }}>
                    {child.next.serviceName} · {child.next.place?.detail ?? "TBA"}
                  </span>
                </span>
              </div>
            )}

            {/* Attendance / sessions */}
            {(child.total > 0 || child.remaining > 0) && (
              <div className="flex items-start gap-3 py-[13px] border-b" style={{ borderColor: "var(--color-structure-150)" }}>
                <span className="flex-1 block font-medium text-[13.5px] text-ink">
                  {child.used} of {child.total} sessions used
                  <span className="block text-[12.5px] mt-[3px]" style={{ color: "var(--color-structure-600)" }}>
                    {sessionCountText(child)}
                  </span>
                </span>
              </div>
            )}

            {/* Owing line (only when owingMinor is not null) */}
            {child.owingMinor !== null && (
              <div className="flex items-start gap-3 py-[13px] last:border-b-0" style={{ borderColor: "var(--color-structure-150)" }}>
                <span className="flex-1 block font-medium text-[13.5px] text-ink">
                  {formatMoney(child.owingMinor, family.currency)} owing
                  <span className="block text-[12.5px] mt-[3px]" style={{ color: "var(--color-structure-600)" }}>
                    September coaching
                  </span>
                </span>
                <button
                  onClick={goToPayments}
                  className="h-8 px-[13px] text-[13px] border rounded-[7px] bg-white font-medium cursor-pointer flex-shrink-0 hover:bg-[var(--color-structure-50)] whitespace-nowrap"
                  style={{ borderColor: "var(--color-structure-200)", color: "var(--color-structure-900)" }}
                >
                  Pay
                </button>
              </div>
            )}
          </PhoneCard>
        </div>
      ))}

      {/* Co-sign card — documents needing both signatures */}
      {cosign.length > 0 && (
        <div className="mt-[18px]">
          <PhoneSectionLabel>Both</PhoneSectionLabel>
          <PhoneCard>
            {cosign.map((doc) => (
              <div key={doc.documentId} className="flex items-center gap-3 py-[13px] last:border-b-0" style={{ borderColor: "var(--color-structure-150)" }}>
                <span className="flex-1 block font-medium text-[13.5px] text-ink">
                  {cosign.length === 1 ? "One thing to sign" : cosign.length + " things to sign"}
                  <span className="block text-[12.5px] mt-[3px]" style={{ color: "var(--color-structure-600)" }}>
                    You need to sign it as well as {doc.childFirstName}
                  </span>
                </span>
                <div className="flex items-center flex-shrink-0">
                  <Badge variant="outline">
                    {doc.parentSigned && doc.childSigned ? "Both" : doc.parentSigned ? "Both" : "You"}
                  </Badge>
                </div>
              </div>
            ))}
          </PhoneCard>
        </div>
      )}

      {/* Pay both at once card — only when 2+ open invoices */}
      {showPayBoth && family.savedCard && (
        <PhoneCard variant="warm" label="Pay both at once">
          <div className="text-[13px] text-mute mt-[5px] leading-[1.55]">
            {formatMoney(family.totalDueMinor, family.currency)} on one payment. Your card ending{" "}
            {family.savedCard.lastFour} is saved.
          </div>
          <div className="flex gap-2 mt-[13px]">
            <button
              onClick={handlePayBoth}
              className="flex-1 h-8 px-[13px] text-[13px] border border-brand rounded-[7px] bg-brand text-white font-medium cursor-pointer hover:bg-[#4339b8] whitespace-nowrap"
            >
              Pay {formatMoney(family.totalDueMinor, family.currency)}
            </button>
          </div>
        </PhoneCard>
      )}
    </div>
  );
}
