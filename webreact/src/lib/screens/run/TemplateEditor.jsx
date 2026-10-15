// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.019 — TemplateEditor.jsx — React port of webui/src/lib/screens/run/TemplateEditor.svelte
// Props: { templateKey }
// Archetype: EditorPage
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Mark } from "@tiptap/core";
import EditorPage from "@/lib/components/kit/archetypes/EditorPage.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import RailSection from "@/lib/components/editor/RailSection.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/lib/components/ui/dialog.jsx";
import { api, ApiError } from "@/lib/api.js";
import FieldPicker from "@/lib/components/FieldPicker.jsx";

// Custom extension for variables as inline chips
// ★★★ FIX, 1 Oct 2026 (Part 2 Addition) — MEASURED: every stored/shipped template is Liquid
//     (`{{ name }}`) since Part 1/2's cutover (src/email/resolveTemplate.mjs's own header), but
//     this editor still rendered/inserted the OLD single-brace `{name}` — confirmed directly:
//     `previewLiquidTemplate` leaves a single-brace token as LITERAL TEXT in the rendered output
//     (LiquidJS does not recognise it as syntax at all), so a template edited and saved through
//     this editor would show a real recipient the literal string "{practiceName}" instead of their
//     practice's name. Zero real incidents only because zero tenant overrides exist in production
//     yet — the first save through this editor would have been the first to hit it.
const Variable = Mark.create({
  name: "variable",
  parseDOM: [{ tag: 'span[data-variable]' }],
  renderHTML: ({ node }) => {
    const varName = node.attrs.name || "";
    return [
      "span",
      {
        "data-variable": varName,
        // ★ the maintainer, 29 Sep 2026 — was `bg-accent-soft text-accent`, the same washed-out dead-token pair
        //   as the list table's row link (TemplateListTable1Table.jsx) — `--accent`/`--accent-
        //   foreground` are the subtle hover tint, not a readable chip color pair.
        class: "inline-flex items-center gap-1 px-2 py-1 bg-brand-soft text-brand rounded text-sm font-medium whitespace-nowrap"
      },
      `{{ ${varName} }}`
    ];
  },
  addAttributes: () => {
    return { name: { default: "" } };
  },
});

