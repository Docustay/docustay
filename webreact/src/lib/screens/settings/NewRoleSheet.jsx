// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RP.5 — NewRoleSheet. SideSheet form for creating a new custom role.
// Props: { open, onOpenChange, onCreated }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import { savedToast } from "@/lib/hooks/savedToast.js";

export default function NewRoleSheet({ open = false, onOpenChange = null, onCreated = null }) {
  const [name, setName] = useState("");
  const [basedOn, setBasedOn] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = () => {
    setName("");
    setBasedOn("admin");
    setError(null);
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange?.(false);
  };

  const handleSave = async (e) => {
    e?.preventDefault();

    if (!name.trim()) {
      setError("Role name is required");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await api.post("/api/settings/roles/create", {
        label: name,
        basedOn: basedOn,
      });

      savedToast("Role created");
      resetForm();
      onOpenChange?.(false);
      onCreated?.(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <SideSheet
      title="New role"
      testId="role-new-sheet"
      busy={busy}
      dirty={name.trim() !== ""}
      error={error}
      cancelLabel="Cancel"
      saveLabel="Create role"
      onCancel={handleCancel}
      onSave={handleSave}
    >
      <SheetSection>
        <SheetRow label="Name" htmlFor="role-name" required>
          <Input
            id="role-name"
            type="text"
            placeholder="Front desk"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            data-testid="role-new-sheet-name"
            required
          />
        </SheetRow>

        <SheetRow
          label="Start from"
          htmlFor="role-based-on"
          hint="You can change anything afterwards. Owners can't be copied — there is only ever one owner."
        >
          <NativeSelect
            id="role-based-on"
            value={basedOn}
            onChange={(e) => setBasedOn(e.target.value)}
            disabled={busy}
            data-testid="role-new-sheet-based-on"
          >
            <option value="admin">Admin</option>
            <option value="member">Team member</option>
          </NativeSelect>
        </SheetRow>
      </SheetSection>
    </SideSheet>
  );
}
