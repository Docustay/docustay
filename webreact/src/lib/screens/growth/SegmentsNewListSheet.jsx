// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SegmentsNewListSheet — the side sheet for creating a new segment. Extracted from the main
// Segments screen. Ported from webui/src/lib/screens/growth/Segments.svelte:280-412.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRowComponent, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { Label } from "@/lib/components/ui/label.jsx";

export default function SegmentsNewListSheet({
  open = false,
  onOpenChange = () => {},
  error = null,
  showCreateSheet = false,
  createError = null,
  createBusy = false,
  formData = {},
  handleCreateSegment = () => {},
  resetForm = () => {},
  toggleRole = () => {},
  ROLE_OPTIONS = [],
  onFormFieldChange = () => {},
  onFormFilterChange = () => {},
}) {
  if (!showCreateSheet) {
    return null;
  }

  return (
    <SideSheet
      title="New list"
      busy={createBusy}
      dirty={!!(formData.name && formData.name.trim())}
      error={createError}
      onCancel={() => {
        resetForm?.();
      }}
      onSave={(e) => {
        handleCreateSegment?.(e);
      }}
      saveLabel="Create"
    >
      <SheetSection>
        <SheetRowComponent label="Name" htmlFor="segment-name">
          <Input
            type="text"
            id="segment-name"
            placeholder="E.g., Q4 Outreach"
            value={formData.name || ""}
            onChange={(e) => onFormFieldChange?.("name", e.target.value)}
            disabled={createBusy}
          />
        </SheetRowComponent>
      </SheetSection>

      <SheetSection>
        <SheetRowComponent label="Role">
          <fieldset className="flex flex-col gap-2">
            {ROLE_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`role-${option.value}`}
                  checked={formData.filter?.role?.includes(option.value) || false}
                  onCheckedChange={() => toggleRole?.(option.value)}
                  disabled={createBusy}
                />
                <Label htmlFor={`role-${option.value}`} className="font-normal cursor-pointer">
                  {option.label}
                </Label>
              </div>
            ))}
          </fieldset>
        </SheetRowComponent>

        <SheetRowComponent label="Email" htmlFor="segment-has-email">
          <div className="flex items-center gap-2">
            <Checkbox
              id="segment-has-email"
              checked={formData.filter?.has_email || false}
              onCheckedChange={(checked) => onFormFilterChange?.("has_email", checked)}
              disabled={createBusy}
            />
            <Label htmlFor="segment-has-email" className="font-normal cursor-pointer">
              Has email address
            </Label>
          </div>
        </SheetRowComponent>

        <SheetRowComponent label="Quiet days" htmlFor="segment-quiet-days">
          <Input
            type="number"
            id="segment-quiet-days"
            placeholder="Days without booking"
            value={formData.filter?.quiet_days || ""}
            onChange={(e) => onFormFilterChange?.("quiet_days", e.target.value)}
            disabled={createBusy}
          />
        </SheetRowComponent>

        <SheetRowComponent label="Credits ≤" htmlFor="segment-credits">
          <Input
            type="number"
            id="segment-credits"
            placeholder="Sessions remaining"
            value={formData.filter?.credits_remaining_lte || ""}
            onChange={(e) => onFormFilterChange?.("credits_remaining_lte", e.target.value)}
            disabled={createBusy}
          />
        </SheetRowComponent>

        <SheetRowComponent label="Money" htmlFor="segment-owes">
          <div className="flex items-center gap-2">
            <Checkbox
              id="segment-owes"
              checked={formData.filter?.owes_money || false}
              onCheckedChange={(checked) => onFormFilterChange?.("owes_money", checked)}
              disabled={createBusy}
            />
            <Label htmlFor="segment-owes" className="font-normal cursor-pointer">
              Owes money
            </Label>
          </div>
        </SheetRowComponent>

        <SheetRowComponent label="Booking" htmlFor="segment-never-booked">
          <div className="flex items-center gap-2">
            <Checkbox
              id="segment-never-booked"
              checked={formData.filter?.never_booked || false}
              onCheckedChange={(checked) => onFormFilterChange?.("never_booked", checked)}
              disabled={createBusy}
            />
            <Label htmlFor="segment-never-booked" className="font-normal cursor-pointer">
              Never booked
            </Label>
          </div>
        </SheetRowComponent>

        <SheetRowComponent label="Waitlist" htmlFor="segment-waitlist">
          <div className="flex items-center gap-2">
            <Checkbox
              id="segment-waitlist"
              checked={formData.filter?.on_waitlist || false}
              onCheckedChange={(checked) => onFormFilterChange?.("on_waitlist", checked)}
              disabled={createBusy}
            />
            <Label htmlFor="segment-waitlist" className="font-normal cursor-pointer">
              On the waitlist
            </Label>
          </div>
        </SheetRowComponent>
      </SheetSection>
    </SideSheet>
  );
}
