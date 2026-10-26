// DocsFormBuilder — form template builder screen
// Ported from webui/src/lib/screens/documents/DocsFormBuilder.svelte (734 lines)
// Built on EditorPage archetype. Data: api.fetchVariableCatalogue, /api/items/agreements,
// /api/list/documents/forms/templates, /api/documents/forms/templates, /api/documents/templates/body

import { useState, useEffect, useMemo, useCallback } from "react";
import { request, ApiError, api } from "@/lib/api.js";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Card, CardHeader, CardTitle, CardContent } from "@/lib/components/ui/card.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Separator } from "@/lib/components/ui/separator.jsx";
import EditorHeader from "@/lib/components/editor/EditorHeader.jsx";
import EditorColumn from "@/lib/components/editor/EditorColumn.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import InlineValidation from "@/lib/components/editor/InlineValidation.jsx";
import BlockerBanner from "@/lib/components/editor/BlockerBanner.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import FieldPicker from "@/lib/components/FieldPicker.jsx";
import DocsFormBuilderModal1Modal from "./DocsFormBuilderModal1Modal.jsx";

// ── THE REAL KIND VOCABULARY — from formBodySchema, src/documents/body.mjs:136-139,150-201 ──
const LEAF_KINDS = Object.freeze(["text", "textarea", "number", "date", "select", "radio", "checkbox", "signature"]);
const CONTAINER_KINDS = Object.freeze(["panel"]);
const ALL_KINDS = Object.freeze([...LEAF_KINDS, ...CONTAINER_KINDS]);
const NEEDS_OPTIONS = new Set(["select", "radio"]);

const KIND_LABEL = Object.freeze({
  text: "Short answer",
  textarea: "Long answer",
  number: "Number",
  date: "Date",
  select: "Choose one (dropdown)",
  radio: "Choose one (list)",
  checkbox: "Checkbox",
  signature: "Signature",
  panel: "Group of questions",
});

const isContainer = (kind) => CONTAINER_KINDS.includes(kind);

