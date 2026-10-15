// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 18.30 — GET PAID AND TAP TO PAY (AppStaffGetPaid, PhoneGetPaid, AppStaffTapToPay)
//
// ★★★ THE FOUR WAYS TO GET PAID. Staff can tap a card, send an invoice, send a payment link, or
//     type in a card. The Get Paid tab shows the four ways and lists invoices owed right now with
//     Chase (sends a reminder, Stage 15) or Take it (opens the Tap to Pay flow).
//
// ★★ WITHOUT THE MONEY CAPABILITY, the whole tab body is DisabledWithReason "Taking money needs
//     the Owner to turn it on for you." Each way's flow is Stage 15; ways without a live flow
//     render `DisabledWithReason` "Not built yet".
//
// ★ STATES: nothing owing ("Nobody owes anything right now."), loading, error, no permission,
//   tap unavailable (the sentence about browser limitation).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api.js";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function StaffGetPaid({ app, onNavigate }) {
  const [invoices, setInvoices] = useState(null);
  const [invoicesError, setInvoicesError] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [capabilitiesError, setCapabilitiesError] = useState(null);
  const [loading, setLoading] = useState(true);

  // ★ Load invoices and capabilities on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const inv = await api.moneyInvoicesSummary();
        setInvoices(inv);
      } catch (err) {
        setInvoicesError(err);
      }

      try {
        const cap = await api.capabilities();
        setCapabilities(cap);
      } catch (err) {
        setCapabilitiesError(err);
      }

      setLoading(false);
    };

    loadData();
  }, []);

  // ★ Check if user has money capability (take_payments)
  const hasMoneyCapability = useMemo(() => {
    if (!capabilities?.capabilities) return false;
    const payCap = capabilities.capabilities.find(c => c.capability === "take_payments");
    return payCap?.available === true;
  }, [capabilities]);

  // ★ Format amount in dollars
  const formatAmount = (minor) => {
    if (minor === null || minor === undefined) return "$0.00";
    return (minor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  };

  // ★ Format due date or days late
  const formatDueStatus = (invoice) => {
    if (!invoice.due_date && !invoice.days_late) return "due soon";

    if (invoice.days_late && invoice.days_late > 0) {
      return `${invoice.days_late} day${invoice.days_late === 1 ? "" : "s"} late`;
    }

    if (invoice.due_date) {
      const date = new Date(invoice.due_date);
      return `due ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }

    return "due soon";
  };

  // ★ Filter to open/overdue invoices
  const owingInvoices = useMemo(() => {
    if (invoices && Array.isArray(invoices.rows)) {
      return invoices.rows.filter(inv => inv.status === "open" || inv.status === "overdue");
    }
    return [];
  }, [invoices]);

  // ★ Check if tap_to_pay flag is available (not being_built)
  const tapToPayAvailable = useMemo(() => {
    return app?.config?.feature_flags?.tap_to_pay?.available === true;
  }, [app]);

  // ★ Handle Take it button click
  const handleTakeIt = (invoiceId) => {
    if (onNavigate) onNavigate(`/staff/get-paid/tap/${invoiceId}`);
  };

  // ★ Four ways with their exact fee sentences (from frame)
  const paymentWays = [
    {
      key: "tap",
      title: "Tap their card on your phone",
      subtitle: "2.7% + 5¢. Nothing to carry, nothing to plug in.",
      icon: "≋",
      available: true, // Stage 15 flow exists
    },
    {
      key: "invoice",
      title: "Send an invoice",
      subtitle: "2.9% + 30¢, or 0.8% capped at $5 if they pay by bank.",
      icon: "$",
      available: true, // Stage 15 flow exists
    },
    {
      key: "link",
      title: "Send a payment link",
      subtitle: "A text or a message. They pay on their own phone.",
      icon: "↗",
      available: true, // Stage 15 flow exists
    },
    {
      key: "type",
      title: "Type a card in",
      subtitle: "3.4% + 30¢. The dearest way — only if they'd rather read it out.",
      icon: "⊟",
      available: true, // Stage 15 flow exists
    },
  ];

  // ★ Determine phase for ScreenState
  const phase = useMemo(() => {
    if (loading) return "loading";
    if (capabilitiesError) return "error";
    if (!hasMoneyCapability) return "ready"; // Show disabled ways
    return "ready";
  }, [loading, capabilitiesError, hasMoneyCapability]);

  // ★ Render loading state
  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  // ★ Render capabilities error
  if (capabilitiesError) {
    return <ErrorPanel error={capabilitiesError} subject="Capabilities" />;
  }

  // ★ Render disabled state or ready state
  return (
    <div className="px-4 py-4">
      {!hasMoneyCapability ? (
        <DisabledWithReason
          disabled={true}
          reason="Taking money needs the Owner to turn it on for you."
          testId="get-paid-no-capability"
        >
          {({ disabled, describedBy }) => (
            <div className="flex flex-col gap-[11px]" style={{ opacity: disabled ? 0.6 : 1 }}>
              {paymentWays.map((way) => (
                <PhoneCard key={way.key} variant="act">
                  <div className="flex items-center gap-[13px]">
                    <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-avatar-ink" style={{ fontSize: "17px" }}>
                      {way.icon}
                    </div>
                    <div className="flex-1">
                      <div className="mb-1 font-medium text-sm text-ink">{way.title}</div>
                      <div className="text-xs leading-[1.5] text-mute">{way.subtitle}</div>
                    </div>
                    <div className="flex-shrink-0 text-lg text-chevron">›</div>
                  </div>
                </PhoneCard>
              ))}

              {invoices && owingInvoices.length > 0 && (
                <>
                  <div className="mt-4 mb-1 text-xs font-medium text-mute">Owing right now</div>
                  {owingInvoices.map((invoice) => (
                    <div key={invoice.id} className="text-sm">
                      <div className="font-medium text-ink">{invoice.person_name}</div>
                      <div className="text-xs text-mute">
                        {formatAmount(invoice.amount_minor)} · {formatDueStatus(invoice)}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </DisabledWithReason>
      ) : (
        <>
          {/* ★ Render payment ways */}
          <div className="flex flex-col gap-[11px]">
            {paymentWays.map((way) => (
              <PhoneCard key={way.key} variant="act">
                <div className="flex items-center gap-[13px]">
                  <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-avatar-ink" style={{ fontSize: "17px" }}>
                    {way.icon}
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 font-medium text-sm text-ink">{way.title}</div>
                    <div className="text-xs leading-[1.5] text-mute">{way.subtitle}</div>
                  </div>
                  <div className="flex-shrink-0 text-lg text-chevron">›</div>
                </div>
              </PhoneCard>
            ))}
          </div>

          {/* ★ Owing invoices section */}
          {invoicesError && (
            <div className="mt-4">
              <ErrorPanel error={invoicesError} subject="Owing invoices" />
            </div>
          )}
          {invoices && owingInvoices.length === 0 && (
            <div className="mt-14 text-center py-14 text-sm text-mute">Nobody owes anything right now.</div>
          )}
          {invoices && owingInvoices.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-mute">Owing right now</div>
              {owingInvoices.map((invoice, idx) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between gap-3 py-3"
                  style={{
                    borderBottom: idx === owingInvoices.length - 1 ? "none" : `1px solid var(--color-line)`,
                  }}
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm text-ink">{invoice.person_name}</div>
                    <div className="text-xs text-mute">
                      {formatAmount(invoice.amount_minor)} · {formatDueStatus(invoice)}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-3 h-8 text-xs font-medium"
                    >
                      Chase
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-3 h-8 text-xs font-medium"
                      onClick={() => handleTakeIt(invoice.id)}
                    >
                      Take it
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
