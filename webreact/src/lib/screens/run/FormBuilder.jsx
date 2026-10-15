// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.018 — FormBuilder.jsx — React port of webui/src/lib/screens/run/FormBuilder.svelte
// Props: { }
// Archetype: EditorPage
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { api } from "@/lib/api.js";
import EditorPage from "@/lib/components/kit/archetypes/EditorPage.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import RailSection from "@/lib/components/editor/RailSection.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function FormBuilder({}) {
  // ── screen phase ─────────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);

  // ── form data ────────────────────────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    id: null,
    title: "New form",
    slug: "",
    fields: [
      { key: "firstName", label: "First name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ],
    consentRequired: true,
  });

  const [baselineForm, setBaselineForm] = useState(null);

  // ── field editing state ──────────────────────────────────────────────────────────────────────
  const [editingField, setEditingField] = useState(null);
  const [showFieldForm, setShowFieldForm] = useState(false);

  // ── api data ─────────────────────────────────────────────────────────────────────────────────
  const [customFields, setCustomFields] = useState([]);
  const [submissions, setSubmissions] = useState({ total: 0, unactioned: 0 });

  // ── save flow ────────────────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  const dirty = useMemo(
    () => phase === "ready" && JSON.stringify(form) !== JSON.stringify(baselineForm),
    [phase, form, baselineForm]
  );

  // ── load initial data ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setPhase("loading");
      setLoadError(null);
      try {
        // Load custom fields from the API
        const res = await fetch("/api/custom-fields?record_type=person");
        if (res.ok) {
          const data = await res.json();
          setCustomFields(data.fields || []);
        }
        setBaselineForm(form);
        setPhase("ready");
      } catch (err) {
        setPhase("error");
        setLoadError(err);
      }
    };
    load();
  }, []);

  // ── add field ────────────────────────────────────────────────────────────────────────────────
  function addField() {
    setShowFieldForm(true);
    setEditingField(null);
  }

  // ── remove field ─────────────────────────────────────────────────────────────────────────────
  function removeField(index) {
    setForm({
      ...form,
      fields: form.fields.filter((_, i) => i !== index),
    });
  }

  // ── render field type label ──────────────────────────────────────────────────────────────────
  function renderFieldType(field) {
    if (field.type === "email") return "Email";
    if (field.type === "text") return "Text";
    if (field.type === "phone") return "Phone";
    if (field.type === "custom") return "From custom fields";
    return field.type;
  }

  // ── save handler ─────────────────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaveMessage("");
    setSaveError("");

    try {
      const idempotencyKey = crypto.randomUUID();
      const formData = {
        title: form.title,
        slug: form.slug,
        fields: form.fields,
        consentRequired: form.consentRequired,
      };

      let result;
      if (form.id) {
        // Update existing form
        result = await api.updateFormTemplate(form.id, formData, idempotencyKey);
      } else {
        // Create new form
        result = await api.createFormTemplate(formData, idempotencyKey);
      }

      if (result.form) {
        setForm(result.form);
        setBaselineForm(result.form);
        setSaveMessage(form.id ? "Form updated" : "Form created");
      }
    } catch (error) {
      setSaveError(error.message || "Failed to save form");
    } finally {
      setSaving(false);
    }
  }

  // ── render ready state ───────────────────────────────────────────────────────────────────────
  const header = {
    title: form.title,
    meta: "Feeds people, a task and the Spring list",
    verbs: [
      { label: "Preview", kind: "plain", onClick: () => {}, disabled: false },
      { label: "Save", kind: "primary", onClick: handleSave, disabled: !dirty || saving },
    ],
    onClose: () => {},
    dirty,
    objectNoun: "form",
    testId: "form-builder-header",
  };

  const rail = (
    <EditorRail objectNoun="form" testId="form-builder-rail">
      <RailSection
        label="This form"
        summary={form.title}
        testId="form-builder-rail-name"
      >
      </RailSection>

      <RailSection
        label="Where it lives"
        testId="form-builder-rail-location"
      >
        <div className="text-ui text-ink-2 mt-1.5">foundry.com/go/f/{form.slug || 'form-slug'}</div>
      </RailSection>

      <div className="border-t border-hair pt-3.75">
        <p className="text-meta text-mute">Embedded on the landing page, or standalone</p>
      </div>

      <RailSection
        label="Campaign"
        testId="form-builder-rail-campaign"
      >
        <div className="text-ui text-ink-2 mt-1.5">Spring reactivation</div>
      </RailSection>

      <RailSection
        label="Submissions"
        testId="form-builder-rail-submissions"
      >
        <div className="text-ui text-ink-2 mt-1.5">{submissions.total} total · {submissions.unactioned} unactioned</div>
      </RailSection>

      <RailSection
        label="Spam guard"
        testId="form-builder-rail-spam"
      >
        <div className="text-ui text-ink-2 mt-1.5">Turnstile</div>
      </RailSection>

      <p className="text-xs text-mute mt-2">Same guard as signup. No CAPTCHAs for humans to fail.</p>
    </EditorRail>
  );

  return (
    <EditorPage header={header} rail={rail} testId="form-builder-editor">
      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {/* FIELDS SECTION */}
      {/* ────────────────────────────────────────────────────────────────────────────── */}
      <EditorSection title="Fields">
        {form.fields.map((field, idx) => (
          <div
            key={idx}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-hair min-h-10"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-ui text-ink">{field.label}</div>
              <div className="text-meta text-mute">
                {renderFieldType(field)} · {field.required ? "required" : "optional"}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeField(idx)}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="px-4 py-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={addField}
          >
            Add a field
          </Button>
        </div>
      </EditorSection>

      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {/* CONSENT SECTION */}
      {/* ────────────────────────────────────────────────────────────────────────────── */}
      <EditorSection title="Consent">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-hair min-h-10">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ui text-ink">Marketing consent</div>
            <div className="text-meta text-mute">
              "Send me occasional emails. Unsubscribe any time." — required for marketing forms and can't be removed.
            </div>
          </div>
          <span className="font-medium text-xs px-2 py-1 rounded-full border border-line text-mute">
            Locked
          </span>
        </div>
      </EditorSection>

      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {/* AFTER SOMEONE SUBMITS SECTION */}
      {/* ────────────────────────────────────────────────────────────────────────────── */}
      <EditorSection title="After someone submits">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-hair min-h-10">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ui text-ink">Create a lead</div>
            <div className="text-meta text-mute">
              A person with stage Lead — or matched to an existing person by email, with a merge suggestion, never a silent merge
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-hair min-h-10">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ui text-ink">Open a task</div>
            <div className="text-meta text-mute">
              "New lead from {form.title}" — within minutes, to the owner
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-hair min-h-10">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ui text-ink">Add to segment</div>
            <div className="text-meta text-mute">
              Optional tag or list to categorize submissions
            </div>
          </div>
        </div>
      </EditorSection>

      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {/* MESSAGES */}
      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {saveMessage && (
        <div className="text-xs text-ok mt-2">
          {saveMessage}
        </div>
      )}
      {saveError && (
        <div className="text-xs text-bad mt-2">
          {saveError}
        </div>
      )}
    </EditorPage>
  );
}
