import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
// ★ `$keystone/...` is a backend-only alias (src/) — the frontend bundle cannot import across that
//   boundary. Mirrors src/people/vocab.mjs's own STAFF_ROLES exactly (the three values
//   keystone.app_user_staff_role_check admits, least to most privileged).
const STAFF_ROLES = Object.freeze(["member", "admin", "owner"]);

export default function PersonActionsMenu2Menu({
  open, onOpenChange, person, rank, RANK_LABEL, busy, setRank,
}) {
  if (!person) return null;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2"
          data-testid="person-rank-trigger"
        >
          Rank: {RANK_LABEL[person.staff_role] ?? person.staff_role ?? "—"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="person-rank-menu">
        {STAFF_ROLES.map((r) => (
          <DropdownMenuItem
            key={r}
            data-testid={`person-rank-${r}`}
            disabled={busy || r === person.staff_role}
            onSelect={() => setRank(r)}
          >
            {RANK_LABEL[r] ?? r}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