export default function TemplateEditor({ templateKey = null }) {
  // ── screen phase ─────────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);

  // ── loaded data ──────────────────────────────────────────────────────────────────────────────
  const [template, setTemplate] = useState(null);

  // ── editable state ───────────────────────────────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [textBody, setTextBody] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [formatMode, setFormatMode] = useState("rich"); // "rich" or "raw"

  // ── save/send flow ───────────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedMessage, setSavedMessage] = useState(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // ── live preview ─────────────────────────────────────────────────────────────────────────────
  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — the maintainer's own ask: "live preview through the one renderer."
  //   There was no preview at all here before this — the only way to see rendered output was
  //   "Send a test to yourself", a real send every time. Debounced so typing doesn't fire one
  //   request per keystroke; renders the CURRENT draft (subject/textBody), saved or not, through
  //   `previewLiquidTemplate` (the same renderer every real send uses).
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── variables (rail) ─────────────────────────────────────────────────────────────────────────
  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — the maintainer's own ask: "smart-field chips from each template's
  //   Zod schema." This used to fetch the GENERIC document-variable catalogue (~32 fields spanning
  //   person/booking/document/practice/subscription/client) via `api.fetchVariableCatalogue()` —
  //   "the picker's own insertable catalogue, never 'what this key needs'" (this file's own prior
  //   comment, now removed with the code it described). `template.schemaFields` (from
  //   `GET /api/growth/templates/:key`, src/routes/growthTemplates.mjs) is THIS KEY's own Zod
  //   schema fields, derived once, server-side — the correct, template-specific source.
  const fields = useMemo(() => {
    const schemaFields = template?.schemaFields ?? [];
    return schemaFields
      .slice()
      .sort((a, b) => (a.required === b.required ? a.name.localeCompare(b.name) : a.required ? -1 : 1))
      .map((f) => ({ name: f.name, label: f.name, sample: f.required ? "Required" : "Optional", why: null }));
  }, [template]);

  // ★★★ the maintainer, 1 Oct 2026 — FOUND LIVE: "every body is blank". Every shipped template's `html_body`
  //   is the literal empty string (src/email/defaultTemplates/index.mjs — confirmed for all 45;
  //   resolveTemplate.mjs:67 says so outright: "html … currently empty for all") because nothing
  //   in this product has ever sent HTML — `sendViaResend`'s own call never passes an `html` key.
  //   `textBody` is the ONLY field that has ever carried real content. This editor's two "Format"
  //   modes both rendered from `htmlBody` regardless — the TipTap rich view via setContent(htmlBody)
  //   just above, AND (bug within the bug) the "Raw HTML" textarea below, which bound `value=
  //   {htmlBody}` too, so there was no mode in which the real text was ever shown or saved: a save
  //   in "rich" mode even sent `textBody: ""` explicitly, discarding it for good. `textBody` state
  //   is now the single source of truth for both modes; `htmlBody` stays as plumbing only (every
  //   save still writes `""` to it, unchanged from today's reality — nothing downstream reads it).
  // ── TipTap editor ────────────────────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link,
      Variable,
    ],
    content: "",
    onUpdate: ({ editor }) => {
      // ★ blockSeparator keeps paragraph breaks as blank lines, the plain-text shape every
      //   shipped template's own text_body already uses (`\n\n` between paragraphs).
      setTextBody(editor.getText({ blockSeparator: "\n\n" }));
    },
  });

  // Update editor content when textBody changes externally (loading a template, activating a
  // different version) — converted to one <p> per line so TipTap has something to parse; this is
  // a plain-text document wearing a rich-text editor, not real HTML authoring.
  useEffect(() => {
    if (editor && editor.getText({ blockSeparator: "\n\n" }) !== textBody) {
      const html = textBody
        .split(/\n\n+/)
        .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
        .join("");
      editor.commands.setContent(html || "<p></p>");
    }
  }, [editor, textBody]);

  // ── Live preview (debounced) ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!template?.key || !subject.trim() || !textBody.trim()) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewTemplateDraft(template.key, subject, textBody);
        if (!cancelled) { setPreview(result); setPreviewError(null); }
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(err instanceof ApiError ? err.message : String(err?.message ?? err));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [template?.key, subject, textBody]);

  // ── Load template on mount ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        setPhase("loading");
        setLoadError(null);
        if (templateKey) {
          const data = await api.getTemplate(templateKey);
          setTemplate(data);
          const activeVersion = data.versions?.find((v) => v.active);
          if (activeVersion) {
            setSubject(activeVersion.subject || "");
            setTextBody(activeVersion.textBody || "");
            setHtmlBody(activeVersion.htmlBody || "");
          }
        }
        setPhase("ready");
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setPhase("denied");
        } else {
          setPhase("error");
          setLoadError(err);
        }
      }
    };
    load();
  }, [templateKey]);

  // ── Compute active version ───────────────────────────────────────────────────────────────────
  const activeVersion = useMemo(
    () => template?.versions?.find((v) => v.active) || null,
    [template]
  );

  // ── Find variables in content ────────────────────────────────────────────────────────────────
  // ★ `htmlBody` dropped from this scan — it is always "" (see the editor's own header note) and
  //   `textBody` is the only field a variable can actually appear in.
  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — `{{ name }}` Liquid syntax (every stored/shipped
  //   template has used this since Part 1/2's cutover); was single-brace `{name}`, matching
  //   nothing real and silently reporting every required variable as missing. Same regex shape as
  //   src/routes/growthTemplates.mjs's own VAR_TOKEN_RE, kept in sync by hand (this is a display-
  //   only "what did you reference" scan, not an enforcement path — the backend's own schema
  //   validation at render time is what actually matters for correctness).
  const foundVars = useMemo(() => {
    const combined = subject + textBody;
    const matches = Array.from(combined.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/g), (m) => m[1]);
    return new Set(matches);
  }, [subject, textBody]);

  // ── Find missing variables ──────────────────────────────────────────────────────────────────
  // ★★★ the maintainer, 1 Oct 2026 — FOUND LIVE the moment "Variables 0" got fixed: this used to check every
  //   template's body against the WHOLE document merge-field catalogue (`fields`, ~32 entries
  //   spanning person/booking/document/practice/subscription/client) — so every single template,
  //   including ones that use none of those names, showed a wall of "{person.role} is required"
  //   style errors. `fields` is the picker's own insertable catalogue, never "what this key needs".
  //   `required` (from GET /api/growth/templates/:key, growthTemplates.mjs) is the real,
  //   template-specific list `createTemplateVersion` actually enforces at save time — today only
  //   `auth.client_invite` declares one (`["acceptUrl"]`). Checking against anything wider was
  //   never correct; it only went unnoticed because `fields` was always `[]` before that fix, so
  //   this box never had anything to show.
  const missingVars = useMemo(
    () => (template?.required ?? []).filter((v) => !foundVars.has(v)),
    [template, foundVars]
  );

  // ── Save as new version ──────────────────────────────────────────────────────────────────────
  const handleSaveAsNewVersion = useCallback(async () => {
    if (!template || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // ★ textBody is the one field with real content, in BOTH format modes now (see the editor's
      //   own header note) — so it is what gets saved regardless of which view was open last.
      //   htmlBody stays "" on every save, matching every shipped template today.
      const result = await api.createTemplateVersion({
        key: template.key,
        subject,
        htmlBody: "",
        textBody,
      });
      setSavedMessage(`Saved version ${result.version}`);
      // Reload template
      const reloaded = await api.getTemplate(template.key);
      setTemplate(reloaded);
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [template, saving, subject, textBody]);

  // ── Activate a version ───────────────────────────────────────────────────────────────────────
  const handleActivateVersion = useCallback(async (version) => {
    if (!template) return;
    try {
      await api.activateTemplate(template.key, version);
      // Reload template
      const reloaded = await api.getTemplate(template.key);
      setTemplate(reloaded);
      const activeVer = reloaded.versions?.find((v) => v.active);
      if (activeVer) {
        setSubject(activeVer.subject || "");
        setTextBody(activeVer.textBody || "");
        setHtmlBody(activeVer.htmlBody || "");
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    }
  }, [template]);

  // ── Reset to default ─────────────────────────────────────────────────────────────────────────
  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — the maintainer's own ask ("reset to default"); there was no route or
  //   button for it before this (src/routes/growthTemplates.mjs's new resetToDefault). Stored
  //   versions are kept as history — this only deactivates, it never deletes.
  const [resetting, setResetting] = useState(false);
  const handleResetToDefault = useCallback(async () => {
    if (!template || resetting) return;
    setResetting(true);
    setSaveError(null);
    try {
      await api.resetTemplateToDefault(template.key);
      const reloaded = await api.getTemplate(template.key);
      setTemplate(reloaded);
      const activeVer = reloaded.versions?.find((v) => v.active);
      setSubject(activeVer?.subject || "");
      setTextBody(activeVer?.textBody || "");
      setHtmlBody(activeVer?.htmlBody || "");
      setSavedMessage("Reset to the shipped default");
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }, [template, resetting]);

  // ── Test send ────────────────────────────────────────────────────────────────────────────────
  const handleTestSend = useCallback(async () => {
    if (!template || !activeVersion || sendingTest) return;
    setSendingTest(true);
    setSaveError(null);
    try {
      const result = await api.testSendTemplate(template.key, activeVersion.v);
      setSavedMessage(`Test sent to ${result.to}`);
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSendingTest(false);
    }
  }, [template, activeVersion, sendingTest]);

  // ── Insert field variable ────────────────────────────────────────────────────────────────────
  // ★ FIX, 1 Oct 2026 (Part 2 Addition) — `{{ name }}` Liquid syntax, not single-brace (see this
  //   file's own header note on the Variable mark for the measured bug this closes).
  const handleFieldInsert = useCallback((fieldName) => {
    const varText = `{{ ${fieldName} }}`;
    if (formatMode === "rich" && editor) {
      // Insert into TipTap editor
      editor.commands.insertContent(varText);
    } else {
      // Insert into textarea
      const start = document.querySelector("textarea[name='textBody']")?.selectionStart || 0;
      const end = document.querySelector("textarea[name='textBody']")?.selectionEnd || 0;
      const before = textBody.substring(0, start);
      const after = textBody.substring(end);
      const newValue = before + varText + after;
      setTextBody(newValue);
    }
  }, [formatMode, textBody, editor]);

  // ── Toggle format mode ───────────────────────────────────────────────────────────────────────
  // ★ No conversion needed on toggle any more — `textBody` is the single source both views read
  //   from and write to (the editor's own header note explains why); the sync effect above keeps
  //   TipTap's content lined up with it automatically.
  const handleToggleFormat = useCallback((newMode) => {
    setFormatMode(newMode);
  }, []);

  // ── Render loading/error/denied states ────────────────────────────────────────────────────────
  if (phase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (phase === "denied") {
    return <ScreenState phase="denied" />;
  }

  if (phase === "error") {
    return <ErrorPanel error={loadError} />;
  }

  // ── Build header ─────────────────────────────────────────────────────────────────────────────
  const header = {
    title: template?.key || "New Template",
    // ★ the maintainer, 1 Oct 2026 — FOUND LIVE: `activeVersion?.v || 1` turns a real version NUMBER 0 (the
    //   shipped default, never edited — see getTemplate's own "v: 0" fallback below) into the
    //   STRING "1" via JS's falsy-zero, so the header read "version 1 · active" for the exact
    //   same template whose own Versions section (lower on this page) correctly said "Version 0".
    //   Two numbers for one fact, on one page. `?? ` (nullish) instead of `||`, plus a clearer
    //   word than "version 0" for the case that actually means "nobody has ever edited this".
    meta: template?.key
      ? (activeVersion
          ? (activeVersion.v === 0 ? "shipped default · active" : `version ${activeVersion.v} · active`)
          : "no active version")
      : "Create new",
    verbs: [
      { label: "Save as new version", kind: "primary", onClick: handleSaveAsNewVersion, disabled: !template || saving },
    ],
    onClose: () => {},
    dirty: false,
    objectNoun: "template",
    testId: "template-editor-header",
  };

  // ── Build rail ───────────────────────────────────────────────────────────────────────────────
  const rail = (
    <EditorRail objectNoun="template" testId="template-editor-rail">
      <RailSection
        label="This template"
        summary={template?.key || ""}
        expanded={true}
        testId="template-editor-rail-meta"
      >
        <p className="text-xs leading-[1.55] text-ink-2">{template?.key || ""}</p>
      </RailSection>

      <RailSection
        label="Variables"
        summary={`${fields.length}`}
        expanded={true}
        testId="template-editor-rail-variables"
      >
        <p className="mb-3 text-xs leading-[1.55] text-ink-2">
          Click to insert — this key's own fields. Required ones are checked at save time.
        </p>
        {fields.length === 0 ? (
          <div className="text-meta text-mute"><p className="m-0">No fields available</p></div>
        ) : (
          <FieldPicker fields={fields} onInsert={handleFieldInsert} />
        )}
      </RailSection>
    </EditorRail>
  );

  // ── Render ready state ───────────────────────────────────────────────────────────────────────
  return (
    <>
      <EditorPage header={header} rail={rail} testId="template-editor">
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* SUBJECT SECTION */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="Subject">
          <Field>
            <FieldLabel className="after:content-['*'] after:text-required after:ml-1">
              Subject line
            </FieldLabel>
            <FieldContent>
              <Input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g., Your {{ serviceName }} is tomorrow"
              />
            </FieldContent>
          </Field>
        </EditorSection>

        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* BODY SECTION */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="Body">
          <Field>
            <FieldLabel>Format</FieldLabel>
            <FieldContent>
              <div className="flex gap-3">
                <Button
                  variant={formatMode === "rich" ? "default" : "outline"}
                  onClick={() => handleToggleFormat("rich")}
                  size="sm"
                >
                  Rich text
                </Button>
                <Button
                  variant={formatMode === "raw" ? "default" : "outline"}
                  onClick={() => handleToggleFormat("raw")}
                  size="sm"
                >
                  Plain text
                </Button>
              </div>
              <p className="mt-1.5 text-xs leading-1.5 text-mute">
                {/* ★ the maintainer, 1 Oct 2026 — every email this product sends is plain text today (no
                   template has ever had a real HTML body); "Rich text" is a formatting view onto
                   the same plain-text content, not a second, independently-saved format. */}
                Switch views any time — both edit the same plain-text email; nothing here sends HTML yet.
              </p>
            </FieldContent>
          </Field>

          {/* Rich text editor or textarea */}
          <div className="mt-4 rounded-xl border border-line bg-surface p-4">
            {formatMode === "rich" ? (
              <EditorContent editor={editor} className="prose prose-sm" />
            ) : (
              <Textarea
                name="textBody"
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                placeholder="Hi {{ firstName }}..."
                className="min-h-[200px] font-mono text-sm"
              />
            )}
          </div>
        </EditorSection>

        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* LIVE PREVIEW — renders the current draft through the one renderer, sample data,  */}
        {/* no send. the maintainer's own Part 2 ask; see this file's "Live preview (debounced)" effect.  */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="Preview">
          {previewLoading && !preview ? (
            <p className="text-xs text-mute">Rendering…</p>
          ) : previewError ? (
            <div className="rounded border border-[#FCB] bg-[#FEE] py-2 px-3 text-xs text-[#C00]" role="alert">
              {previewError}
            </div>
          ) : preview ? (
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs font-medium text-mute mb-1">Subject</p>
              <p className="text-sm text-ink mb-4">{preview.subject}</p>
              <p className="text-xs font-medium text-mute mb-1">Body</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{preview.text}</p>
            </div>
          ) : (
            <p className="text-xs text-mute">Type a subject and a body to see a live preview, filled with sample data.</p>
          )}
        </EditorSection>

        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* MISSING VARIABLES WARNING */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {missingVars.length > 0 && (
          <div className="mt-5 rounded-xl border border-bad-border bg-danger-50 p-3 text-sm text-danger-700 leading-1.5">
            <strong className="block">Missing required variable{missingVars.length > 1 ? "s" : ""}:</strong>
            <ul className="mt-2 list-inside list-disc">
              {missingVars.map((varName) => (
                <li key={varName}>
                  <span className="font-medium text-danger-500">{`{{ ${varName} }}`}</span>
                  {" is required for this key — the send will refuse without it."}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* VERSIONS SECTION */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="Versions">
          {template?.versions && template.versions.length > 0 ? (
            <div className="space-y-0 border border-line rounded-lg overflow-hidden">
              {template.versions.map((version) => (
                <div
                  key={version.v}
                  className="flex items-center gap-3 p-4 border-b border-hair last:border-b-0"
                >
                  <div className="flex-1">
                    <p className="font-medium text-sm">Version {version.v}</p>
                    {version.active && (
                      <p className="text-xs text-mute mt-1">Active now</p>
                    )}
                  </div>
                  {version.active ? (
                    <span className="inline-flex items-center px-2 py-1 rounded-full border border-[#CBE7D6] bg-ok-soft text-xs font-medium text-ok">
                      Active
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleActivateVersion(version.v)}
                    >
                      Make active
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {activeVersion && activeVersion.v > 0 && (
            <div className="mt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={handleResetToDefault}
                disabled={resetting}
              >
                {resetting ? "Resetting…" : "Reset to default"}
              </Button>
              <p className="mt-1.5 text-xs text-mute">
                Turns off this practice's edit — the shipped wording sends again. Your versions stay here.
              </p>
            </div>
          )}
        </EditorSection>

        {/* ────────────────────────────────────────────────────────────────────────────── */}
        {/* TEST SEND SECTION */}
        {/* ────────────────────────────────────────────────────────────────────────────── */}
        <EditorSection title="Test send">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestSend}
            disabled={sendingTest || !activeVersion || !template}
          >
            {sendingTest ? "Sending..." : "Send a test to yourself"}
          </Button>
          <p className="mt-1.5 text-xs text-mute">
            Send a test email to your address to preview how it looks.
          </p>
        </EditorSection>
      </EditorPage>

      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {/* NOTIFICATIONS */}
      {/* ────────────────────────────────────────────────────────────────────────────── */}
      {savedMessage && (
        <div className="fixed bottom-5 right-5 rounded-lg bg-ok px-4 py-3 text-sm text-white">
          {savedMessage}
        </div>
      )}

      {saveError && (
        <div className="fixed bottom-5 right-5 rounded-lg bg-bad px-4 py-3 text-sm text-white">
          {saveError}
        </div>
      )}

      {/* Discard modal (not used in frame but mentioned in spec) */}
      {showDiscardModal && (
        <Dialog open={showDiscardModal} onOpenChange={setShowDiscardModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard these changes?</DialogTitle>
              <DialogDescription>
                You changed the subject line and two paragraphs of {template?.key}.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              Version {activeVersion?.v} stays active and keeps sending exactly as it is today. Nothing you typed here has reached anybody.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDiscardModal(false)}>
                Keep editing
              </Button>
              <Button variant="destructive" onClick={() => setShowDiscardModal(false)}>
                Discard my changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
