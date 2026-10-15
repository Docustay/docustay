// Part 29b item 4 — Docustay's own subscriptions / invoices / payments (Stripe's mirror), tagged "Docustay", at the top of the matching Money list. READ-ONLY, and only for the people named in
// `platform.docustay_viewers`: anyone else gets a 403 from the server and sees no band at all.
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import { formatDate, formatMoney } from "@/lib/screens/money/formatMoney.js";

let cache = null;
const load = () => (cache ??= request("/api/product/docustay/money").catch(() => null));

const COLS = {
  subscriptions: { key: "subscriptions", title: "Docustay subscriptions", cells: (r) => [r.workspace_name, r.status + (r.cancel_at_period_end ? " · ends at period end" : ""), r.billing_interval ? `${r.billing_interval}ly` : "", r.founders_price ? "founders' price" : "", `renews ${formatDate(r.current_period_end)}`] },
  invoices: { key: "invoices", title: "Docustay invoices", cells: (r) => [r.workspace_name, r.number ?? "", r.status, formatMoney(r.amount_minor, r.currency), formatDate(r.created_at)] },
  payments: { key: "payments", title: "Docustay payments", cells: (r) => [r.workspace_name, r.status, formatMoney(r.amount_minor, r.currency), r.card_brand ? `${r.card_brand} ${r.card_last_four ?? ""}` : "", formatDate(r.created_at)] },
};

export default function DocustayMoneyBand({ kind }) {
  const [rows, setRows] = useState(null), [fee, setFee] = useState(null);
  useEffect(() => { let live = true; load().then((r) => { if (live && r) { setRows(r[kind] ?? []); setFee(r.platformFee ?? null); } }); return () => { live = false; }; }, [kind]);
  const spec = COLS[kind];
  const feeLine = kind === "payments" && fee && fee.byCurrency?.length ? fee.byCurrency.map((f) => `${formatMoney(f.netMinor, f.currency)} from ${f.payments} payment${f.payments === 1 ? "" : "s"}`).join(" · ") : null;
  if (!spec || !rows || (rows.length === 0 && !feeLine)) return null;
  return (
    <section className="mb-4 rounded-lg border border-line bg-surface" data-testid={`docustay-money-${kind}`} aria-label={spec.title}>
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2"><span className="rounded-pill bg-brand-soft px-2 py-0.5 text-caption font-medium text-brand" data-testid="docustay-tag">Docustay</span><span className="text-sm font-medium">{spec.title.replace("Docustay ", "")}</span><span className="text-sm text-ink-3">· read-only</span></div>
      {feeLine ? <p className="border-b border-line-soft px-4 py-2 text-sm" data-testid="docustay-platform-fee">Platform fee this month ({fee.month}): <strong>{feeLine}</strong></p> : null}
      <table className="w-full text-sm"><tbody>{rows.slice(0, 10).map((r, i) => <tr key={i} className="border-b border-line-soft last:border-0">{spec.cells(r).map((c, j) => <td key={j} className="h-10 px-4">{c}</td>)}</tr>)}</tbody></table>
    </section>
  );
}
