// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Combobox — type to narrow a list, pick one. Ported from webui/src/lib/components/ui/combobox (bits-ui)
// onto Radix Popover + cmdk (no second primitive library — the registry's combobox is Base UI, rejected).
// Same props (value was $bindable → value + onValueChange, both honoured), same testids:
//   `${testId}` on the INPUT (tests type into it), `${testId}-trigger`, `${testId}-option-${value}`,
//   `${testId}-empty`; same copy ("Search…", "No matches.", "No match for “…”.").
// ★ The selected item carries data-checked="true" — command.jsx's check mark keys off it.
//
// ★★★ the maintainer, 29 Sep 2026 — `multiple` ADDED, EVERY EXISTING CALLER UNCHANGED. Off (the default), this
//     is byte-for-byte the single-select component above. On: `value`/`onValueChange` carry an
//     ARRAY, picking an option TOGGLES it and keeps the popover open (there is always another pick
//     to make), and the anchor renders each selection as a removable chip — shadcn's own
//     "multi-select combobox" recipe, built on the exact same Popover+cmdk primitives already
//     imported here rather than a second library.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/lib/components/ui/popover.jsx";
import { Command, CommandList, CommandItem } from "@/lib/components/ui/command.jsx";
import { useBindable } from "@/lib/hooks/useBindable.js";

export default function Combobox({ value, options = [], placeholder = "Search…", emptyText = "No matches.", id = undefined, testId = undefined, disabled = false, onValueChange = null, onInputChange = null, multiple = false }) {
  const [val, setVal] = useBindable(value, undefined, multiple ? [] : "");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const labelOf = (v) => options.find((o) => o.value === v)?.label ?? "";
  const q = search.trim().toLowerCase();
  const shown = q ? options.filter((o) => String(o.label).toLowerCase().includes(q)) : options;
  const choose = (v) => { setVal(v); onValueChange?.(v); setOpen(false); setSearch(""); };

  const selectedValues = multiple ? (Array.isArray(val) ? val : []) : [];
  const toggle = (v) => {
    const next = selectedValues.includes(v)
      ? selectedValues.filter((x) => x !== v)
      : [...selectedValues, v];
    setVal(next);
    onValueChange?.(next);
    setSearch("");
  };
  const remove = (v) => {
    const next = selectedValues.filter((x) => x !== v);
    setVal(next);
    onValueChange?.(next);
  };

  if (multiple) {
    return (
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
        <PopoverAnchor asChild>
          <div className="flex min-h-(--size-control-field) flex-wrap items-center gap-1.5 rounded-control border border-line bg-surface px-2 py-1.5 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand-soft data-[disabled=true]:opacity-60" data-disabled={disabled ? "true" : undefined}>
            {selectedValues.map((v) => (
              <span key={v} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-meta font-medium text-brand" data-testid={testId ? `${testId}-chip-${v}` : undefined}>
                {labelOf(v) || v}
                {!disabled && (
                  <button type="button" className="text-brand/70 hover:text-brand" aria-label={`Remove ${labelOf(v) || v}`} onClick={() => remove(v)}>
                    <X className="size-3" strokeWidth={2.5} aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
            <input id={id} data-testid={testId} className="h-6 min-w-16 flex-1 bg-transparent px-1 text-field text-ink outline-none" placeholder={selectedValues.length ? "" : placeholder} aria-label={placeholder}
                   role="combobox" aria-expanded={open} disabled={disabled}
                   value={search} onChange={(e) => { const v = e.target.value; setSearch(v); onInputChange?.(v); setOpen(true); }} onFocus={() => setOpen(true)} />
          </div>
        </PopoverAnchor>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-60 p-0" sideOffset={4} align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Command shouldFilter={false}>
            <CommandList>
              {shown.length === 0 ? (
                <p className="m-0 px-3 py-2.5 text-meta text-mute" data-testid={testId ? `${testId}-empty` : undefined}>{options.length === 0 ? emptyText : `No match for “${search}”.`}</p>
              ) : shown.map((o) => (
                <CommandItem key={o.value} value={String(o.value)} data-checked={selectedValues.includes(o.value) ? "true" : undefined} data-testid={testId ? `${testId}-option-${o.value}` : undefined} onSelect={() => toggle(o.value)}>{o.label}</CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverAnchor asChild>
        <div className="flex h-(--size-control-field) items-center rounded-control border border-line bg-surface focus-within:border-brand focus-within:ring-3 focus-within:ring-brand-soft data-[disabled=true]:opacity-60" data-disabled={disabled ? "true" : undefined}>
          <input id={id} data-testid={testId} className="h-full min-w-0 flex-1 bg-transparent px-3 text-field text-ink outline-none" placeholder={placeholder} aria-label={placeholder}
                 role="combobox" aria-expanded={open} disabled={disabled}
                 value={open ? search : labelOf(val)} onChange={(e) => { const v = e.target.value; setSearch(v); onInputChange?.(v); setOpen(true); }} onFocus={() => setOpen(true)} />
          <button type="button" className="px-3 text-mute" data-testid={testId ? `${testId}-trigger` : undefined} aria-label="Show all options" disabled={disabled} onClick={() => setOpen((o) => !o)}>▾</button>
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-60 p-0" sideOffset={4} align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Command shouldFilter={false}>
          <CommandList>
            {shown.length === 0 ? (
              <p className="m-0 px-3 py-2.5 text-meta text-mute" data-testid={testId ? `${testId}-empty` : undefined}>{options.length === 0 ? emptyText : `No match for “${search}”.`}</p>
            ) : shown.map((o) => (
              <CommandItem key={o.value} value={String(o.value)} data-checked={val === o.value ? "true" : undefined} data-testid={testId ? `${testId}-option-${o.value}` : undefined} onSelect={() => choose(o.value)}>{o.label}</CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
