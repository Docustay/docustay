// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.050 — MoneyStatements: rebuild from the frame on the archetype
// Ported from webui/src/lib/screens/money/MoneyStatements.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import StripeSurface from "@/lib/money/StripeSurface.jsx";

export default function MoneyStatements({ onNavigate = null }) {
  return (
    <div data-testid="money-statements">
      {/* Page header with title and subtitle */}
      <div className="mb-4.5">
        <h1 className="m-0 text-heading font-medium text-ink tracking-[-0.01em]">
          Statements and tax forms
        </h1>
        <p className="m-0 mt-1.25 text-control text-mute">
          Everything Stripe has issued you, in one place.
        </p>
      </div>

      {/* 1099-K explainer bar */}
      <div className="mb-4.5 flex gap-2.5 items-start rounded-card border border-[#E1DFFA] bg-[#F4F3FE] p-[11px_14px] text-[12.5px] leading-relaxed text-[#3B3A6B]">
        <span className="flex-shrink-0 text-center w-[20px]">◯</span>
        <span className="flex-1">
          <b className="font-medium">About the 1099-K.</b> If you process more than the federal threshold, Stripe reports it to the IRS and sends you a copy. It shows what came in, not what you kept — your accountant will want the fees and refunds alongside it, which are in the statements.
        </span>
      </div>

      {/* Stripe embedded component for documents listing */}
      <StripeSurface surface="documents" />
    </div>
  );
}
