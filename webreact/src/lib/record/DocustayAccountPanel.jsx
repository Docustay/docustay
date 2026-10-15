// Part 29b item 4 — the Docustay panel on an Accounts record. READ-ONLY. Shown only when the account is a Docustay customer / self-hosted install AND the signed-in person is named in `platform.docustay_viewers`
// (the server answers 403 to anyone else; this component then renders nothing at all).
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import { formatDate } from "@/lib/screens/money/formatMoney.js";

const Row = ({ label, children }) => <div className="flex gap-3 py-1 text-sm"><dt className="w-36 shrink-0 text-ink-3">{label}</dt><dd className="min-w-0 text-ink">{children}</dd></div>;

export default function DocustayAccountPanel({ accountId, accountType = null }) {
  const [panel, setPanel] = useState(null);
  const [open, setOpen] = useState(true);
  const looksDocustay = /docustay/i.test(String(accountType ?? ""));
  useEffect(() => {
    if (!accountId || !looksDocustay) return;
    let live = true;
    request(`/api/product/docustay/accounts/${encodeURIComponent(accountId)}`).then((r) => { if (live && r?.docustay) setPanel(r); }).catch(() => {});
    return () => { live = false; };
  }, [accountId, looksDocustay]);
  if (!panel) return null;
  return (
    <div className="relative">
    <button type="button" className="rounded-pill bg-brand-soft px-3 py-1 text-sm font-medium text-brand" data-testid="docustay-tag" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Docustay {open ? "▴" : "▾"}</button>
    {open && <section className="absolute right-0 top-full z-20 mt-2 w-[22rem] rounded-lg border border-line bg-surface p-4 shadow-lg" data-testid="docustay-panel" aria-label="Docustay">
      <div className="mb-2 text-sm text-ink-3">{panel.kind === "hosted" ? "Hosted workspace" : "Self-hosted install"} · read-only</div>
      {panel.missing ? <p className="text-sm text-ink-3">The workspace behind this account is no longer listed.</p> : panel.kind === "hosted" ? (
        <dl>
          <Row label="Plan">{panel.plan}{panel.interval ? ` (${panel.interval}ly)` : ""}</Row>
          <Row label="Status">{panel.status ?? "no subscription"}{panel.paymentProblem ? " · payment problem" : ""}</Row>
          <Row label="Renews">{panel.renewsAt ? formatDate(panel.renewsAt) : "—"}</Row>
          <Row label="Founders' price">{panel.founders ? "Yes" : "No"}</Row>
          <Row label="People">{panel.people ?? "—"}</Row>
          <Row label="Owner">{panel.owner?.name ?? "—"}{panel.owner?.email ? ` · ${panel.owner.email}` : ""}</Row>
        </dl>
      ) : (
        <dl>
          <Row label="Licence">{panel.pro ? "Pro" : "Free"}</Row>
          <Row label="Version">{panel.version ?? "?"}</Row>
          <Row label="Last seen">{panel.lastSeenAt ? formatDate(panel.lastSeenAt) : "—"}</Row>
          <Row label="Users">{panel.counts?.users ?? "?"}</Row>
          <Row label="Documents this month">{panel.counts?.documentsSentThisMonth ?? "?"}</Row>
        </dl>
      )}
    </section>}
    </div>
  );
}
