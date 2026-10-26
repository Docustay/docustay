// The account menu (R3.004, AvatarMenu.svelte).
// ★ The rank shown is a WORD (Owner · Admin · the practice's term for a Team member), never the role key — R-46.
// ★ No appUserId → the profile row says why it is unavailable (aria-disabled), never links to /record/person/undefined.
// ★ ONE sign-in entry (F45): "Sign-in and security" → /account/security, which holds both the sessions and the two-step panel.
// ★ Platform appears only when the SERVER says the operator grant is active (me.operatorGrantActive).
import { User, Settings, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/lib/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/lib/components/ui/dropdown-menu";
import { rankLabel } from "@/lib/permissions/vocab.js";

const DENSITY_LABELS = { compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" };

export default function AvatarMenu({ displayName = null, role = null, appUserId = null, operatorGrantActive = false, onNavigate = null, onSignOut = null, density = "compact", onSetDensity = null }) {
  const who = displayName ?? "Signed in";
  const initials = String(displayName ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
  const item = "gap-2";
  return (
    <div data-testid="avatar-menu">
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-pill" data-testid="avatar-trigger" aria-label={displayName ? `Account menu for ${displayName}` : "Account menu"}>
          <Avatar className="size-(--size-avatar)"><AvatarFallback className="bg-avatar-bg text-caption font-semibold text-avatar-ink">{initials}</AvatarFallback></Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56" data-testid="avatar-panel" align="start" side="bottom">
          <div className="flex flex-col px-2 py-1.5">
            <span className="text-ui font-medium text-ink" data-testid="avatar-name">{who}</span>
            {role ? <span className="text-caption text-mute" data-testid="avatar-role">{rankLabel(role)}</span> : null}
          </div>
          <DropdownMenuSeparator />
          {appUserId
            ? <DropdownMenuItem className={item} data-testid="avatar-profile" onSelect={() => onNavigate?.(`/record/person/${appUserId}`)}><User aria-hidden="true" /> Your profile</DropdownMenuItem>
            : <DropdownMenuItem className={item} data-testid="avatar-profile-unavailable" disabled aria-disabled="true"><User aria-hidden="true" /> Your profile is not available on this sign-in</DropdownMenuItem>}
          <DropdownMenuItem className={item} data-testid="avatar-settings" onSelect={() => onNavigate?.("/settings/practice")}><Settings aria-hidden="true" /> Settings</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="avatar-density-trigger">Density — {DENSITY_LABELS[density] ?? "Compact"}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="avatar-density-panel">
              <DropdownMenuRadioGroup value={density} onValueChange={(v) => onSetDensity?.(v)}>
                {Object.entries(DENSITY_LABELS).map(([value, label]) => <DropdownMenuRadioItem key={value} value={value} data-testid={`avatar-density-${value}`}>{label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {appUserId ? <DropdownMenuItem data-testid="avatar-booking-link" onSelect={() => onNavigate?.("/engagements/booking/mine")}>My booking page</DropdownMenuItem> : null}
          {appUserId ? <DropdownMenuItem data-testid="avatar-calendar" onSelect={() => onNavigate?.("/settings/calendar")}>My calendar</DropdownMenuItem> : null}
          <DropdownMenuItem data-testid="avatar-security" onSelect={() => onNavigate?.("/account/security")}>Sign-in and security</DropdownMenuItem>
          {operatorGrantActive ? <DropdownMenuItem data-testid="avatar-platform" onSelect={() => onNavigate?.("/platform")}>Platform</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={item} data-testid="avatar-signout" onSelect={() => onSignOut?.()}><LogOut aria-hidden="true" /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
