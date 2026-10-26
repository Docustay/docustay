// Which practice you are in, and which you could switch to (R3.016, TenantSwitcher.svelte).
// ★★★ `tenant` (from /api/nav) is the NAME; `practices` fills the MENU. The name never waits for the menu (F460).
// ★ One practice → no control at all. The practice you are already in is not a clickable option.
import { Check, ChevronDown } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/lib/components/ui/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/lib/components/ui/dropdown-menu";

const Mark = ({ current, initials }) => (
  <Avatar className="size-(--size-avatar) shrink-0 rounded-sm bg-avatar-bg text-avatar-ink">
    {current.logoUrl ? <AvatarImage src={current.logoUrl} alt="" /> : null}
    <AvatarFallback className="rounded-sm bg-avatar-bg text-caption font-semibold text-avatar-ink">{initials}</AvatarFallback>
  </Avatar>
);

export default function TenantSwitcher({ practices = null, tenant = null, onSwitch = null, loading = false, error = null }) {
  const list = Array.isArray(practices) ? practices : [];
  const picked = list.find((p) => p.is_current) ?? list[0] ?? tenant ?? null;
  const current = picked && tenant && picked.id === tenant.id ? { ...picked, name: tenant.name ?? picked.name, logoUrl: tenant.logoUrl ?? null } : picked;
  const secondLine = current?.slug ?? null;
  const words = String(current?.name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "·";
  const muted = "text-ui font-medium text-mute";

  if (loading) return <div className="min-w-0 flex-1" data-testid="tenant-switcher" data-state="loading"><span className={muted}>Loading your practice…</span></div>;
  if (error) return <div className="min-w-0 flex-1" data-testid="tenant-switcher" data-state="error" role="alert"><span className={muted}>Practice unavailable</span></div>;
  if (!current) return <div className="min-w-0 flex-1" data-testid="tenant-switcher" data-state="empty"><span className={muted}>Practice not identified</span></div>;

  const lines = (
    <span className="flex min-w-0 flex-col text-left">
      <span className="truncate text-ui font-medium text-ink" data-testid="tenant-current">{current.name}</span>
      {secondLine ? <span className="truncate text-caption text-mute">{secondLine}</span> : null}
    </span>
  );
  if (list.length < 2) {
    return <div className="flex min-w-0 flex-1 items-center gap-2.5" data-testid="tenant-switcher" data-state="single" data-count={list.length}><Mark current={current} initials={initials} />{lines}</div>;
  }
  return (
    <div className="min-w-0 flex-1" data-testid="tenant-switcher" data-state="multi" data-count={list.length}>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full min-w-0 items-center gap-2.5 rounded-control p-1 hover:bg-mute-bg" data-testid="tenant-switcher-trigger">
          <Mark current={current} initials={initials} />
          {lines}
          <ChevronDown className="ml-auto size-4 shrink-0 text-chevron" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent data-testid="tenant-switcher-menu" align="start">
          {list.map((p) => {
            const isCurrent = p.id === current.id;
            return (
              <DropdownMenuItem key={p.id} data-testid={`tenant-option-${p.slug}`} data-current={isCurrent ? "true" : undefined} disabled={isCurrent}
                onSelect={() => { if (!isCurrent) onSwitch?.(p.slug); }}>
                <span>{p.name}</span>
                {isCurrent ? <Check className="ml-auto size-4" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
