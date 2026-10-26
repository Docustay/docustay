// FieldPicker — search the merge fields, grouped by domain; insert one. Ported from
// webui/src/lib/components/FieldPicker.svelte (same copy; deprecated fields hidden).
import { useState } from "react";
import { Input } from "@/lib/components/ui/input.jsx";

// ★ F126/F128 (23 Oct 2026) — a person picking a field sees a plain label and an example value, nothing else: the developer notes (`why`, which
//   quote columns and migration numbers) and the raw key are no longer shown. Each field appears ONCE: deprecated fields and legacy aliases
//   (`aliasOf`, e.g. client.name for person.name) are left out, and a key or a label already listed is never listed again.
export function plainFields(fields = []) {
  const keys = new Set();
  const labels = new Set();
  const out = [];
  for (const f of fields) {
    if (!f?.name || f.deprecated || f.aliasOf) continue;
    const label = String(f.label ?? "").trim().toLowerCase();
    if (keys.has(f.name) || (label && labels.has(label))) continue;
    keys.add(f.name); if (label) labels.add(label);
    out.push(f);
  }
  return out;
}

// plain group names for the field keys' first part
const GROUP_NAMES = { person: "Person", client: "Person", practice: "Practice", org: "Organisation", booking: "Bookings", money: "Money", subscription: "Subscription", document: "This document", signer: "Signer", sender: "Sender", custom: "Your own fields", workbench: "Your plan" };

export default function FieldPicker({ fields = [], onInsert = null }) {
  const [searchTerm, setSearchTerm] = useState("");
  const term = searchTerm.trim().toLowerCase();
  const usable = plainFields(fields);
  const filtered = term ? usable.filter((f) => f.label?.toLowerCase().includes(term) || f.name?.toLowerCase().includes(term)) : usable;
  const grouped = {};
  for (const f of filtered) { const d = f.name?.split(".")[0] || "other"; (grouped[d] ||= []).push(f); }
  const domains = Object.keys(grouped).sort();
  const isEmpty = Boolean(term) && filtered.length === 0 && usable.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <Input type="text" placeholder="Search fields..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      {isEmpty ? (
        <div className="flex items-center justify-between rounded-control border border-line px-3 py-2">
          <p className="m-0 text-meta text-mute">No fields match "{searchTerm}"</p>
          <button type="button" className="text-meta text-brand" onClick={() => setSearchTerm("")}>Clear</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-meta text-mute"><p className="m-0">No fields available</p></div>
      ) : domains.map((d) => (
        <div key={d} className="flex flex-col gap-1">
          <div className="text-caption font-medium text-mute">{GROUP_NAMES[d] ?? (d.charAt(0).toUpperCase() + d.slice(1))}</div>
          {grouped[d].map((f) => (
            <button key={f.name} type="button" className="grid grid-cols-[1fr_auto] gap-x-3 rounded-sm px-2 py-1.5 text-left hover:bg-paper" onClick={() => onInsert?.(f.name)} data-testid={`field-picker-${f.name}`}>
              <span className="text-ui text-ink">{f.label}</span>
              {f.sample ? <span className="text-meta text-mute">e.g. {f.sample}</span> : <span />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
