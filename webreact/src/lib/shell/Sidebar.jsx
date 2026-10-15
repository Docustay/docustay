// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SIDEBAR (R3.015) — ported from webui/src/lib/shell/Sidebar.svelte; layout from SidebarV2.frame.html.
// ★★★ The nav is DATA: it walks the tree /api/nav sent, already authorised server-side. No copy of it here.
// ★★ Three levels (14 grandchildren). A level-2 row whose key is `cat-*` is a GROUP: drawn as the frame's
//    uppercase heading with its children always listed (Ruling, 27 Sep — the frame is the the maintainer-ruled design).
// ★ Accordion: one branch open per level, siblings only; a closed sibling is an explicit `false`, never deleted,
//   or the section holding the active row could never close. Filtering opens every branch holding a match.
// ★ `findTrail` is exported beside the component — the gate contract imports { Sidebar, findTrail }.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { House, Users, UserCog, Building2, Share2, CalendarDays, Tag, FileText, DollarSign, Workflow, SquareCheck, ChartColumn, Settings, Server, Sparkles, TrendingUp } from "lucide-react";
import { filterNav } from "@/lib/shell/navFilter.mjs";
import NavSearch from "./NavSearch.jsx";
import NavRow from "./NavRow.jsx";

/** The ancestor keys of `path`, walking the real tree rather than parsing the URL. */
export function findTrail(sections, path) {
  for (const s of sections ?? []) {
    if (s.path === path) return [s.key];
    for (const c of s.children ?? []) {
      if (c.path === path) return [s.key, c.key];
      for (const g of c.children ?? []) if (g.path === path) return [s.key, c.key, g.key];
    }
  }
  return [];
}

// ★ One icon per section, keyed by path. `/run` and `/whats-new` are sections the Svelte map predates.
// ★ the maintainer, 1 Oct 2026 — `/people/team` was missing entirely (Team was promoted to its own top-level
//   section on 1 Oct 2026, src/nav/sections.mjs, and never got an icon row here): every other
//   section rendered one, Team rendered none. [FOUND LIVE] the maintainer: "there is not icon next to the Team
//   title on the tab." `UserCog` (vs. Clients' plain `Users`) reads as "the people who work here".
const SECTION_ICONS = Object.freeze({
  "/home": House, "/people": Users, "/people/team": UserCog, "/accounts": Building2, "/network": Share2,
  "/engagements": CalendarDays, "/items": Tag, "/documents": FileText, "/money": DollarSign,
  "/growth": TrendingUp, "/run": Workflow, "/tasks": SquareCheck, "/reports": ChartColumn,
  "/settings": Settings, "/platform": Server, "/whats-new": Sparkles,
});

const isGroup = (row) => typeof row.key === "string" && row.key.startsWith("cat-");

export default function Sidebar({ nav = [], activePath = "/", stateFor, counts = {}, onNavigate = null, onSearchEverything = null, forceOpen = false, collapsed = false, onToggleCollapse = null, header = null, footer = null }) {
  const trail = findTrail(nav, activePath);
  const [query, setQuery] = useState("");
  const filtered = filterNav(nav, query);
  const shown = filtered.sections;
  const [manuallyOpen, setManuallyOpen] = useState({});

  const isOpen = (key) => (forceOpen ? true : filtered.openKeys.includes(key) ? true : (manuallyOpen[key] ?? trail.includes(key)));
  const siblingsOf = (key) => {
    if (shown.some((s) => s.key === key)) return shown.map((s) => s.key);
    for (const s of shown) { const kids = s.children ?? []; if (kids.some((c) => c.key === key)) return kids.map((c) => c.key); }
    return [key];
  };
  const toggle = (key) => {
    const opening = !isOpen(key);
    const next = { ...manuallyOpen };
    if (opening) for (const sib of siblingsOf(key)) next[sib] = false;
    next[key] = opening;
    setManuallyOpen(next);
  };
  const leaf = (row, level) => (
    <li key={row.key}>
      <NavRow row={row} level={level} open={false} hasKids={false} active={activePath === row.path} inTrail={trail.includes(row.key)} stateFor={stateFor} count={counts[row.path]} onNavigate={onNavigate} />
    </li>
  );

  return (
    <nav className="flex h-full w-(--size-sidebar) shrink-0 flex-col border-r border-line bg-surface" aria-label="Sections" data-testid="sidebar" data-collapsed={collapsed ? "true" : undefined}>
      {onToggleCollapse ? <button type="button" className="sr-only" data-testid="sidebar-collapse-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={() => onToggleCollapse?.()} /> : null}
      {header ? <div className="shrink-0 border-b border-hair px-3.5 pt-3.5 pb-2.5" data-testid="sidebar-header">{header(collapsed)}</div> : null}
      {!collapsed ? (
        <NavSearch value={query} onChange={setQuery} matchCount={filtered.matchCount} onEscalate={onSearchEverything}
          onEnter={() => { if (filtered.firstMatch?.path) onNavigate?.(filtered.firstMatch.path); }} />
      ) : null}
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-2 py-1" data-filtering={filtered.filtering ? "true" : undefined} data-matches={filtered.matchCount ?? undefined}>
        {shown.map((section) => {
          const kids = section.children ?? [];
          const open = kids.length > 0 && isOpen(section.key);
          return (
            <li key={section.key}>
              <NavRow row={section} level={1} open={open} hasKids={kids.length > 0} active={activePath === section.path} inTrail={trail.includes(section.key)}
                icon={SECTION_ICONS[section.path] ?? null} stateFor={stateFor} count={counts[section.path]} onToggle={() => toggle(section.key)} onNavigate={onNavigate} />
              {open ? (
                <ul className="m-0 list-none pt-px pb-1.25 pl-7.25">
                  {kids.map((child) => {
                    const grandkids = child.children ?? [];
                    if (isGroup(child)) {
                      return (
                        <li key={child.key} data-group={child.key}>
                          <div className="px-2.5 pt-2.25 pb-0.75 text-micro font-semibold tracking-[0.08em] text-mute uppercase" data-path={child.path}>{child.label}</div>
                          <ul className="m-0 list-none p-0">{grandkids.map((g) => leaf(g, 3))}</ul>
                        </li>
                      );
                    }
                    const childOpen = grandkids.length > 0 && isOpen(child.key);
                    return (
                      <li key={child.key}>
                        <NavRow row={child} level={2} open={childOpen} hasKids={grandkids.length > 0} active={activePath === child.path} inTrail={trail.includes(child.key)}
                          stateFor={stateFor} count={counts[child.path]} onToggle={() => toggle(child.key)} onNavigate={onNavigate} />
                        {childOpen ? <ul className="m-0 list-none pl-3">{grandkids.map((g) => leaf(g, 3))}</ul> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {footer ? <div className="shrink-0 border-t border-hair px-3 pt-2.5 pb-3" data-testid="sidebar-footer">{footer(collapsed)}</div> : null}
    </nav>
  );
}
