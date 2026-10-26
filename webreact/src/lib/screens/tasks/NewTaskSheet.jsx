// ═══════════════════════════════════════════════════════════════════════════════════════════════
// NewTaskSheet — wrapper component for creating a task (parent of NewTaskSheetNewTaskSheet)
// Ported from webui/src/lib/screens/tasks/NewTaskSheet.svelte
// Manages state and passes to NewTaskSheetNewTaskSheet for the actual UI
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { request } from "@/lib/api.js";
import NewTaskSheetNewTaskSheet from "./NewTaskSheetNewTaskSheet.jsx";

export default function NewTaskSheet({ onCancel = null, onSave = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState("");
  const [about, setAbout] = useState("");
  const [due, setDue] = useState(null);
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(false);

  // Load people for about/assign pickers
  useEffect(() => {
    async function loadPeople() {
      setPeopleLoading(true);
      try {
        const data = await request("/api/list/people/all?limit=100");
        setPeople(data?.rows ?? []);
      } catch (err) {
        // Toast handled by parent or silently fail
      } finally {
        setPeopleLoading(false);
      }
    }
    loadPeople();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const body = {
        title: title.trim(),
        ...(about ? { subjectId: about } : {}),
        ...(due ? { dueAt: due } : {}),
        ...(assignee ? { assigneeId: assignee } : {}),
        ...(note ? { note: note.trim() } : {}),
      };

      await onSave?.(body);
    } catch (err) {
      setError(err?.message ?? "Failed to create task");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <NewTaskSheetNewTaskSheet
      onCancel={onCancel}
      onSave={onSave}
      busy={busy}
      error={error}
      title={title}
      about={about}
      due={due}
      assignee={assignee}
      note={note}
      people={people}
      peopleLoading={peopleLoading}
      handleSave={handleSave}
      onTitleChange={setTitle}
      onAboutChange={setAbout}
      onDueChange={setDue}
      onAssigneeChange={setAssignee}
      onNoteChange={setNote}
    />
  );
}
