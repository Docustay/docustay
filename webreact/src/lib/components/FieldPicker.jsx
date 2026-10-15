// FieldPicker — search the merge fields, grouped by domain; insert one. Ported from
// webui/src/lib/components/FieldPicker.svelte (same copy; deprecated fields hidden).
import { useState } from "react";
import { Input } from "@/lib/components/ui/input.jsx";

export default function FieldPicker({ fields = [], onInsert = null }) {
  const [searchTerm, setSearchTerm] = useState("");
  const term = searchTerm.trim().toLowerCase();
  const filtered = term ? fields.filter((f) => f.label?.toLowerCase().includes(term) || f.name?.toLowerCase().includes(term)) : fields;
  const grouped = {};
  for (const f of filtered) { if (f.deprecated) continue; const d = f.name?.split(".")[0] || "other"; (grouped[d] ||= []).push(f); }
  const domains = Object.keys(grouped).sort();
  const isEmpty = filtered.length > 0 && domains.length === 0;
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
          <div className="text-caption font-medium text-mute">{d.toUpperCase()}</div>
          {grouped[d].map((f) => (
            <button key={f.name} type="button" className="grid grid-cols-[1fr_auto] gap-x-3 rounded-sm px-2 py-1.5 text-left hover:bg-paper" title={f.why} onClick={() => onInsert?.(f.name)}>
              <span className="text-ui text-ink">{f.label}</span>
              <span className="text-meta text-mute">{f.sample}</span>
              <span className="col-span-2 font-mono text-micro text-faint">{f.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
