// RowActions — up to two inline actions, the rest in "More". Ported from webui/src/lib/lists/RowActions.svelte:
// same props, testids and toast copy.
// ★ The Svelte component takes no children; PlatJobs placed its Retry/Give-up buttons INSIDE it and they
//   never rendered (RECON §16.2 C5). That screen's task passes them as `actions` in React.
import { Ellipsis } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/lib/components/ui/dropdown-menu.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { runAction } from "@/lib/components/kit/runAction.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";
import { useContext } from "react";
import { AppStateContext } from "@/lib/app/useAppState.js";
import { requestDelete } from "@/lib/record/DeleteDialog.jsx";
import { deleteTypeForPath, isUuid, mayDelete } from "@/lib/record/deleteTypes.js";

// `maxInline` is how many ordinary actions show as buttons before the rest fold into "More" (default 2; a narrow table passes 0).
export default function RowActions({ actions: given = [], row = null, deleteType: forcedType = null, noDelete = false, maxInline = 2 }) {
  // ★ THE SHARED DELETE (QUEUE §3 A): no screen passes a delete action. When the list on screen holds a deletable
  //   record type, the row's id is a real id and the viewer is Owner/Admin, "Delete" is added here, once, and it opens
  //   the one shared "can't be undone" dialog.
  const app = useContext(AppStateContext);
  // `deleteType` overrides the page's type for a row that is a DIFFERENT record kind (an invite among team members); `noDelete` withholds it (the Owner, yourself)
  const type = noDelete ? null : (forcedType ?? (typeof window === "undefined" ? null : deleteTypeForPath(window.location.pathname)));
  const deletable = type && isUuid(row?.id) && mayDelete(app?.nav?.rank ?? null) && !given.some((a) => a.id === "delete");
  const actions = deletable
    ? [...given, { id: "delete", label: "Delete", destructive: true, onRun: () => requestDelete({ object: type, id: row.id, label: row.display_name ?? row.name ?? row.title ?? null }) }]
    : given;
  const primary = actions.filter((a) => !a.destructive).slice(0, maxInline);
  const overflow = actions.filter((a) => !primary.includes(a));
  const ordinary = overflow.filter((a) => !a.destructive);
  const destructive = overflow.filter((a) => a.destructive);
  return (
    <div className="flex items-center justify-end gap-1.5" data-testid="list-row-actions">
      {primary.map((a) => (
        <Button key={a.id} type="button" variant="outline" size="sm" data-testid={`list-row-action-${a.id}`} onClick={(e) => { e.stopPropagation(); runAction(a, row); }}>{a.label}</Button>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" data-testid="list-row-actions-more" aria-label="More actions" onClick={(e) => e.stopPropagation()}><Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ordinary.map((a) => <DropdownMenuItem key={a.id} data-testid={`list-row-action-${a.id}`} onSelect={() => runAction(a, row)}>{a.label}</DropdownMenuItem>)}
            {destructive.length > 0 && ordinary.length > 0 && <DropdownMenuSeparator />}
            {destructive.map((a) => <DropdownMenuItem key={a.id} data-testid={`list-row-action-${a.id}`} data-destructive="true" variant="destructive" onSelect={() => runAction(a, row)}>{a.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
