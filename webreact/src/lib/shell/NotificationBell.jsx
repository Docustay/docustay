// The bell and its right-hand panel (R3.011, NotificationBell.svelte; NotificationPanel.frame.html).
// ★ The badge is the unread count from a real query, drawn ONLY when non-zero (a badge, not a cell).
// ★ Mark-read goes through the app store's performWrite (useWrite's non-hook path); for a viewer whose permissions
//   refuse it (F775 before the server fix) the store makes no optimistic change — the row stays honest.
// ★ The server's own error message and requestId, never a rewrite.
import { useState } from "react";
import { Bell } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/lib/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/lib/components/ui/tabs";
import { Skeleton } from "@/lib/components/ui/skeleton";
import { ICON_STROKE } from "@/lib/icons/stroke.js";
import { cn } from "@/lib/utils";

function dayLabel(key) {
  if (key === "Undated") return "Undated";
  if (key === new Date().toDateString()) return "Today";
  if (key === new Date(Date.now() - 86400000).toDateString()) return "Yesterday";
  return new Date(key).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
function groupByDay(list) {
  const groups = new Map();
  for (const n of list) {
    const when = n.created_at ? new Date(n.created_at) : null;
    const key = when && !Number.isNaN(when.valueOf()) ? when.toDateString() : "Undated";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  return [...groups.entries()].map(([key, items]) => ({ key, label: dayLabel(key), items }));
}

export default function NotificationBell({ unread = 0, notifications = null, loading = false, error = null, onOpen = null, onRead = null, onMarkAllRead = null, onFollow = null }) {
  const [open, setOpen] = useState(false);
  const [family, setFamily] = useState("all");
  const rows = Array.isArray(notifications) ? notifications : [];
  const inFamily = (n) => family === "all" || n.family === family;
  const unreadRows = rows.filter((n) => !n.read_at).filter(inFamily);
  const readRows = rows.filter((n) => n.read_at).filter(inFamily);
  const hasMoney = rows.some((n) => n.family === "money");
  const openChanged = (next) => { setOpen(next); if (next) onOpen?.(); };
  const follow = (n) => {
    if (!n.read_at) onRead?.(n.id);
    if (n.deep_link) { setOpen(false); onFollow?.(n.deep_link); }
  };
  const pill = (key, label, testId) => (
    <button type="button" key={key} data-testid={testId} onClick={() => setFamily(key)}
      className={cn("h-(--size-pill) rounded-pill border px-3 text-caption", family === key ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:bg-mute-bg")}>{label}</button>
  );
  const list = (items) => items.length === 0
    ? <p className="px-1 py-6 text-control text-mute" data-testid="bell-empty" role="status">Nothing yet — when something happens, it lands here first.</p>
    : groupByDay(items).map((g) => (
      <section key={g.key} className="mb-3" data-testid={`bell-day-${g.key}`}>
        <h3 className="m-0 px-1 pb-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">{g.label}</h3>
        <ul className="m-0 list-none p-0">
          {g.items.map((n) => (
            <li key={n.id}>
              <button type="button" className="flex w-full flex-col gap-0.5 rounded-control px-2.5 py-2 text-left hover:bg-mute-bg data-[unread=true]:bg-act-bg" data-testid={`bell-row-${n.id}`} data-unread={n.read_at ? undefined : "true"} onClick={() => follow(n)}>
                <span className="text-ui font-medium text-ink">{n.title ?? n.topic ?? "Notification"}</span>
                {n.body ? <span className="text-meta text-mute">{n.body}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
    ));

  return (
    <Sheet open={open} onOpenChange={openChanged}>
      <SheetTrigger className="relative grid size-8 place-items-center rounded-control border border-line text-ink-2 hover:bg-mute-bg" data-testid="notification-bell" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
        <Bell className="size-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
        <span className="sr-only">Notifications</span>
        {unread > 0 ? <span className="absolute top-1.5 right-1.5 size-1.5 rounded-pill bg-brand" data-testid="notification-bell-count" aria-label={`${unread} unread`}><span className="sr-only">{unread}</span></span> : null}
      </SheetTrigger>
      <SheetContent side="right" className="w-(--size-sheet) max-w-full gap-0 p-0" data-testid="notification-panel">
        <SheetHeader className="border-b border-hair px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="text-sheet-title">Notifications</SheetTitle>
            {unreadRows.length > 0 ? <button type="button" className="mr-8 text-control text-brand hover:underline" data-testid="notification-mark-all-read" onClick={() => onMarkAllRead?.()}>Mark all read</button> : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {pill("all", "All", "notification-filter-all")}{hasMoney ? pill("money", "Money", "notification-filter-money") : null}{pill("sessions", "Sessions", "notification-filter-sessions")}{pill("documents", "Documents", "notification-filter-documents")}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div data-testid="bell-loading" aria-busy="true"><Skeleton className="h-10 w-full" /><p className="text-control text-mute" role="status">Loading…</p></div>
          ) : error ? (
            <div className="text-control text-bad" data-testid="bell-error" role="alert">
              <p className="m-0">{error.message ?? String(error)}</p>
              {error.requestId ? <p className="m-0 text-caption text-mute">Reference: <code>{error.requestId}</code></p> : null}
            </div>
          ) : (
            <>
              <Tabs defaultValue="unread">
                <TabsList>
                  <TabsTrigger value="unread" data-testid="bell-tab-unread">Unread ({unreadRows.length})</TabsTrigger>
                  <TabsTrigger value="read" data-testid="bell-tab-read">Read ({readRows.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="unread" className="pt-3">{list(unreadRows)}</TabsContent>
                <TabsContent value="read" className="pt-3">{list(readRows)}</TabsContent>
              </Tabs>
              <div className="border-t border-hair pt-3"><a className="text-control text-brand no-underline hover:underline" href="/settings/notifications" data-testid="notification-settings-link">What gets sent, and how</a></div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
