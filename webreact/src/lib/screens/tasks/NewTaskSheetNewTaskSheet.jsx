// ═══════════════════════════════════════════════════════════════════════════════════════════════
// NewTaskSheetNewTaskSheet — the sheet component for creating a task
// Ported from webui/src/lib/screens/tasks/NewTaskSheet.svelte:78-171 (the <SideSheet> + fields)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SideSheet from "@/lib/forms/SideSheet.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";

export default function NewTaskSheetNewTaskSheet({
  onCancel = null,
  onSave = null,
  busy = false,
  error = null,
  title = "",
  about = "",
  due = null,
  assignee = "",
  note = "",
  people = [],
  peopleLoading = false,
  handleSave = null,
  onTitleChange = null,
  onAboutChange = null,
  onDueChange = null,
  onAssigneeChange = null,
  onNoteChange = null,
}) {
  return (
    <SideSheet
      title="New task"
      onCancel={onCancel}
      onSave={handleSave || onSave}
      saveLabel="Create"
      busy={busy}
      error={error}
      testId="new-task-sheet"
    >
      <div className="border-b border-line py-3 px-5.5">
        <Field>
          <FieldLabel>Title<span className="ml-1 text-danger">*</span></FieldLabel>
          <FieldContent>
            <Input
              type="text"
              value={title}
              onChange={(e) => onTitleChange?.(e.target.value)}
              placeholder="What needs to be done?"
              disabled={busy}
            />
          </FieldContent>
        </Field>
      </div>

      <div className="border-b border-line py-3 px-5.5">
        <Field>
          <FieldLabel>About (optional)</FieldLabel>
          <FieldContent>
            {peopleLoading ? (
              <Input type="text" disabled placeholder="Loading..." />
            ) : (
              <Combobox
                value={about}
                onValueChange={onAboutChange}
                options={people.map((p) => ({
                  value: p.id,
                  label: p.display_name || p.email || "Unknown",
                }))}
                placeholder="Select a person..."
                disabled={busy}
              />
            )}
          </FieldContent>
        </Field>
      </div>

      <div className="border-b border-line py-3 px-5.5">
        <Field>
          <FieldLabel>Due (optional)</FieldLabel>
          <FieldContent>
            <DatePicker
              value={due}
              onValueChange={onDueChange}
              disabled={busy}
            />
          </FieldContent>
        </Field>
      </div>

      <div className="border-b border-line py-3 px-5.5">
        <Field>
          <FieldLabel>Assign to (optional)</FieldLabel>
          <FieldContent>
            {peopleLoading ? (
              <Input type="text" disabled placeholder="Loading..." />
            ) : (
              <Combobox
                value={assignee}
                onValueChange={onAssigneeChange}
                options={people.map((p) => ({
                  value: p.id,
                  label: p.display_name || p.email || "Unknown",
                }))}
                placeholder="Select a person..."
                disabled={busy}
              />
            )}
          </FieldContent>
        </Field>
      </div>

      <div className="border-b border-line py-3 px-5.5">
        <Field>
          <FieldLabel>Note (optional)</FieldLabel>
          <FieldContent>
            <textarea
              className="w-full min-h-[100px] rounded-control border border-line bg-surface px-3 py-2 text-field text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand-soft disabled:opacity-60"
              value={note}
              onChange={(e) => onNoteChange?.(e.target.value)}
              placeholder="Any additional details..."
              disabled={busy}
              rows="4"
            ></textarea>
          </FieldContent>
        </Field>
      </div>
    </SideSheet>
  );
}
