// Run a row action with its toast and optional Undo — shared by DataTable and RowActions (same copy as the
// Svelte originals: "Item updated", "Undo", "Changes undone", "Undo failed", "Action failed", 10s).
import { toast } from "sonner";

export async function runAction(action, row) {
  try {
    await action.onRun(row);
    if (action.undo) {
      toast.success(action.label, {
        description: "Item updated",
        action: {
          label: "Undo",
          onClick: async () => {
            try { await action.undo(row); toast.success("Changes undone"); }
            catch (e) { toast.error("Undo failed", { description: e?.message ?? "Could not undo changes" }); }
          },
        },
        duration: 10000,
      });
    }
  } catch (err) {
    toast.error(action.label, { description: err?.message ?? "Action failed" });
  }
}