export default function DocsFormBuilder({
  path = null,
  params = null,
  app = null,
  onNavigate = null,
  onRefetch = null,
  testId = "docs-form-builder",
}) {
  const templateId = useMemo(() => params?.id && params.id !== "new" ? params.id : null, [params?.id]);
  const isNew = useMemo(() => !templateId, [templateId]);

  // ── State Management ─────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);
  const [record, setRecord] = useState(null);

  const [name, setName] = useState("");
  const [fields, setFields] = useState([]);
  const [baselineJSON, setBaselineJSON] = useState("");
  const [addKindDraft, setAddKindDraft] = useState("text");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [attemptedSave, setAttemptedSave] = useState(false);

  const [showDiscardGuard, setShowDiscardGuard] = useState(false);

  // ── Field Catalogue (merge fields) ───────────────────────────────────────
  const [fieldsCatalogueLoading, setFieldsCatalogueLoading] = useState(false);
  const [fieldsCatalogueError, setFieldsCatalogueError] = useState(null);
  const [fieldsCatalogue, setFieldsCatalogue] = useState([]);

  // ── Derived State ────────────────────────────────────────────────────────
  const sentInstances = useMemo(() => record?.sent_instances ?? 0, [record?.sent_instances]);
  const locked = useMemo(() => !isNew && sentInstances > 0, [isNew, sentInstances]);

  // Utilities ───────────────────────────────────────────────────────────────
  const newId = () => `f_${crypto.randomUUID()}`;

  const blankQuestion = useCallback((kind = "text") => {
    return {
      id: newId(),
      type: kind,
      label: "",
      required: isContainer(kind) ? undefined : false,
      options: NEEDS_OPTIONS.has(kind) ? [{ id: newId(), value: "", label: "" }] : undefined,
      children: isContainer(kind) ? [] : undefined,
    };
  }, []);

  const hydrateFields = useCallback((raw) => {
    return (raw ?? []).map((f) => ({
      id: newId(),
      type: f.type,
      label: f.label,
      required: f.required,
      options: Array.isArray(f.options) ? f.options.map((o) => ({ id: newId(), ...o })) : undefined,
      children: Array.isArray(f.children) ? hydrateFields(f.children) : undefined,
    }));
  }, []);

  const slugKey = (text) => {
    const s = (text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return /^[a-z]/.test(s) ? s.slice(0, 60) : (s ? `q_${s}`.slice(0, 60) : "");
  };

  const cleanOptions = (options) => {
    const seen = new Set();
    return (options ?? []).map((o, i) => {
      const base = slugKey(o.label) || `option_${i + 1}`;
      let v = base, n = 2;
      while (seen.has(v)) v = `${base}_${n++}`;
      seen.add(v);
      return { value: v, label: (o.label || "").trim() };
    });
  };

  const cleanFields = (list, used = new Set()) => {
    return (list ?? []).map((f) => {
      const base = slugKey(f.label) || "question";
      let key = base, n = 2;
      while (used.has(key)) key = `${base}_${n++}`;
      used.add(key);
      const out = { key, type: f.type, label: (f.label || "").trim() };
      if (!isContainer(f.type)) out.required = !!f.required;
      if (NEEDS_OPTIONS.has(f.type)) out.options = cleanOptions(f.options);
      if (isContainer(f.type)) out.children = cleanFields(f.children, used);
      return out;
    });
  };

  const snapshot = useCallback(() => {
    return JSON.stringify({ name, fields: cleanFields(fields) });
  }, [name, fields]);

  const dirty = useMemo(() => phase === "ready" && !saving && snapshot() !== baselineJSON, [phase, saving, snapshot, baselineJSON]);

  // ── Blockers ─────────────────────────────────────────────────────────────
  const collectBlockers = (list, out, where) => {
    (list ?? []).forEach((f, i) => {
      const label = where ? `${where} → question ${i + 1}` : `Question ${i + 1}`;
      if (!f.label || !f.label.trim()) out.push(`${label} needs a label`);
      if (NEEDS_OPTIONS.has(f.type)) {
        const opts = f.options ?? [];
        if (opts.length === 0) out.push(`${label} needs at least one option`);
        else if (opts.some((o) => !o.label || !o.label.trim())) out.push(`${label}: every option needs a label`);
      }
      if (isContainer(f.type)) {
        if (!f.children || f.children.length === 0) out.push(`${label} needs at least one question inside it`);
        else collectBlockers(f.children, out, label);
      }
    });
  };

  const blockers = useMemo(() => {
    const out = [];
    if (!name.trim()) out.push("Name");
    if (fields.length === 0) out.push("At least one question");
    else collectBlockers(fields, out, "");
    return out;
  }, [name, fields]);

  const showBlockers = useMemo(() => blockers.length > 0 && (attemptedSave || dirty), [blockers.length, attemptedSave, dirty]);

  // ── Question Editing ─────────────────────────────────────────────────────
  const addQuestion = useCallback((kind = "text") => {
    setFields((prev) => [...prev, blankQuestion(kind)]);
  }, [blankQuestion]);

  const removeQuestionAnywhere = useCallback((id) => {
    const walk = (list) => {
      const idx = list.findIndex((f) => f.id === id);
      if (idx !== -1) {
        list.splice(idx, 1);
        return true;
      }
      for (const f of list) {
        if (f.children && walk(f.children)) return true;
      }
      return false;
    };
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      walk(copy);
      return copy;
    });
  }, []);

  const changeKind = useCallback((fieldId, kind, parentId = null) => {
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndUpdate = (list) => {
        for (const f of list) {
          if (f.id === fieldId) {
            f.type = kind;
            f.required = isContainer(kind) ? undefined : (f.required ?? false);
            f.options = NEEDS_OPTIONS.has(kind)
              ? (f.options?.length ? f.options : [{ id: newId(), value: "", label: "" }])
              : undefined;
            f.children = isContainer(kind) ? (f.children ?? []) : undefined;
            return true;
          }
          if (f.children && findAndUpdate(f.children)) return true;
        }
        return false;
      };
      findAndUpdate(copy);
      return copy;
    });
  }, []);

  const addOption = useCallback((fieldId) => {
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndAdd = (list) => {
        for (const f of list) {
          if (f.id === fieldId) {
            f.options = [...(f.options ?? []), { id: newId(), value: "", label: "" }];
            return true;
          }
          if (f.children && findAndAdd(f.children)) return true;
        }
        return false;
      };
      findAndAdd(copy);
      return copy;
    });
  }, []);

  const removeOption = useCallback((fieldId, optionId) => {
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndRemove = (list) => {
        for (const f of list) {
          if (f.id === fieldId) {
            f.options = (f.options ?? []).filter((o) => o.id !== optionId);
            return true;
          }
          if (f.children && findAndRemove(f.children)) return true;
        }
        return false;
      };
      findAndRemove(copy);
      return copy;
    });
  }, []);

  const addChildQuestion = useCallback((parentId, kind = "text") => {
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndAdd = (list) => {
        for (const f of list) {
          if (f.id === parentId) {
            f.children = [...(f.children ?? []), blankQuestion(kind)];
            return true;
          }
          if (f.children && findAndAdd(f.children)) return true;
        }
        return false;
      };
      findAndAdd(copy);
      return copy;
    });
  }, [blankQuestion]);

  const updateFieldLabel = useCallback((fieldId, label) => {
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndUpdate = (list) => {
        for (const f of list) {
          if (f.id === fieldId) {
            f.label = label;
            return true;
          }
          if (f.children && findAndUpdate(f.children)) return true;
        }
        return false;
      };
      findAndUpdate(copy);
      return copy;
    });
  }, []);

  const updateOptionLabel = useCallback((fieldId, optionId, label) => {
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndUpdate = (list) => {
        for (const f of list) {
          if (f.id === fieldId && f.options) {
            const opt = f.options.find((o) => o.id === optionId);
            if (opt) {
              opt.label = label;
              return true;
            }
          }
          if (f.children && findAndUpdate(f.children)) return true;
        }
        return false;
      };
      findAndUpdate(copy);
      return copy;
    });
  }, []);

  const updateFieldRequired = useCallback((fieldId, required) => {
    setFields((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndUpdate = (list) => {
        for (const f of list) {
          if (f.id === fieldId) {
            f.required = !!required;
            return true;
          }
          if (f.children && findAndUpdate(f.children)) return true;
        }
        return false;
      };
      findAndUpdate(copy);
      return copy;
    });
  }, []);

  const reorderFields = useCallback((newList, parentId = null) => {
    setFields((prev) => {
      if (!parentId) return newList;
      const copy = JSON.parse(JSON.stringify(prev));
      const findAndUpdate = (list) => {
        for (const f of list) {
          if (f.id === parentId) {
            f.children = newList;
            return true;
          }
          if (f.children && findAndUpdate(f.children)) return true;
        }
        return false;
      };
      findAndUpdate(copy);
      return copy;
    });
  }, []);

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);

    await Promise.resolve();

    if (isNew) {
      setRecord(null);
      setName("");
      setFields([]);
      setBaselineJSON(JSON.stringify({ name: "", fields: [] }));
      setPhase("ready");
      return;
    }

    try {
      const res = await request("/api/list/documents/forms/templates");
      const row = (res?.rows ?? []).find((r) => r.id === templateId);
      if (!row) {
        setPhase("error");
        setLoadError({ message: "No such form template — it may have been deleted, or this is an old version." });
        return;
      }
      setRecord(row);
      const hydratedFields = hydrateFields(row.body?.fields);
      setName(row.name ?? "");
      setFields(hydratedFields);
      setBaselineJSON(JSON.stringify({ name: row.name ?? "", fields: cleanFields(hydratedFields) }));
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setLoadError(err);
        return;
      }
      setPhase("error");
      setLoadError(err instanceof ApiError
        ? { message: err.message, requestId: err.requestId }
        : { message: String(err?.message ?? err) });
    }
  }, [isNew, templateId, hydrateFields]);

  // Load initial data
  useEffect(() => {
    load();
  }, [templateId, load]);

  // Fetch variable catalogue
  useEffect(() => {
    const fetchFields = async () => {
      setFieldsCatalogueLoading(true);
      setFieldsCatalogueError(null);
      try {
        const result = await api.fetchVariableCatalogue();
        setFieldsCatalogue(Array.isArray(result) ? result : result?.rows || []);
      } catch (err) {
        setFieldsCatalogueError(err instanceof ApiError ? err.message : String(err?.message ?? err));
        setFieldsCatalogue([]);
      } finally {
        setFieldsCatalogueLoading(false);
      }
    };
    fetchFields();
  }, []);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSaveError = useCallback((err) => {
    if (err instanceof ApiError && err.status === 409 && err.body?.error?.detail?.field === "name") {
      setFieldErrors((prev) => ({ ...prev, name: err.message }));
      return;
    }
    if (err instanceof ApiError) {
      setSaveError({ message: err.message, requestId: err.requestId });
      return;
    }
    setSaveError({ message: "You're offline — nothing was saved. Try again when you're back." });
  }, []);

  const handleSave = useCallback(async () => {
    setAttemptedSave(true);
    if (locked || saving || blockers.length > 0) return;

    setSaving(true);
    setSaveError(null);
    setFieldErrors({});

    const body = { kind: "form", schema_version: 1, fields: cleanFields(fields) };

    try {
      if (isNew) {
        const res = await request("/api/documents/forms/templates", {
          method: "POST",
          body: { name: name.trim(), body },
        });
        onRefetch?.();
        if (res?.id) onNavigate?.(`/documents/forms/builder/${res.id}`);
      } else {
        await request("/api/documents/templates/body", {
          method: "POST",
          body: { templateId, body },
        });
        onRefetch?.();
        await load();
      }
    } catch (err) {
      handleSaveError(err);
    } finally {
      setSaving(false);
    }
  }, [locked, saving, blockers.length, fields, isNew, name, templateId, onRefetch, onNavigate, load, handleSaveError]);

  const handleClose = useCallback(() => {
    if (dirty && !showDiscardGuard) {
      setShowDiscardGuard(true);
      return;
    }
    // ★ the maintainer, 29 Sep 2026 (Docustay brief) — see DocTemplateEditor.jsx's own close() for why this no
    //   longer points at the retired generic /documents/forms/templates list.
    onNavigate?.("/documents");
  }, [dirty, showDiscardGuard, onNavigate]);

  const handleFieldInsert = useCallback((fieldName) => {
    // In DocsFormBuilder, the picker is informational — showing available merge fields.
  }, []);

  // ── Render State ─────────────────────────────────────────────────────────
  const title = useMemo(() => isNew ? (name.trim() || "New form") : (record?.name ?? "Form"), [isNew, name, record?.name]);
  const meta = useMemo(() => {
    if (isNew) return "New form — nothing can be sent until you save.";
    const n = sentInstances;
    return `Version ${record?.version ?? 1} · Sent ${n} time${n === 1 ? "" : "s"}`;
  }, [isNew, sentInstances, record?.version]);

  // ── Component Rendering ──────────────────────────────────────────────────

  // Field row component
  const FieldRow = ({ field }) => (
    <Card className="mb-2.5 rounded-control border border-line px-4 py-3.5 ring-0" data-testid={`${testId}-question-${field.id}`}>
      <CardContent className="flex flex-col gap-3 p-0">
        <div className="flex items-center gap-2.75">
          <span className="text-chevron" aria-hidden="true">⠿</span>
          <Badge variant="secondary" data-testid={`${testId}-kind-badge-${field.id}`}>
            {KIND_LABEL[field.type]}
          </Badge>
          <NativeSelect
            value={field.type}
            disabled={locked}
            onChange={(e) => changeKind(field.id, e.target.value)}
            data-testid={`${testId}-kind-${field.id}`}
          >
            {ALL_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </NativeSelect>
          {!isContainer(field.type) && (
            <div className="flex items-center gap-1.5 text-control text-ink-2">
              <Checkbox
                checked={!!field.required}
                disabled={locked}
                onCheckedChange={(v) => updateFieldRequired(field.id, v)}
                data-testid={`${testId}-required-${field.id}`}
              />
              <span>Required</span>
            </div>
          )}
          <Button
            type="button" variant="ghost" size="sm" disabled={locked}
            onClick={() => removeQuestionAnywhere(field.id)}
            data-testid={`${testId}-remove-${field.id}`}
          >Remove</Button>
        </div>

        <Field orientation="horizontal">
          <FieldLabel htmlFor={`fb-label-${field.id}`}>Question</FieldLabel>
          <FieldContent>
            <Input
              id={`fb-label-${field.id}`}
              value={field.label}
              onChange={(e) => updateFieldLabel(field.id, e.target.value)}
              disabled={locked}
              data-testid={`${testId}-label-${field.id}`}
            />
          </FieldContent>
        </Field>

        {NEEDS_OPTIONS.has(field.type) && (
          <div className="flex flex-col gap-2" data-testid={`${testId}-options-${field.id}`}>
            {(field.options ?? []).map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Input
                  value={opt.label}
                  onChange={(e) => updateOptionLabel(field.id, opt.id, e.target.value)}
                  disabled={locked}
                  placeholder="Option"
                  data-testid={`${testId}-option-${opt.id}`}
                />
                <Button
                  type="button" variant="ghost" size="sm" disabled={locked}
                  onClick={() => removeOption(field.id, opt.id)}
                  data-testid={`${testId}-option-remove-${opt.id}`}
                >Remove</Button>
              </div>
            ))}
            <Button
              type="button" variant="outline" size="sm" disabled={locked}
              onClick={() => addOption(field.id)}
              data-testid={`${testId}-option-add-${field.id}`}
            >Add option</Button>
          </div>
        )}

        {isContainer(field.type) && (
          <div className="ml-5.5 flex flex-col gap-2 border-l border-hair pl-4">
            {(field.children ?? []).length === 0 ? (
              <p className="text-meta text-mute">No questions in this group yet.</p>
            ) : (
              <FieldList list={field.children} parentField={field} />
            )}
            <Button
              type="button" variant="outline" size="sm" disabled={locked}
              onClick={() => addChildQuestion(field.id)}
              data-testid={`${testId}-child-add-${field.id}`}
            >Add a question</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Field list component
  const FieldList = ({ list, parentField = null }) => (
    <div data-testid={`${testId}-list`}>
      {list.map((field) => (
        <div key={field.id}>
          <FieldRow field={field} />
        </div>
      ))}
    </div>
  );

  // Main render
  const bodyContent = (
    <ScreenState
      phase={phase}
      error={phase === "error" ? loadError : null}
      subject="This form"
      reason={phase === "denied" ? (loadError?.message ?? null) : null}
      onNavigate={onNavigate}
    >
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
        <EditorColumn>
          {saveError && (
            <ErrorPanel error={saveError} subject="Your changes" variant="band" testId={`${testId}-save-error`} />
          )}
          {showBlockers && (
            <BlockerBanner count={blockers.length} items={blockers} testId={`${testId}-blockers`} />
          )}
          {locked && (
            <div className="mb-4 rounded-card border border-warm-border bg-warm-bg px-4 py-3 text-ui text-warn" role="status" data-testid={`${testId}-locked`}>
              This form has already been sent {sentInstances} time{sentInstances === 1 ? "" : "s"}, so it can't be
              edited here. A sent form never re-picks up a changed template — create a new version instead.
            </div>
          )}

          <EditorSection title="About this form">
            <Field orientation="horizontal">
              <FieldLabel htmlFor="fb-name">Name</FieldLabel>
              <FieldContent>
                {isNew ? (
                  <Input
                    id="fb-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={saving}
                    data-testid={`${testId}-name`}
                  />
                ) : (
                  <div className="text-ui text-ink" data-testid={`${testId}-name-static`}>{name}</div>
                )}
                <InlineValidation message={fieldErrors.name} testId={`${testId}-name-error`} />
              </FieldContent>
            </Field>
          </EditorSection>

          <EditorSection title="Questions">
            {fields.length === 0 ? (
              <EmptyState
                kind="first-run"
                icon="IconForms"
                headline="No questions yet"
                line="Add the first question this form will ask."
                testId={`${testId}-empty`}
              />
            ) : (
              <FieldList list={fields} />
            )}
            <div className="mt-3 flex items-center gap-2">
              <NativeSelect
                value={addKindDraft}
                onChange={(e) => setAddKindDraft(e.target.value)}
                disabled={locked}
                data-testid={`${testId}-add-kind`}
              >
                {ALL_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </NativeSelect>
              <Button
                type="button" variant="outline" disabled={locked}
                onClick={() => addQuestion(addKindDraft)}
                data-testid={`${testId}-add-question`}
              >Add a question</Button>
            </div>
          </EditorSection>
        </EditorColumn>
        </div>

        <aside className="w-full shrink-0 border-l border-line bg-surface px-5.5 py-6 lg:w-90 lg:overflow-auto" data-testid={`${testId}-rail`}>
          <div className="flex flex-col gap-4">
          {/* Available merge fields */}
          {fieldsCatalogueLoading ? (
            <Card>
              <CardContent data-testid={`${testId}-fields-loading`}>
                <p className="text-ui text-mute">Loading fields…</p>
              </CardContent>
            </Card>
          ) : fieldsCatalogueError ? (
            <Card>
              <CardContent data-testid={`${testId}-fields-error`} role="alert">
                <p className="text-ui text-bad">{fieldsCatalogueError}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>Available variables</CardTitle></CardHeader>
              <CardContent data-testid={`${testId}-fields-catalogue`}>
                <FieldPicker
                  fields={fieldsCatalogue}
                  onInsert={handleFieldInsert}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>How it behaves</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-ui font-medium text-ink">Sent before a first session</span>
                <span className="text-caption text-mute">With the agreement, in the same email</span>
              </div>
              <Separator />
              <div className="flex flex-col gap-0.5">
                <span className="text-ui font-medium text-ink">Answers land in their record</span>
                <span className="text-caption text-mute">Under Documents, and visible to whoever is booked with them</span>
              </div>
              <Separator />
              <div className="flex items-start gap-3">
                <span className="flex-1">
                  <span className="block text-ui font-medium text-ink">Not required to book</span>
                  <span className="block text-caption text-mute">
                    Turning that on would stop someone booking at 11pm because they couldn't face six questions
                  </span>
                </span>
                <Switch
                  checked={false}
                  disabled
                  aria-label="Not required to book — the template's default, shown here, set per item"
                  data-testid={`${testId}-hold-toggle`}
                />
              </div>
            </CardContent>
          </Card>
          </div>
        </aside>
      </div>
    </ScreenState>
  );

  return (
    <div className="flex h-full flex-col" data-testid={testId} data-mode={isNew ? "new" : "populated"} data-phase={phase}>
      <EditorHeader
        title={title}
        meta={meta}
        verbs={[{
          label: "Save",
          kind: "primary",
          onClick: handleSave,
          disabled: saving || locked || blockers.length > 0
        }]}
        onClose={handleClose}
        dirty={dirty}
        objectNoun="form"
        testId={`${testId}-header`}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {bodyContent}
      </div>

      <DocsFormBuilderModal1Modal
        showDiscardGuard={showDiscardGuard}
        onOpenChange={setShowDiscardGuard}
        handleClose={handleClose}
        testId={`${testId}-modal`}
      />
    </div>
  );
}
