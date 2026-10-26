// The sidebar's one field: filter the nav, or escalate to the command surface (R3.010, NavSearch.svelte).
// ★ Zero matches says so and offers "Search everything for …" — never a silent empty sidebar.
import { Search } from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/stroke.js";

export default function NavSearch({ value = "", onChange = null, onEnter = null, onEscalate = null, matchCount = null }) {
  const keydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (matchCount === 0) onEscalate?.(value); else onEnter?.(); }
    if (e.key === "Escape") { e.preventDefault(); onChange?.(""); }
  };
  return (
    <div className="mx-3 mt-2.75 mb-1.5" data-testid="nav-search">
      <label className="sr-only" htmlFor="ks-nav-search-input">Search</label>
      <div className="flex h-(--size-filter) items-center gap-2 rounded-control border border-line bg-surface px-2.5 focus-within:border-brand">
        <Search className="size-4 shrink-0 text-placeholder" strokeWidth={ICON_STROKE} aria-hidden="true" />
        <input
          id="ks-nav-search-input"
          data-testid="nav-search-input"
          type="search"
          value={value}
          placeholder="Search or jump to…"
          autoComplete="off"
          onChange={(e) => onChange?.(e.currentTarget.value)}
          onKeyDown={keydown}
          className="min-w-0 flex-1 bg-transparent text-control text-ink outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="rounded-sm border border-line px-1.25 text-micro font-medium text-placeholder" aria-hidden="true">⌘K</kbd>
      </div>
      {matchCount === 0 ? (
        <p className="mt-2 px-1 text-caption text-mute" data-testid="nav-search-empty" role="status">
          No sections match “{value}”.
          {onEscalate ? <button type="button" className="mt-1 block text-brand hover:underline" data-testid="nav-search-escalate" onClick={() => onEscalate(value)}>Search everything for “{value}”</button> : null}
        </p>
      ) : null}
    </div>
  );
}
