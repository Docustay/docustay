// ⌘K — search people, documents, invoices, or jump to a screen (R3.007, CommandSurface.svelte).
// ★ Destinations come from the AUTHORISED tree (nav.sections) with the sidebar's own build state, so the palette
//   can never offer a screen the sidebar would not. Create actions appear only where their screen is reachable.
// ★ Record search is the server's (/api/search), debounced; its failure shows the server's message, never "no match".
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/lib/components/ui/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/lib/components/ui/command";
import { api, ApiError } from "@/lib/api.js";
import { useBindableOpen } from "@/lib/hooks/useBindableOpen.js";
import { labelMatches } from "@/lib/shell/navFilter.mjs";
import { isNavigable, isFullyBuilt, badgeFor } from "@/lib/shell/navState.mjs";

const RECENTS_KEY = "ks-command-recents";
const loadRecents = () => { try { const l = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]"); return Array.isArray(l) ? l.slice(0, 5) : []; } catch { return []; } };
const pushRecent = (entry) => { try { const l = loadRecents().filter((r) => r.path !== entry.path); l.unshift(entry); localStorage.setItem(RECENTS_KEY, JSON.stringify(l.slice(0, 5))); } catch { /* storage blocked */ } };
const Trail = ({ children }) => <span className="ml-auto truncate text-caption text-mute">{children}</span>;

export default function CommandSurface({ nav = [], stateFor = null, open: openProp = false, onOpenChange = null, onNavigate = null, initialQuery = "", path = "", onCreateSession = null }) {
  const [open, setOpen] = useBindableOpen(openProp, onOpenChange);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [recents, setRecents] = useState([]);

  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(!open); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  useEffect(() => { if (open) { setRecents(loadRecents()); setQuery(initialQuery ?? ""); } }, [open, initialQuery]);
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) { setResults(null); setSearchError(null); setSearching(false); return undefined; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try { const data = await api.search(q); if (live) { setResults(data?.results ?? []); setSearchError(null); } }
      catch (err) { if (live) { setResults(null); setSearchError(err instanceof ApiError ? err : new Error(String(err))); } }
      finally { if (live) setSearching(false); }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [query, open]);

  const findNavRow = (p) => {
    for (const s of nav ?? []) { if (s.path === p) return s; for (const c of s.children ?? []) { if (c.path === p) return c; for (const g of c.children ?? []) if (g.path === p) return g; } }
    return null;
  };
  const navAllows = (p) => { const row = findNavRow(p); if (!row) return false; const b = stateFor ? stateFor(row.path) : null; return b ? isNavigable(b) : true; };
  const go = (target, recent) => { if (!target) return; setOpen(false); if (recent) pushRecent(recent); onNavigate?.(target); };

  const createActions = [
    navAllows("/people/clients") && { id: "create-client", label: "New client", run: () => go("/people/clients?new=1") },
    onCreateSession && { id: "create-session", label: "New session", run: () => { setOpen(false); onCreateSession(); } },
    navAllows("/money/invoices") && { id: "create-invoice", label: "New invoice", run: () => go("/money/invoices?new=1") },
  ].filter(Boolean).filter((a) => labelMatches({ label: a.label }, query));
  const recordMatch = /^\/record\/([a-z]+)\/([^/]+)$/.exec(path ?? "");
  const recordActions = recordMatch && recordMatch[1] === "person" && navAllows("/money/invoices")
    ? [{ id: "invoice-this-person", label: "New invoice for this person", run: () => go(`/money/invoices?new=1&for=${encodeURIComponent(recordMatch[2])}`) }].filter((a) => labelMatches({ label: a.label }, query))
    : [];
  const destinations = [];
  for (const s of nav ?? []) {
    const push = (row, trail) => {
      if (!row?.path || !labelMatches(row, query)) return;
      const b = stateFor ? stateFor(row.path) : null;
      destinations.push({ path: row.path, label: row.label, trail, navigable: b ? isNavigable(b) : true, partial: b ? !isFullyBuilt(b) : false, badge: b ? badgeFor(b) : null });
    };
    push(s, null);
    for (const c of s.children ?? []) { push(c, s.label); for (const g of c.children ?? []) push(g, `${s.label} › ${c.label}`); }
  }
  const recentItems = query.trim() ? [] : recents;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-1/3 max-w-(--size-modal-wide) translate-y-0 gap-0 overflow-hidden rounded-modal p-0" showCloseButton={false} data-testid="command-palette">
        <DialogTitle className="sr-only">Search and jump to</DialogTitle>
        <DialogDescription className="sr-only">Search records or jump to a screen</DialogDescription>
        <Command shouldFilter={false} label="Search and jump to">
          <CommandInput placeholder="Search people, documents, invoices — or jump to a screen" data-testid="command-input" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-96" data-testid="command-list">
            <CommandEmpty data-testid="command-empty">No screens or records match “{query}”.</CommandEmpty>
            {recentItems.length ? (
              <CommandGroup heading="Recent">
                {recentItems.map((r) => <CommandItem key={r.path} value={`recent ${r.label} ${r.path}`} data-testid={`command-recent-${r.path}`} onSelect={() => go(r.path, { path: r.path, label: r.label, trail: r.trail ?? null })}><span>{r.label}</span>{r.trail ? <Trail>{r.trail}</Trail> : null}</CommandItem>)}
              </CommandGroup>
            ) : null}
            {recordActions.length ? <CommandGroup heading="This record">{recordActions.map((a) => <CommandItem key={a.id} value={`${a.label} ${a.id}`} data-testid={`command-${a.id}`} onSelect={() => a.run()}>{a.label}</CommandItem>)}</CommandGroup> : null}
            {createActions.length ? <CommandGroup heading="Create">{createActions.map((a) => <CommandItem key={a.id} value={`new ${a.label} ${a.id}`} data-testid={`command-${a.id}`} onSelect={() => a.run()}>{a.label}</CommandItem>)}</CommandGroup> : null}
            {destinations.length ? (
              <CommandGroup heading="Go to">
                {destinations.map((d) => (
                  <CommandItem key={d.path} value={`${d.trail ?? ""} ${d.label} ${d.path}`} data-testid={`command-nav-${d.path}`} data-navigable={d.navigable ? "true" : undefined} disabled={!d.navigable}
                    onSelect={() => d.navigable && go(d.path, { path: d.path, label: d.label, trail: d.trail ?? null })}>
                    <span>{d.label}</span>{d.trail ? <Trail>{d.trail}</Trail> : null}
                    {d.badge ? <span className="text-micro text-mute">{d.badge}</span> : d.partial ? <span className="text-micro text-mute">Unfinished</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {searchError ? (
              <div className="px-3 py-2 text-control text-bad" data-testid="command-error" role="alert"><p className="m-0">{searchError.message}</p>{searchError.requestId ? <p className="m-0 text-caption text-mute">Reference: <code>{searchError.requestId}</code></p> : null}</div>
            ) : searching ? (
              <p className="m-0 px-3 py-2 text-control text-mute" data-testid="command-searching" role="status">Searching…</p>
            ) : results?.length ? (
              <CommandGroup heading="Records">
                {results.map((r) => {
                  const rPath = r.path ?? (r.type && r.id ? `/record/${r.type}/${r.id}` : null);
                  return (
                    <CommandItem key={r.id ?? `${r.type}-${r.path}`} value={`${r.title ?? ""} ${r.subtitle ?? ""}`} data-testid={`command-record-${r.id ?? r.path}`}
                      onSelect={() => go(rPath, rPath ? { path: rPath, label: r.title ?? r.label ?? "Untitled", trail: r.subtitle ?? null } : null)}>
                      <span>{r.title ?? r.label ?? "Untitled"}</span>{r.subtitle ? <Trail>{r.subtitle}</Trail> : null}
                      {r.type ? <span className="rounded-chip bg-mute-bg px-2 text-micro text-mute">{r.type}</span> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="flex items-center gap-4 border-t border-hair px-3 py-2 text-caption text-mute" data-testid="command-shortcuts">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span><span className="ml-auto"><kbd>⌘</kbd><kbd>K</kbd> open</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
