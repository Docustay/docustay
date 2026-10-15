// One row of the sidebar (R3.009). Ported from webui/src/lib/shell/NavRow.svelte; layout from SidebarV2.frame.html.
// ★ Labels only — no counts, no "not built" badges (the maintainer, 16 Sep 2026). `count` is accepted and unused, as in Svelte.
// ★ An unbuilt row is a link that goes nowhere on purpose (aria-disabled); a row with children toggles.
import { useEffect } from "react";
import { isNavigable } from "@/lib/shell/navState.mjs";
import { ICON_STROKE } from "@/lib/icons/stroke.js";
import { cn } from "@/lib/utils";

export default function NavRow({ row, level, open = false, hasKids = false, active = false, inTrail = false, stateFor, count, onToggle = null, onNavigate = null, icon = null }) {
  void count;
  const built = stateFor(row.path);
  const unbuilt = !isNavigable(built);
  const Glyph = icon;

  useEffect(() => {
    if (!row.label || String(row.label).trim() === "") {
      throw new Error(`nav row "${row.key ?? row.path}" has an EMPTY LABEL. U30: every row renders a non-empty label.`);
    }
  }, [row.label, row.key, row.path]);

  const click = (e) => {
    if (unbuilt) { e.preventDefault(); return; }
    if (hasKids && onToggle) { e.preventDefault(); onToggle(); return; }
    if (onNavigate) { e.preventDefault(); onNavigate(row.path); }
  };

  const top = level === 1;
  return (
    <div
      className={cn("group flex items-center", top ? "h-(--size-nav-row)" : "h-(--size-sub-row)")}
      data-level={level}
      data-active={active ? "true" : undefined}
      data-in-trail={inTrail ? "true" : undefined}
      data-build-state={built.state}
      data-path={row.path}
    >
      {hasKids
        ? <button type="button" className="sr-only" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${row.label}`} onClick={onToggle}>{open ? "▾" : "▸"}</button>
        : null}
      <a
        href={row.path}
        onClick={click}
        title={row.label}
        aria-label={row.label}
        aria-current={active ? "page" : undefined}
        aria-disabled={unbuilt ? "true" : undefined}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center rounded-control no-underline transition-colors duration-(--motion-fast)",
          top ? "gap-2.75 px-2.5 text-ui text-ink-2 hover:bg-mute-bg" : "px-2.5 text-control text-ink-2 hover:text-ink",
          top && (active || (inTrail && !open)) && "bg-brand-soft font-medium text-brand",
          !top && (active || inTrail) && "font-medium text-brand",
          unbuilt && "cursor-default text-faint hover:bg-transparent",
        )}
      >
        {/* ★ the maintainer, 29 Sep 2026 — design-critique fix (Square comparison). Inactive icons were
            text-faint (#9AA0AC), a pale gray that all but disappears against a white sidebar; the
            label right next to it is text-ink-2 (#41454F), noticeably darker — the icon and its own
            label didn't match. text-ink-2 for both gives every row real visual weight at rest,
            matching Square's confident dark-icon treatment; the active row's brand purple is
            unchanged. size-4 (16px) -> size-4.5 (18px) — Square's icons read larger too. */}
        {top && Glyph ? <Glyph className={cn("size-4.5 shrink-0", active || inTrail ? "text-brand" : "text-ink-2")} strokeWidth={ICON_STROKE} aria-hidden="true" /> : null}
        <span className="truncate">{row.label}</span>
        {top && hasKids ? <span className={cn("ml-auto text-micro text-chevron transition-transform duration-(--motion-fast)", open && "rotate-180")} aria-hidden="true">⌄</span> : null}
      </a>
    </div>
  );
}
