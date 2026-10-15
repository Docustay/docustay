// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SettingsDomains.jsx — QUEUE §25.4. Own-domain signing links, for the platform and Docustay workspaces alike.
// The owner types an address (sign.yourpractice.com). We attach it; the screen shows the two DNS records to add at their registrar
// (or says we added them, for a domain we hold) and keeps checking until the address is live. Sign and verify links then use it.
// Props: { view: { domains, configured, automaticDns, limit }, onRefetch }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

const TONE = { live: ["Live", "ok"], pending: ["Waiting for DNS", "neutral"], verifying: ["Issuing the certificate", "neutral"], failed: ["Needs attention", "bad"] };

function Records({ records }) {
  const [copied, setCopied] = useState(null);
  const copy = async (v) => { try { await navigator.clipboard.writeText(v); setCopied(v); setTimeout(() => setCopied(null), 1500); } catch { /* the value is on screen to select */ } };
  if (!records?.length) return null;
  return (
    <div className="mt-3 overflow-auto rounded-card border border-line" data-testid="domain-records">
      <table className="w-full border-collapse text-ui">
        <thead><tr>{["Type", "Name", "Value", ""].map((h) => <th key={h} className="h-9 border-b border-line bg-surface-sunken px-3 py-0 text-left text-caption font-medium text-mute">{h}</th>)}</tr></thead>
        <tbody>{records.map((r) => (
          <tr key={`${r.type}-${r.name}`}>
            <td className="h-10 border-b border-line-soft px-3 py-0 font-medium">{r.type}</td>
            <td className="h-10 border-b border-line-soft px-3 py-0 break-all">{r.name}</td>
            <td className="h-10 border-b border-line-soft px-3 py-0 break-all">{r.value}</td>
            <td className="h-10 border-b border-line-soft px-3 py-0"><Button size="sm" variant="ghost" onClick={() => copy(r.value)}>{copied === r.value ? "Copied" : "Copy"}</Button></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function SettingsDomains({ view = null, onRefetch = null }) {
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const data = view ?? { domains: [], configured: false, automaticDns: false, limit: 0 };
  const waiting = data.domains.some((d) => d.status === "pending" || d.status === "verifying");
  // while any address is still waiting, look again every 10 seconds (the server re-checks it with the hosting provider)
  useEffect(() => { if (!waiting || !onRefetch) return undefined; const t = setInterval(() => onRefetch(), 10_000); return () => clearInterval(t); }, [waiting, onRefetch]);

  async function run(label, fn) {
    setProblem(null); setBusy(label);
    try { await fn(); onRefetch?.(); } catch (e) { setProblem(e instanceof ApiError || e?.message ? e.message : "That did not work. Try again."); } finally { setBusy(null); }
  }
  const add = (e) => { e.preventDefault(); if (!hostname.trim()) return; run("add", async () => { await api.addCustomDomain({ hostname: hostname.trim() }); setHostname(""); }); };

  return (
    <div className="mx-auto max-w-[860px] px-1" data-testid="settings-domains">
      <PageTitle>Domains</PageTitle>
      <p className="m-0 mt-1 text-body text-ink-2">Send signing and verification links from your own address, for example <span className="font-medium">sign.yourpractice.com</span>, instead of the default one. Your website keeps working: only the signing pages answer on this address.</p>
      {!data.configured && <p role="status" className="mt-4 rounded-card border border-line bg-surface p-3 text-body text-ink-2" data-testid="domains-not-configured">Own-domain links are not switched on for this install yet.</p>}
      {data.configured && (
        <form onSubmit={add} className="mt-5 flex flex-wrap items-center gap-2" data-testid="domain-add">
          <Input className="min-w-[260px] max-w-[380px]" placeholder="sign.yourpractice.com" value={hostname} onChange={(e) => setHostname(e.target.value)} aria-label="Address" data-testid="domain-hostname" />
          <Button type="submit" disabled={busy === "add" || !hostname.trim()} data-testid="domain-add-button">{busy === "add" ? "Adding…" : "Add address"}</Button>
        </form>
      )}
      {problem && <p role="alert" className="mt-3 text-body text-bad" data-testid="domain-problem">{problem}</p>}
      <div className="mt-6 space-y-4" data-testid="domain-list">
        {data.domains.length === 0 && data.configured && <p className="text-body text-mute" data-testid="domains-empty">No address yet. Your links use the default address.</p>}
        {data.domains.map((d) => {
          const [label, tone] = TONE[d.status] ?? [d.status, "neutral"];
          return (
            <section key={d.id} className="rounded-card border border-line bg-surface p-4" data-testid="domain-row" data-status={d.status}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-body font-medium break-all">{d.hostname}</span>
                <StatusBadge label={label} tone={tone} />
                <span className="flex-1" />
                {d.status !== "live" && <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => run(d.id, () => api.checkCustomDomain({ id: d.id }))} data-testid="domain-check">Check now</Button>}
                <Button size="sm" variant="ghost" disabled={busy === `rm${d.id}`} onClick={() => run(`rm${d.id}`, () => api.removeCustomDomain({ id: d.id }))} data-testid="domain-remove">Remove</Button>
              </div>
              {d.status === "live" && <p className="m-0 mt-2 text-meta text-mute">Signing and verification links are sent from this address.</p>}
              {d.status !== "live" && d.dnsMode === "porkbun" && <p className="m-0 mt-2 text-meta text-mute" data-testid="domain-auto">We added the records below to your DNS for you. It can take a few minutes to take effect.</p>}
              {d.status !== "live" && d.dnsMode !== "porkbun" && <p className="m-0 mt-2 text-meta text-mute" data-testid="domain-manual">Add these two records where you manage your domain (your registrar or DNS provider). This page keeps checking and turns Live when they are in place.</p>}
              {d.lastError && <p className="m-0 mt-2 text-meta text-bad" data-testid="domain-error">{d.lastError}</p>}
              {d.status !== "live" && <Records records={d.records} />}
            </section>
          );
        })}
      </div>
      {data.configured && <p className="mt-6 text-caption text-mute">Up to 3 addresses per workspace. Hosting allows {data.limit} in total across all workspaces.</p>}
    </div>
  );
}
