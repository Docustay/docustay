import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Card, CardContent } from "@/lib/components/ui/card.jsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/lib/components/ui/alert-dialog.jsx";
import FieldPicker from "@/lib/components/FieldPicker.jsx";
import { ASSIGNMENT_TARGETS } from "@keystone/documents/vocabulary.mjs";

// OWNERS filtering (from the server's own vocabulary)
const OWNERS = ASSIGNMENT_TARGETS.filter((t) => t !== "both");
const OWNER_LABEL = {
  pir: "Person in recovery",
  parent: "Parent",
  coach: `Coach`,
  client: "Client",
  consultant: "Consultant",
  familyMember: "Family member",
  recipient: "Recipient",
};

// Slug generation function
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

// Draggable section wrapper
function DraggableSection({ section, index, onPatch, onRemove, pickerFor, onPickerOpen, onPickerInsert, fieldsLoading, fieldsError, fields, onAddBlock, onRemoveBlock, onPatchBlock }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="tpl-section-card" data-testid={`tpl-section-${index}`}>
        <CardContent className="tpl-section-content">
          <div className="tpl-section-header flex items-center gap-3">
            <span
              className="tpl-drag cursor-grab text-muted-foreground text-base flex-shrink-0"
              aria-hidden="true"
              {...attributes}
              {...listeners}
            >
              ⠿
            </span>
            <Input
              data-testid={`tpl-section-title-${index}`}
              value={section.title}
              placeholder="Section title"
              onChange={(e) => {
                const newTitle = e.currentTarget.value;
                onPatch(index, {
                  title: newTitle,
                  key: slug(newTitle) || section.key,
                });
              }}
              className="tpl-section-title-input flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              data-testid={`tpl-section-remove-${index}`}
              onClick={() => onRemove(index)}
              aria-label="Remove this section"
            >
              ×
            </Button>
          </div>

          <div className="tpl-section-meta flex gap-5 flex-wrap">
            <Field>
              <FieldLabel>Whose section</FieldLabel>
              <FieldContent>
                <NativeSelect
                  data-testid={`tpl-section-owner-${index}`}
                  value={section.owner}
                  onChange={(e) => {
                    onPatch(index, { owner: e.currentTarget.value });
                  }}
                >
                  {OWNERS.map((o) => (
                    <option key={o} value={o}>
                      {OWNER_LABEL[o] ?? o}
                    </option>
                  ))}
                </NativeSelect>
              </FieldContent>
            </Field>

            <div className="tpl-field-checkbox flex items-center gap-2">
              <input
                type="checkbox"
                id={`signs-${index}`}
                data-testid={`tpl-section-signs-${index}`}
                checked={section.requires_signature}
                onChange={(e) => {
                  onPatch(index, { requires_signature: e.currentTarget.checked });
                }}
              />
              <label htmlFor={`signs-${index}`}>This section is signed</label>
            </div>
          </div>

          {section.blocks.map((b, bi) => (
            <div
              key={bi}
              className="tpl-block flex items-start gap-3 p-3 border-l-2 border-border"
              data-testid={`tpl-block-${index}-${bi}`}
              data-type={b.type}
            >
              <div className="flex-1">
                {b.type === "prose" && (
                  <Textarea
                    data-testid={`tpl-prose-${index}-${bi}`}
                    value={b.text}
                    placeholder="Enter prose text"
                    rows={4}
                    onChange={(e) => {
                      onPatchBlock(index, bi, { text: e.currentTarget.value });
                    }}
                  />
                )}
                {b.type === "variable" && (
                  <p
                    className="tpl-static m-0 p-2 text-sm flex flex-col gap-1"
                    data-testid={`tpl-variable-${index}-${bi}`}
                  >
                    <code className="font-mono text-xs text-muted-foreground">
                      {`{{${b.name}}}`}
                    </code>
                    <span>{b.label}</span>
                  </p>
                )}
                {b.type === "signature" && (
                  <p
                    className="tpl-static m-0 p-2 text-sm flex flex-col gap-1"
                    data-testid={`tpl-signature-${index}-${bi}`}
                  >
                    <span>✎ {b.label}</span>
                    <span className="tpl-hint text-xs text-muted-foreground">
                      signed by {OWNER_LABEL[b.owner ?? section.owner]}
                    </span>
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                data-testid={`tpl-block-remove-${index}-${bi}`}
                onClick={() => onRemoveBlock(index, bi)}
                aria-label="Remove this block"
              >
                Remove
              </Button>
            </div>
          ))}

          <div className="tpl-block-add flex gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              data-testid={`tpl-add-prose-${index}`}
              onClick={() => {
                onAddBlock(index, { type: "prose", text: "" });
              }}
            >
              Add a paragraph
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid={`tpl-add-variable-${index}`}
              onClick={() => {
                onPickerOpen(pickerFor === index ? null : index);
              }}
            >
              Insert a value
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid={`tpl-add-signature-${index}`}
              onClick={() => {
                onAddBlock(index, {
                  type: "signature",
                  key: `${section.key}_sign`,
                  label: `${OWNER_LABEL[section.owner] ?? section.owner} signature`,
                });
              }}
            >
              Add a signature slot
            </Button>
          </div>

          {pickerFor === index && (
            <div className="tpl-varpick border border-input rounded-lg bg-muted/20 mt-3" data-testid={`tpl-varpick-${index}`}>
              {fieldsLoading ? (
                <div
                  className="tpl-picker-loading p-6 text-center text-muted-foreground text-sm"
                  data-testid={`tpl-varpick-loading-${index}`}
                >
                  <p>Loading fields…</p>
                </div>
              ) : fieldsError ? (
                <div
                  className="tpl-picker-error p-3 bg-destructive/10 border border-destructive/30 rounded text-destructive text-sm"
                  data-testid={`tpl-varpick-error-${index}`}
                  role="alert"
                >
                  <p className="m-0">{fieldsError}</p>
                </div>
              ) : (
                <FieldPicker
                  fields={fields}
                  onInsert={(fieldName) => onPickerInsert(index, fieldName)}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TemplateBuilder({ builder = "contract", template = null, onDone = null }) {
  const [name, setName] = useState(template?.name ?? "");
  const [sections, setSections] = useState(
    (template?.body?.sections ?? []).map((s, i) => ({ id: `s${i}`, ...s }))
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);
  const [fields, setFields] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState(null);
  const [showDiscardGuard, setShowDiscardGuard] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const initialName = template?.name ?? "";
  const initialSections = template?.body?.sections ?? [];

  // Fetch the variable catalogue from the server
  useEffect(() => {
    const fetchFields = async () => {
      setFieldsLoading(true);
      setFieldsError(null);
      try {
        const result = await api.fetchVariableCatalogue();
        setFields(Array.isArray(result) ? result : result?.rows || []);
      } catch (err) {
        setFieldsError(
          err instanceof ApiError ? err.message : String(err?.message ?? err)
        );
        setFields([]);
      } finally {
        setFieldsLoading(false);
      }
    };
    fetchFields();
  }, []);

  // Check if form is dirty
  const checkDirty = useCallback(() => {
    const isDirtyNow =
      name !== initialName ||
      JSON.stringify(
        sections.map((s) => {
          const { id, ...rest } = s;
          return rest;
        })
      ) !== JSON.stringify(initialSections);
    setIsDirty(isDirtyNow);
  }, [name, sections, initialName, initialSections]);

  // Update dirty state whenever name or sections change
  useEffect(() => {
    checkDirty();
  }, [name, sections, checkDirty]);

  // Patch section
  const patch = (i, p) => {
    setSections((prev) =>
      prev.map((s, j) => (j === i ? { ...s, ...p } : s))
    );
  };

  // Patch block
  const patchBlock = (i, bi, p) => {
    patch(i, {
      blocks: sections[i].blocks.map((b, j) =>
        j === bi ? { ...b, ...p } : b
      ),
    });
  };

  // Add block
  const addBlock = (i, block) => {
    patch(i, { blocks: [...sections[i].blocks, block] });
  };

  // Remove block
  const removeBlock = (i, bi) => {
    patch(i, {
      blocks: sections[i].blocks.filter((_, j) => j !== bi),
    });
  };

  // Add section
  const addSection = () => {
    const n = sections.length + 1;
    setSections((prev) => [
      ...prev,
      {
        id: `s${Date.now()}`,
        key: `section_${n}`,
        title: `Section ${n}`,
        owner: OWNERS[0],
        requires_signature: false,
        blocks: [{ type: "prose", text: "" }],
      },
    ]);
  };

  // Handle picker insert
  const handlePickerInsert = (sectionIndex, fieldName) => {
    const fieldInfo = fields.find((f) => f.name === fieldName);
    addBlock(sectionIndex, {
      type: "variable",
      name: fieldName,
      label: fieldInfo?.label || fieldName,
    });
    setPickerFor(null);
  };

  // Calculate problems with the template
  const problems = useMemo(() => {
    const out = [];
    const keys = sections.map((s) => s.key);
    const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
    if (dupes.length) {
      out.push(
        `Two sections share the key ${dupes.join(", ")}. Two sections with one key write to one stored answer, and the second silently overwrites the first.`
      );
    }
    for (const s of sections) {
      if (!s.title?.trim()) {
        out.push(
          `A section has no title — an untitled clause cannot be referred to.`
        );
      }
      if (s.blocks.some((b) => b.type === "prose" && !b.text?.trim())) {
        out.push(
          `"${s.title}" has an empty paragraph, which renders as blank space in an agreement.`
        );
      }
      if (
        s.requires_signature &&
        !s.blocks.some((b) => b.type === "signature")
      ) {
        out.push(
          `"${s.title}" requires a signature but has no signature slot — the signer would be asked for a signature with nowhere to make it.`
        );
      }
    }
    if (
      builder === "contract" &&
      sections.length &&
      !sections.some((s) => s.requires_signature)
    ) {
      out.push(
        "No section requires a signature. An agreement nobody signs is a notice — if that is what you meant, author it as a form instead."
      );
    }
    return out;
  }, [sections, builder]);

  // Check if form is ready to save
  const ready =
    name.trim().length > 0 && sections.length > 0 && problems.length === 0;

  // Build the body object for saving
  const toBody = () => {
    return {
      kind: builder,
      schema_version: 1,
      sections: sections.map(({ id, ...s }) => s),
    };
  };

  // Save the template
  const save = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = toBody();
      if (template?.id) {
        await api.updateTemplateBody({ templateId: template.id, body });
      } else if (builder === "contract") {
        await api.createContractTemplate({ name: name.trim(), body });
      } else {
        await api.createFormTemplate({ name: name.trim(), body });
      }
      setIsDirty(false);
      onDone?.();
    } catch (err) {
      setProblem(
        err instanceof ApiError ? err.message : String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  };

  // Handle close button
  const handleClose = () => {
    if (isDirty) {
      setShowDiscardGuard(true);
    } else {
      onDone?.();
    }
  };

  // DND sensors and handlers
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setSections((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  const sectionIds = sections.map((s) => s.id);

  return (
    <section
      className="tpl-editor flex flex-col h-screen bg-surface"
      data-testid="template-builder"
      data-builder={builder}
      // ★ CANVAS = SURFACE [the maintainer, 29 Sep] — see Shell.jsx's own note; this was this screen's own
      //   whole-page canvas, not a muted micro-state, so it moves to bg-surface with it.
    >
      {/* Header */}
      <div className="tpl-header flex items-center justify-between h-[72px] px-7 bg-white border-b border-border">
        <div className="tpl-header-content flex-1">
          <h2 className="tpl-title text-lg font-medium m-0">
            {template?.id ? "Edit template" : "Create template"}
          </h2>
          {template?.id && (
            <p className="tpl-meta text-xs text-muted-foreground m-0 mt-0.5">
              Version {template.version}
            </p>
          )}
        </div>
        <div className="tpl-header-actions flex gap-3 ml-6">
          <Button
            variant="outline"
            onClick={handleClose}
          >
            Close
          </Button>
          <Button
            variant="default"
            data-testid="tpl-save"
            disabled={busy || !ready}
            onClick={save}
          >
            {busy ? "Saving…" : template?.id ? "Save this version" : "Create the template"}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="tpl-body flex-1 flex overflow-hidden">
        <div className="tpl-main flex-1 overflow-auto pb-20">
          <div className="tpl-content px-11">
            <div className="pt-8 pb-1">
              {/* Template name field */}
              <div className="tpl-section">
                <Field>
                  <FieldLabel>Template name</FieldLabel>
                  <FieldContent>
                    <Input
                      data-testid="tpl-name"
                      value={name}
                      maxLength={200}
                      placeholder="Enter template name"
                      onChange={(e) => setName(e.currentTarget.value)}
                    />
                  </FieldContent>
                </Field>
              </div>
            </div>

            {/* Sections with drag and drop */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sectionIds}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className="tpl-sections flex flex-col gap-4 my-8"
                  data-testid="tpl-sections"
                >
                  {sections.map((s, i) => (
                    <DraggableSection
                      key={s.id}
                      section={s}
                      index={i}
                      onPatch={patch}
                      onRemove={(idx) => {
                        setSections((prev) =>
                          prev.filter((_, j) => j !== idx)
                        );
                      }}
                      pickerFor={pickerFor}
                      onPickerOpen={setPickerFor}
                      onPickerInsert={handlePickerInsert}
                      fieldsLoading={fieldsLoading}
                      fieldsError={fieldsError}
                      fields={fields}
                      onAddBlock={addBlock}
                      onRemoveBlock={removeBlock}
                      onPatchBlock={patchBlock}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Add section button */}
            <Button
              variant="default"
              data-testid="tpl-add-section"
              onClick={addSection}
            >
              Add a section
            </Button>

            {/* Problems alert */}
            {problems.length > 0 && (
              <div
                className="tpl-problems border border-yellow-600 rounded-lg bg-yellow-50 p-3 mt-5"
                data-testid="tpl-problems"
                role="alert"
              >
                {problems.map((p, idx) => (
                  <div key={idx} className="tpl-problem-item text-sm text-foreground leading-relaxed my-1">
                    {p}
                  </div>
                ))}
              </div>
            )}

            {/* Error alert */}
            {problem && (
              <div
                className="tpl-error border border-destructive rounded-lg bg-destructive/10 p-3 text-sm text-destructive mt-5"
                data-testid="tpl-error"
                role="alert"
              >
                {problem}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Discard guard dialog */}
      <AlertDialog open={showDiscardGuard} onOpenChange={setShowDiscardGuard}>
        <AlertDialogContent>
          <AlertDialogTitle>Discard these changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You changed the template. Version {template?.id ? "3 stays active and keeps sending" : "stays as draft"} exactly as it is today. Nothing you typed here has reached anybody.
          </AlertDialogDescription>
          <div className="tpl-dialog-actions flex gap-3 justify-end mt-5">
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDiscardGuard(false);
                onDone?.();
              }}
              className="tpl-discard-button bg-destructive hover:bg-destructive/90"
            >
              Discard my changes
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
