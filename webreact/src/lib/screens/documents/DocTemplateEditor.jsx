// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.014 — DocTemplateEditor.jsx. REBUILT 29 Sep 2026 per the maintainer's Square Contracts critique: "It's
// built like a settings form, not a document." A white page is now the hero — a TipTap rich editor
// bound to contractBodySchema via contractDoc.js's mapping — with a title typed in place, a "/"
// menu (SlashMenu.jsx, cmdk) for headings/fields/clauses, and everything else (who signs, document
// type, re-sign, subscription) moved into a three-tab side panel (Fields · Clauses · Settings).
// There is no separate "New template" screen any more — this same component renders a blank page
// with a dismissible Blank/Coaching-agreement strip when `isNew`.
// Props: { path, params, app, onNavigate, onRefetch, onPreview }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useId, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { request, ApiError } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { VARIABLES } from "@keystone/documents/variableCatalogue.mjs";

import EditorPage from "@/lib/components/kit/archetypes/EditorPage.jsx";
import FieldPicker, { plainFields } from "@/lib/components/FieldPicker.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/lib/components/ui/tabs.jsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/lib/components/ui/dropdown-menu.jsx";
import { Ellipsis } from "lucide-react";

import DocsAIDraft from "./DocsAIDraft.jsx";
import DocsPublish from "./DocsPublish.jsx";
import { listPlans, labelOptions as loadLabelOptions } from "@/lib/documents/ports.js";
import { VariableChip, createSlashCommand } from "./editorExtensions.js";
import { mountSlashMenu, dispatchToMenu } from "./SlashMenu.jsx";
import {
  sectionsToTiptapDoc, assembleContractBody, signersFromSections, docWithoutExcludedSections,
} from "./contractDoc.js";
import ContentOutline from "./ContentOutline.jsx";

// ★ The seven real parties a section (or a signature block) may be owned by — SECTION_OWNERS in
//   src/documents/body.mjs, restated here because the client cannot import a node module (that
//   file pulls in http/errors.mjs → node:crypto). 'both' is excluded there for the same reason
//   sign.jsx's own ROLE_LABEL excludes it: you cannot ask "both" to sign.
const SIGNER_ROLES = ["client", "pir", "parent", "coach", "consultant", "familyMember", "recipient"];
const SIGNER_LABEL = { pir: "Person in recovery", parent: "Parent", coach: "Coach", client: "Client", consultant: "Consultant", familyMember: "Family member", recipient: "Recipient" };

const placeholderContractBody = () => ({
  kind: "contract", schema_version: 1,
  sections: [{ key: "agreement", title: "Agreement", owner: "client", requires_signature: false,
    blocks: [{ type: "prose", text: "" }] }],
});

export default function DocTemplateEditor({
  path = null, params = null, app = null, onNavigate = null, onRefetch = null, onPreview = null,
}) {
  const uid = useId();
  const routeId = useMemo(() => (params?.id && params.id !== "new" ? params.id : null), [params?.id]);
  const [currentId, setCurrentId] = useState(routeId);
  useEffect(() => { setCurrentId(routeId); }, [routeId]);
  const isNew = !currentId;

  const rank = app?.nav?.rank ?? null;
  const canEdit = useMemo(() => RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("coach"), [rank]);
  const selfId = app?.me?.appUserId ?? null;

  const [phase, setPhase] = useState("loading");
  const [loadError, setLoadError] = useState(null);

  const [builder, setBuilder] = useState("contract");
  const [loadedName, setLoadedName] = useState("");
  const [loadedBody, setLoadedBody] = useState(null);
  const [version, setVersion] = useState(1);
  const [active, setActive] = useState(true);
  const [instances, setInstances] = useState(0);
  const [sentInstances, setSentInstances] = useState(0);

  const [name, setName] = useState("");
  // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 — the Details step (migration 0539).
  //   `templateDescription` is internal ("for you"); `clientDescription`/`defaultMessage` are the
  //   defaults a document made from this template starts with, editable per send afterwards.
  const [step, setStep] = useState(isNew ? "details" : "content");
  const [templateDescription, setTemplateDescription] = useState("");
  const [clientDescription, setClientDescription] = useState("");
  const [defaultMessage, setDefaultMessage] = useState("");
  const [baselineJson, setBaselineJson] = useState("");
  const [signers, setSigners] = useState([{ owner: "client", label: "Client signature" }]);
  const [typeId, setTypeId] = useState("");
  const [requiresParentUnder18, setRequiresParentUnder18] = useState(false);
  const [reSignMonths, setReSignMonths] = useState(null);
  const [createsSubscriptionPlanId, setCreatesSubscriptionPlanId] = useState("");
  // ★ QUEUE §4 — Documents' generic "used for" labels (empty = everyone), and the choices the host offers for them.
  const [labels, setLabels] = useState([]);
  const [labelChoices, setLabelChoices] = useState([]);
  // ★ QUEUE §23.2.8 — this template's OWN signed-copy look (empty = the practice's settings apply). Keys are signed_copy.* / certificate.* settings.
  const [signedCopy, setSignedCopy] = useState({});
  const setSc = (key, value) => setSignedCopy((cur) => { const next = { ...cur }; if (value === undefined || value === "") delete next[key]; else next[key] = value; return next; });

  const [showAiDraft, setShowAiDraft] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showStrip, setShowStrip] = useState(isNew);

  const [documentTypes, setDocumentTypes] = useState([]);
  const [signerConfigLabels, setSignerConfigLabels] = useState({});
  const [plans, setPlans] = useState([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [versionPrompt, setVersionPrompt] = useState(null);
  // ★ SAVE-SYSTEM BRIEF — `savingRef` (not just the `saving` STATE) is the actual double-click lock:
  //   a ref reads back synchronously inside the same click handler, so a second click that lands
  //   before React re-renders `disabled={saving}` onto the button still sees the lock.
  const savingRef = useRef(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const [sendTestBusy, setSendTestBusy] = useState(false);
  const [sendTestResult, setSendTestResult] = useState(null);
  const [starterBusy, setStarterBusy] = useState(false);
  const [starterError, setStarterError] = useState(null);

  const [activePanel, setActivePanel] = useState("fields");
  // ★ ITEM 8 — which outline rows (by position) are unchecked right now. Purely client-side: an
  //   excluded section is stripped from the body at save (see currentBody() below), never marked in
  //   contractBodySchema itself — re-checking it before Save costs nothing, exactly Square's own
  //   "tick box to include" behaviour for a block that might or might not ship in this version.
  const [excludedIndexes, setExcludedIndexes] = useState(() => new Set());
  // ★ F825 FIX, 30 Sep 2026 — the OLD isDirty (below) only looked at name/description/message, so
  //   typing in the body, reordering, cloning, deleting or unchecking a section (item 8) never
  //   marked the template dirty: the Save button stayed enabled-or-not for the wrong reason, the
  //   close (×) discard-guard never fired, and closing lost the work with no warning at all — found
  //   live testing item 8 tonight (see the save-system report). `bodyRevision` bumps on every TipTap
  //   transaction so the memo below re-runs; the baselines are the doc/signers AS LOADED (or as
  //   last saved), so "dirty" means "differs from what the database actually has right now."
  const [bodyRevision, setBodyRevision] = useState(0);
  const [baselineBodyJson, setBaselineBodyJson] = useState("");
  const [baselineSignersJson, setBaselineSignersJson] = useState("");

  const [clauses, setClauses] = useState([]);
  const [clausesLoading, setClausesLoading] = useState(false);
  const [clausesError, setClausesError] = useState(null);

  // ── Slash menu wiring ──────────────────────────────────────────────────────────────────────
  const menuApiRef = useRef(null);
  const menuElRef = useRef(null);
  const clausesRef = useRef(clauses);
  useEffect(() => { clausesRef.current = clauses; }, [clauses]);
  const insertClauseRef = useRef(null);

  const slashItems = useCallback((query) => {
    const q = (query || "").toLowerCase();
    // ★ F128 — each field once (no deprecated fields, no legacy aliases, no repeated label), shown by its plain label and an example
    const fieldItems = plainFields(VARIABLES)
      .filter((v) => v.label.toLowerCase().includes(q) || v.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((v) => ({ id: `field-${v.name}`, label: v.label, hint: v.sample, kind: "field", value: v }));
    const clauseItems = clausesRef.current
      .filter((c) => !c.archivedAt && c.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c) => ({ id: `clause-${c.id}`, label: c.name, hint: c.gist, kind: "clause", value: c }));
    const headingItem = "heading".includes(q) || q === ""
      ? [{ id: "heading", label: "Heading", hint: "Start a new section", kind: "heading" }]
      : [];
    return [...headingItem, ...fieldItems, ...clauseItems];
  }, []);

  // ★ FOUND LIVE — MEMOIZED, DELIBERATELY, WITH EMPTY DEPS. `useEditor`'s `extensions` array was
  //   being rebuilt inline on every render (a new `createSlashCommand(...).configure(...)` object
  //   each time), which TipTap treats as a genuinely new config and recreates the whole editor
  //   instance on every render — including the render caused by typing a single character into the
  //   title field above. Every callback closure inside stays fresh via the *Ref pattern already used
  //   for `clausesRef`/`insertClauseRef` (read through a ref at call time, not captured at creation
  //   time), so an empty dependency array is correct, not a staleness bug.
  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [2] } }),
    Placeholder.configure({ placeholder: "Write the agreement here. Type \"/\" for a heading, a field, or a clause." }),
    VariableChip,
    createSlashCommand({
      items: ({ query }) => slashItems(query),
      renderMenu: (el, props, coords) => {
        menuElRef.current = el;
        if (!menuApiRef.current) menuApiRef.current = mountSlashMenu(el);
        menuApiRef.current.render(props.items, (item) => props.command({ editor: props.editor, range: props.range, __picked: item }), coords);
      },
      destroyMenu: () => { menuApiRef.current?.destroy(); menuApiRef.current = null; },
      onKeyDown: (props) => dispatchToMenu(menuElRef.current, props.event),
    }).configure({
      suggestion: {
        char: "/",
        command: ({ editor: ed, range, props }) => {
          const item = props.__picked;
          if (!item) { ed.chain().focus().deleteRange(range).run(); return; }
          if (item.kind === "heading") {
            ed.chain().focus().deleteRange(range).insertContent({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "New section" }] }).run();
          } else if (item.kind === "field") {
            ed.chain().focus().deleteRange(range).insertContent({ type: "variableChip", attrs: { name: item.value.name, label: item.value.label } }).run();
          } else if (item.kind === "clause") {
            ed.chain().focus().deleteRange(range).run();
            insertClauseRef.current?.(item.value);
          }
        },
      },
    }),
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({ extensions, content: "", editable: canEdit });

  // ★ F825 FIX — the dirty-check's own body-revision counter (see the state declaration above).
  useEffect(() => {
    if (!editor) return;
    const bump = () => setBodyRevision((n) => n + 1);
    editor.on("update", bump);
    return () => editor.off("update", bump);
  }, [editor]);

  // ── Load fields catalogue is static (VARIABLES, imported directly — client-safe module) ──────
  const fields = VARIABLES;

  // ── Load clauses ───────────────────────────────────────────────────────────────────────────
  const loadClauses = useCallback(async () => {
    setClausesLoading(true);
    setClausesError(null);
    try {
      const res = await request("/api/documents/clauses");
      setClauses(Array.isArray(res) ? res : res?.data ?? res?.rows ?? []);
    } catch (err) {
      setClausesError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setClauses([]);
    } finally {
      setClausesLoading(false);
    }
  }, []);
  useEffect(() => { loadClauses(); }, [loadClauses]);

  // The host's label choices (programs and client types, by its own words). Empty when the host plugs nothing in.
  useEffect(() => {
    let live = true;
    loadLabelOptions().then((o) => { if (live) setLabelChoices(o); });
    return () => { live = false; };
  }, []);

  const hydrateFromRow = useCallback((row) => {
    setLoadedName(row.name ?? "");
    setLoadedBody(row.body ?? null);
    setVersion(row.version ?? 1);
    setActive(row.active !== false);
    setInstances(row.instances ?? 0);
    setSentInstances(row.sent_instances ?? 0);
    setName(row.name ?? "");
    setTemplateDescription(row.description ?? "");
    setClientDescription(row.client_description ?? "");
    setDefaultMessage(row.message ?? "");
    setSigners(row.body?.sections ? (signersFromSections(row.body.sections).length ? signersFromSections(row.body.sections) : [{ owner: "client", label: "Client signature" }]) : [{ owner: "client", label: "Client signature" }]);
    setTypeId(row.type_id ?? "");
    setRequiresParentUnder18(Boolean(row.requires_parent_under18));
    setReSignMonths(row.re_sign_months ?? null);
    setCreatesSubscriptionPlanId(row.creates_subscription_plan_id ?? "");
    setLabels(Array.isArray(row.labels) ? row.labels : []);
    setSignedCopy(row.signed_copy && typeof row.signed_copy === "object" ? row.signed_copy : {});
    // ★ F825 FIX, 30 Sep 2026 (found live, save-system test pass) — the Settings tab's OWN fields
    //   (Document type, "asks a parent too", re-sign months, attached plan) were never in this
    //   baseline at all — changing any of them left the Save button disabled (isDirty stayed false)
    //   and closing warned of nothing, exactly F825's shape, just for a different tab than the one
    //   that surfaced it originally.
    const baseline = {
      name: row.name ?? "", templateDescription: row.description ?? "",
      clientDescription: row.client_description ?? "", defaultMessage: row.message ?? "",
      typeId: row.type_id ?? "", requiresParentUnder18: Boolean(row.requires_parent_under18),
      reSignMonths: row.re_sign_months ?? null, createsSubscriptionPlanId: row.creates_subscription_plan_id ?? "",
      labels: [...(Array.isArray(row.labels) ? row.labels : [])].sort(),
      signedCopy: row.signed_copy && typeof row.signed_copy === "object" ? row.signed_copy : {},
    };
    setBaselineJson(JSON.stringify(baseline));
    setExcludedIndexes(new Set());
    const signersBaseline = row.body?.sections ? (signersFromSections(row.body.sections).length ? signersFromSections(row.body.sections) : [{ owner: "client", label: "Client signature" }]) : [{ owner: "client", label: "Client signature" }];
    setBaselineSignersJson(JSON.stringify(signersBaseline));
    if (editor) {
      const doc = row.body?.sections ? sectionsToTiptapDoc(row.body.sections) : sectionsToTiptapDoc(placeholderContractBody().sections);
      editor.commands.setContent(doc);
      // ★ F825 FIX — the baseline is the doc exactly as just loaded (setContent above is what the
      //   editor will report back from getJSON(), including TipTap's own node normalisation, so
      //   comparing against this rather than re-deriving `doc` catches no false "dirty" from that).
      setBaselineBodyJson(JSON.stringify(editor.getJSON()));
    }
  }, [editor]);

  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    setVersionPrompt(null);
    setSaveError(null);
    try {
      const [typesRes, plansRes] = await Promise.all([
        request("/api/settings/documents").catch(() => null),
        listPlans().catch(() => ({ rows: [] })),
      ]);
      setDocumentTypes(typesRes?.types ?? []);
      setSignerConfigLabels(typesRes?.vocabulary?.signer_configs ?? {});
      setPlans(Array.isArray(plansRes?.rows) ? plansRes.rows : []);

      if (isNew) {
        hydrateFromRow({ name: "", body: null, version: 1, active: true, instances: 0, sent_instances: 0 });
        setShowStrip(true);
      } else {
        const [contractsRes, formsRes] = await Promise.all([
          request("/api/list/documents/contracts/templates").catch(() => ({ rows: [] })),
          request("/api/list/documents/forms/templates").catch(() => ({ rows: [] })),
        ]);
        const inContracts = (contractsRes?.rows ?? []).find((r) => r.id === currentId);
        const inForms = (formsRes?.rows ?? []).find((r) => r.id === currentId);
        const row = inContracts ?? inForms;
        if (!row) throw new Error("no such template — it may have been retired or never existed");
        setBuilder(inContracts ? "contract" : "form");
        hydrateFromRow(row);
        setShowStrip(false);
      }
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied"); setLoadError(err);
      } else {
        setPhase("error");
        setLoadError(err instanceof ApiError ? { message: err.message, requestId: err.requestId } : { message: String(err?.message ?? err) });
      }
    }
  }, [isNew, currentId, hydrateFromRow]);

  useEffect(() => { load(); }, [load]);
  // Re-hydrate the editor content once it mounts, for the case where load() finished before the
  // TipTap instance existed (it is created synchronously by useEditor, but its `commands` are only
  // safe to call once `editor` itself is non-null — the effect above already depends on `editor`).

  const builderLabel = builder === "form" ? "Form" : "Agreement";
  const isDraft = !isNew && !active;
  const isFieldsDirty = useMemo(
    () => JSON.stringify({
      name, templateDescription, clientDescription, defaultMessage,
      typeId, requiresParentUnder18, reSignMonths, createsSubscriptionPlanId, labels: [...labels].sort(), signedCopy,
    }) !== baselineJson,
    [name, templateDescription, clientDescription, defaultMessage, typeId, requiresParentUnder18, reSignMonths, createsSubscriptionPlanId, labels, signedCopy, baselineJson]);
  // ★ F825 FIX — body/signers dirty, on the SAME "differs from what was loaded/last saved" basis as
  //   the fields above. `bodyRevision` is read only to force this memo to re-run on every keystroke,
  //   drag, clone or delete; `editor.getJSON()` is always read fresh, never from a stale closure.
  const isBodyDirty = useMemo(() => {
    if (!editor) return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return JSON.stringify(editor.getJSON()) !== baselineBodyJson;
  }, [editor, bodyRevision, baselineBodyJson]);
  const isExcludedDirty = excludedIndexes.size > 0;
  const isSignersDirty = useMemo(() => JSON.stringify(signers) !== baselineSignersJson, [signers, baselineSignersJson]);
  const isDirty = isFieldsDirty || isBodyDirty || isExcludedDirty || isSignersDirty;
  // ★ SAVE-SYSTEM BRIEF — "Saved at 2:14 PM" stays in the header after the toast fades, this
  //   session's own confirmation that the last click actually went through. This is SESSION-LOCAL
  //   (in-memory `lastSavedAt`), not the row's real `updated_at`/who-edited-it — the template list
  //   route doesn't expose either today; see the save-system report's "last edited by/at" finding.
  const headerMeta = isNew
    ? "New — nothing here is live until you publish it."
    : `${active ? "Live" : "Draft"}${lastSavedAt ? ` · Saved at ${lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`;

  const nameBlockers = useMemo(() => (name.trim() ? [] : ["Name"]), [name]);

  // ★ SAVE-SYSTEM BRIEF — FOUND LIVE testing the F825 fix: this used to check `isDirty` and show its
  //   OWN discard guard (`showDiscardGuard` / DocTemplateEditorModal1Modal below) — but `onClose` is
  //   handed to EditorHeader (via EditorPage), and EditorHeader.jsx ALREADY guards its close button on
  //   the very same `dirty` prop this screen passes it, with its own built-in DiscardGuard. The two
  //   never conflicted before because the OLD isDirty was almost always false for a body-only edit;
  //   now that isDirty is comprehensive (F825), closing a dirty template showed EditorHeader's "Discard
  //   this template?" dialog, and clicking Discard immediately showed a SECOND, identical one from
  //   here. `close` is only ever reached from EditorHeader's own onDiscard (dirty already confirmed
  //   away) or from a NOT-dirty close — either way there is nothing left to ask about.
  const close = () => {
    onNavigate?.("/documents/templates");
  };

  const applySettings = async (targetId) => {
    await request("/api/documents/templates/settings", {
      method: "POST",
      idempotencyKey: newIdempotencyKey(),
      body: {
        templateId: targetId,
        requiresParentUnder18,
        reSignMonths,
        createsSubscriptionPlanId: createsSubscriptionPlanId || null,
        typeId: typeId || null,
        description: templateDescription.trim() || null,
        clientDescription: clientDescription.trim() || null,
        message: defaultMessage.trim() || null,
        labels,
        signedCopy: Object.keys(signedCopy).length ? signedCopy : null,
      },
    });
  };

  const currentBody = useCallback(() => {
    if (!editor) return placeholderContractBody();
    const doc = docWithoutExcludedSections(editor.getJSON(), excludedIndexes);
    return assembleContractBody(doc, signers);
  }, [editor, signers, excludedIndexes]);

  const saveAsNewVersionInline = async (body) => {
    const res = await request("/api/documents/templates/version", {
      method: "POST", idempotencyKey: newIdempotencyKey(),
      body: { templateId: currentId, body, name: name.trim() },
    });
    setVersion(res.version);
    setSentInstances(0);
    await applySettings(res.id);
    setLoadedName(name.trim());
    onNavigate?.(`/documents/templates/${res.id}`);
    return res;
  };

  // ★ SAVE-SYSTEM BRIEF, 30 Sep 2026 — "Saved" (with a time) on success, a clear error that keeps
  //   what was typed on failure, both via the SAME toast channel `runAction.js` already uses
  //   elsewhere in this app. No confirm-before-save step (see the report: Square/Stripe/Linear/
  //   Notion/Google Docs and Apple/Material guidance all argue against one for a routine, reversible
  //   save — the maintainer decides whether to override that for this screen specifically).
  const finishSuccessfulSave = (savedBody) => {
    // ★ F825 FIX — the live editor still shows any section the outline unchecked (so re-checking it
    //   before Save cost nothing); once Save has actually persisted WITHOUT it, drop it from the live
    //   doc too and reset the baselines to the just-saved state, so isDirty goes false and a second
    //   Save (or Cmd+S) is a no-op until something ACTUALLY changes again.
    if (editor && excludedIndexes.size > 0) {
      editor.commands.setContent(docWithoutExcludedSections(editor.getJSON(), excludedIndexes));
      setExcludedIndexes(new Set());
    }
    if (editor) setBaselineBodyJson(JSON.stringify(editor.getJSON()));
    setBaselineSignersJson(JSON.stringify(signers));
    setBaselineJson(JSON.stringify({
      name, templateDescription, clientDescription, defaultMessage,
      typeId, requiresParentUnder18, reSignMonths, createsSubscriptionPlanId, labels: [...labels].sort(), signedCopy,
    }));
    const now = new Date();
    setLastSavedAt(now);
    toast.success("Saved", { description: `Saved at ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` });
  };

  const save = async () => {
    setAttemptedSave(true);
    if (nameBlockers.length) return;
    if (savingRef.current) return; // double-click / double Cmd+S lock
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setVersionPrompt(null);
    try {
      const body = currentBody();
      if (isNew) {
        const createPath = builder === "form" ? "/api/documents/forms/templates" : "/api/documents/contracts/templates";
        const created = await request(createPath, {
          method: "POST", idempotencyKey: newIdempotencyKey(),
          body: { name: name.trim(), body, sellsType: "none" },
        });
        await applySettings(created.id);
        toast.success("Created", { description: "The template was created." });
        onNavigate?.(`/documents/templates/${created.id}`);
        return;
      }
      const nameChanged = name.trim() !== loadedName;
      if (nameChanged) {
        await saveAsNewVersionInline(body);
      } else {
        try {
          await request("/api/documents/templates/body", {
            method: "POST", idempotencyKey: newIdempotencyKey(),
            body: { templateId: currentId, body },
          });
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            setVersionPrompt({ message: err.message, requestId: err.requestId, requiredVersion: err.body?.error?.detail?.requiredVersion ?? version + 1 });
            // ★ Not a toast — this is a decision the person must make (versionPromptBanner), not a
            //   failure to be dismissed; a generic "Couldn't save" toast alongside it would say less
            //   than the banner already does and could read as though the choice had failed too.
            return;
          }
          throw err;
        }
        await applySettings(currentId);
      }
      finishSuccessfulSave(body);
      onRefetch?.();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err?.message ?? err);
      setSaveError(err instanceof ApiError ? { message: err.message, requestId: err.requestId } : { message });
      toast.error("Couldn't save", { description: `${message} — nothing you typed was lost.` });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const saveAsNewVersion = async () => {
    if (savingRef.current) return undefined;
    savingRef.current = true;
    setSaving(true); setSaveError(null);
    try {
      const res = await saveAsNewVersionInline(currentBody());
      setVersionPrompt(null);
      finishSuccessfulSave();
      return res;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err?.message ?? err);
      setSaveError(err instanceof ApiError ? { message: err.message, requestId: err.requestId } : { message });
      toast.error("Couldn't save", { description: `${message} — nothing you typed was lost.` });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // ★ SAVE-SYSTEM BRIEF — Cmd/Ctrl+S saves (a no-op if there's nothing to save or a save is already
  //   running). `saveFnRef` — same *Ref pattern this file already uses for `clausesRef`/`insertClauseRef`:
  //   `save` is a plain function redefined every render (not memoized), so the listener below reads
  //   it through a ref updated on every render rather than closing over whichever `save` existed when
  //   the effect last re-ran — the exact stale-closure class this file's own history warns about.
  const saveFnRef = useRef(save);
  saveFnRef.current = save;
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit && isDirty && !savingRef.current) saveFnRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, isDirty]);
  // ★ No separate beforeunload effect here — EditorHeader.jsx (mounted by EditorPage below, via the
  //   `dirty: isDirty` passed in `header={{...}}`) already installs one bound to the same `isDirty`.
  //   A second, identical listener here would just double-fire the same browser confirmation.

  const sendTest = async () => {
    if (!selfId || !currentId) return;
    setSendTestBusy(true); setSendTestResult(null);
    try {
      await request("/api/documents/send", { method: "POST", idempotencyKey: newIdempotencyKey(), body: { personId: selfId, template: currentId } });
      setSendTestResult({ ok: true });
    } catch (err) {
      setSendTestResult({ ok: false, message: err instanceof ApiError ? err.message : String(err?.message ?? err), requestId: err instanceof ApiError ? err.requestId : null });
    } finally {
      setSendTestBusy(false);
    }
  };

  const startFromCoachingAgreement = async () => {
    setStarterBusy(true); setStarterError(null);
    try {
      const result = await request("/api/documents/starters", { method: "POST", idempotencyKey: newIdempotencyKey(), body: { key: "coaching-agreement" } });
      onNavigate?.(`/documents/templates/${result.templateId}`);
    } catch (err) {
      setStarterError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setStarterBusy(false);
    }
  };

  // ── Insert a clause: PERSISTED, server-side (insertClause already exists — it inserts a whole
  //   new SECTION into the template body at a position). Only offered once the template is saved
  //   at least once (it needs a real templateId); before that, dismiss the strip and Save first.
  const insertClauseNow = useCallback(async (clause) => {
    if (!currentId) {
      setSaveError({ message: "Save this template once before adding a clause from the library." });
      return;
    }
    try {
      const currentSections = editor ? assembleContractBody(editor.getJSON(), []).sections : [];
      await request("/api/documents/clauses/insert", {
        method: "POST", idempotencyKey: newIdempotencyKey(),
        body: { templateId: currentId, clauseId: clause.id, position: currentSections.length, owner: "client", requiresSignature: false },
      });
      await load();
    } catch (err) {
      setSaveError({ message: err instanceof ApiError ? err.message : String(err?.message ?? err) });
    }
  }, [currentId, editor, load]);
  useEffect(() => { insertClauseRef.current = insertClauseNow; }, [insertClauseNow]);

  // ── Verify onPreview is wired (unchanged guard from before this rebuild) ──────────────────────
  useEffect(() => {
    if (phase !== "ready") return;
    if (typeof onPreview !== "function") {
      throw new Error("DocTemplateEditor: onPreview is required once the editor is ready — \"Preview\" must always be wired to a real action (14.72's DocPreview), never drawn dead.");
    }
  }, [phase, onPreview]);

  const toggleSigner = (owner) => {
    setSigners((prev) => (prev.some((s) => s.owner === owner)
      ? prev.filter((s) => s.owner !== owner)
      : [...prev, { owner, label: `${SIGNER_LABEL[owner]} signature` }]));
  };

  const selectedType = documentTypes.find((t) => t.id === typeId) ?? null;
  const signerConfigSentence = selectedType ? (signerConfigLabels[selectedType.signer_config] ?? selectedType.signer_config) : "";

  // ★ FOUND LIVE — this was `useMemo(..., [isNew, canEdit, sendTestBusy, selfId, saving, currentId,
  //   onNavigate, onPreview])`, which does NOT list `typeId`/`signers`/`name`/etc — every value
  //   `save()` actually closes over. Changing a Settings-tab field then clicking Save called a STALE
  //   closure of `save` from whenever this memo last recomputed (e.g. right after load), silently
  //   persisting the OLD values — measured directly: the Document Type picked in the UI never
  //   reached the database. Building this small array fresh on every render is cheap enough that the
  //   memoization bought nothing but this bug; removing it removes the whole stale-closure class.
  // ★ SQUARE CONTRACTS OVERHAUL PART 2 — the main button is "Next" on the Details step (moves to
  //   Content, no write yet) and "Save"/"Create" on Content, exactly as the maintainer specified. Same
  //   no-stale-closure reasoning as the comment above: computed fresh every render, not memoized.
  const headerVerbs = (() => {
    const verbs = [{ label: "Preview", kind: "plain", onClick: () => onPreview?.(currentId), disabled: isNew }];
    if (canEdit) {
      if (!isNew) {
        verbs.push({ label: "Write with AI", kind: "plain", overflowOnly: true, onClick: () => setShowAiDraft(true) });
        verbs.push({ label: "Check it", kind: "plain", overflowOnly: true, onClick: () => onNavigate?.(`/documents/templates/${currentId}/check`) });
        verbs.push({ label: "Send a test", kind: "plain", overflowOnly: true, onClick: sendTest, disabled: sendTestBusy || !selfId });
      }
      if (step === "details") {
        verbs.push({ label: "Next", kind: "primary", onClick: () => setStep("content"), disabled: nameBlockers.length > 0 });
      } else {
        // ★ SAVE-SYSTEM BRIEF — "Save only lights up when something changed": gated on `isDirty` for
        //   an EXISTING template (nothing to save otherwise); a brand-new one stays clickable even
        //   empty — "Create" makes a real, deliberate first row, it is not "save what changed".
        verbs.push({ label: isNew ? "Create" : "Save", kind: "primary", onClick: save, disabled: saving || (!isNew && !isDirty) });
      }
    }
    return verbs;
  })();

  const readOnlyNotice = !canEdit ? (
    <p className="m-0 bg-chip-neutral-bg px-11 py-4 text-chip-neutral-ink text-sm" data-testid="tpl-editor-readonly-notice">
      You can view this template. Editing is done by an owner, admin, or a coach with authoring access.
    </p>
  ) : null;

  const draftBanner = isDraft ? (
    <div className="flex items-center gap-3 bg-chip-neutral-bg px-11 py-4" data-testid="tpl-editor-draft-banner">
      <p className="m-0 flex-1 text-sm text-chip-neutral-ink">Nothing here is live until you publish it.</p>
      {canEdit && <Button type="button" size="sm" onClick={() => setShowPublish(true)} data-testid="tpl-editor-publish">Publish</Button>}
    </div>
  ) : null;

  const blockerBanner = attemptedSave && nameBlockers.length > 0 ? { count: nameBlockers.length, items: nameBlockers, testId: "tpl-editor-blocker" } : null;

  const versionPromptBanner = versionPrompt ? (
    <div className="px-11 pt-4" data-testid="tpl-editor-version-prompt" role="alert">
      <div className="rounded-lg border border-chip-warn-bg bg-chip-warn-bg p-5 text-chip-warn-ink flex flex-col gap-4">
        <p className="m-0 text-sm leading-relaxed" data-testid="tpl-editor-version-prompt-message">This template has been sent, so it can't be changed in place. Save your changes as version {versionPrompt.requiredVersion} — anything already sent keeps the wording it was sent with.</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={saving} onClick={saveAsNewVersion} data-testid="tpl-editor-save-as-version">Save as version {versionPrompt.requiredVersion}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setVersionPrompt(null)} data-testid="tpl-editor-version-prompt-dismiss">Keep editing</Button>
        </div>
      </div>
    </div>
  ) : null;

  const saveErrorBanner = saveError ? (
    <div className="px-11 pt-4"><ErrorPanel error={saveError} subject="Saving this template" variant="band" testId="tpl-editor-save-error" /></div>
  ) : null;

  const sendTestResultBanner = sendTestResult ? (
    <div className="px-11 pt-4" data-testid="tpl-editor-send-test-result">
      {sendTestResult.ok
        ? <p className="m-0 rounded-lg bg-chip-ok-bg px-5 py-3 text-sm text-chip-ok-ink">Sent — check the inbox for the account you're signed in with.</p>
        : <ErrorPanel error={sendTestResult} subject="Sending a test" variant="band" testId="tpl-editor-send-test-error" />}
    </div>
  ) : null;

  if (phase === "loading" || phase === "error" || phase === "denied") {
    return <ScreenState phase={phase} error={loadError} subject="This template" onRetry={load} testIds={{}} />;
  }

  // ── The white page ───────────────────────────────────────────────────────────────────────────
  const strip = showStrip && canEdit ? (
    <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-7 py-2.5" data-testid="tpl-new-strip">
      <span className="text-meta text-mute">Start from:</span>
      <Button type="button" variant="outline" size="sm" onClick={() => setShowStrip(false)} data-testid="tpl-strip-blank">Blank</Button>
      <Button type="button" variant="outline" size="sm" disabled={starterBusy} onClick={startFromCoachingAgreement} data-testid="tpl-strip-coaching">
        {starterBusy ? "Starting…" : "Coaching agreement"}
      </Button>
      {starterError && <span className="text-meta text-bad">{starterError}</span>}
      <button type="button" className="ml-auto text-meta text-mute underline" onClick={() => setShowStrip(false)} data-testid="tpl-strip-dismiss">Dismiss</button>
    </div>
  ) : null;

  // ★ SQUARE CONTRACTS OVERHAUL PART 2 — "A stepper under the title: Details › Content."
  const stepper = (
    <div className="mb-6 flex items-center justify-center gap-2" data-testid="tpl-stepper">
      {[["details", "Details"], ["content", "Content"]].map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setStep(key)}
          data-testid={`tpl-stepper-${key}`}
          aria-current={step === key ? "step" : undefined}
          className={`rounded-full px-4 py-1.5 text-meta font-medium ${step === key ? "bg-ink text-surface" : "text-mute hover:bg-paper"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const detailsRow = (label, value, onChange, { placeholder = "", testId, textarea = false } = {}) => (
    <div className="grid grid-cols-[160px_1fr] border-b border-line-soft" key={testId}>
      <div className="flex items-center bg-surface-sunken px-4 py-3 text-meta text-mute">{label}</div>
      <div className="px-4 py-2.5">
        {textarea ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={!canEdit}
            rows={3}
            data-testid={testId}
            className="w-full resize-none border-0 bg-transparent text-ui text-ink shadow-none focus:outline-none"
          />
        ) : (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={!canEdit}
            data-testid={testId}
            className="border-0 bg-transparent px-0 text-ui text-ink shadow-none focus-visible:ring-0"
          />
        )}
      </div>
    </div>
  );

  const detailsStep = (
    <div className="mx-auto flex w-full max-w-160 flex-col gap-8" data-testid="tpl-details-step">
      <section>
        <h2 className="mb-3 text-caption font-medium uppercase tracking-wide text-mute">For you</h2>
        <div className="overflow-hidden rounded-card border border-line">
          {/* ★ The template's own name is the big centred title above the stepper, shared by both
              steps — no separate "template name" row here would just duplicate it. */}
          {detailsRow("Template description", templateDescription, setTemplateDescription, { placeholder: "Why this template exists — never shown to a client", testId: "tpl-details-description", textarea: true })}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-caption font-medium uppercase tracking-wide text-mute">For the client</h2>
        <p className="mb-3 -mt-1 text-meta text-mute">The document's own name is the title above — the same one, editable per send.</p>
        <div className="overflow-hidden rounded-card border border-line">
          {detailsRow("Description", clientDescription, setClientDescription, { placeholder: "What the client sees on the document", testId: "tpl-details-client-description", textarea: true })}
          {detailsRow("Message", defaultMessage, setDefaultMessage, { placeholder: "The body of the email they get", testId: "tpl-details-message", textarea: true })}
        </div>
      </section>
    </div>
  );

  const page = (
    <div className="mx-auto flex h-full max-w-160 flex-col">
      <Input
        value={name}
        onChange={(e) => { setName(e.target.value); setShowStrip(false); }}
        onFocus={() => setShowStrip(false)}
        placeholder="Untitled agreement"
        disabled={!canEdit}
        data-testid="tpl-name-input"
        className="mb-1 border-0 px-0 text-center text-page-title font-medium text-ink shadow-none focus-visible:ring-0"
      />
      {stepper}
      {attemptedSave && nameBlockers.includes("Name") && <p className="mb-3 text-meta text-bad" data-testid="tpl-name-error">A template needs a name.</p>}
      {/* ★ ITEM 10 — the Details↔Content slide the maintainer asked for: a plain horizontal cross-fade, keyed by
          step, direction determined by which step is numerically "further along". */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: step === "content" ? 24 : -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: step === "content" ? -24 : 24 }}
          transition={{ duration: 0.18 }}
          className="flex flex-1 min-h-0 flex-col"
        >
          {step === "details" ? detailsStep : (
            <>
              <ContentOutline editor={editor} canEdit={canEdit} excludedIndexes={excludedIndexes} setExcludedIndexes={setExcludedIndexes} signers={signers} />
              <div className="flex-1 rounded-card border border-line bg-surface p-9 shadow-phone" data-testid="tpl-body-editor">
                <EditorContent editor={editor} className="prose prose-sm max-w-none focus:outline-none" data-testid="tpl-tiptap" />
              </div>
              {signers.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-4 text-meta text-mute" data-testid="tpl-signature-preview">
                  {signers.map((s) => (
                    <span key={s.owner} className="rounded border border-dashed border-line px-3 py-1.5">{s.label}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const sidePanel = (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface" data-testid="tpl-side-panel">
      <Tabs value={activePanel} onValueChange={setActivePanel} className="flex h-full flex-col">
        <TabsList className="w-full justify-start rounded-none border-b border-line bg-transparent px-3">
          <TabsTrigger value="fields" data-testid="tpl-panel-tab-fields">Fields</TabsTrigger>
          <TabsTrigger value="clauses" data-testid="tpl-panel-tab-clauses">Clauses</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tpl-panel-tab-settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="fields" className="flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-meta text-mute">Click to insert. Type "/" in the document for the same list.</p>
          <FieldPicker
            fields={fields}
            onInsert={(fieldName) => {
              const f = fields.find((x) => x.name === fieldName);
              if (!f || !editor) return;
              editor.chain().focus().insertContent({ type: "variableChip", attrs: { name: f.name, label: f.label } }).run();
            }}
          />
        </TabsContent>
        <TabsContent value="clauses" className="flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-meta text-mute">Click to add to the end of this document.</p>
          {clausesLoading ? <p className="text-meta text-mute">Loading…</p>
            : clausesError ? <ErrorPanel error={{ message: clausesError }} subject="Clauses" variant="band" />
            : clauses.length === 0 ? <p className="text-meta text-mute">No clauses yet — write one from Documents → Clauses.</p>
            : (
              <div className="flex flex-col gap-1.5" data-testid="tpl-clause-list">
                {clauses.filter((c) => !c.archivedAt).map((c) => (
                  <button key={c.id} type="button" className="rounded-sm px-2 py-1.5 text-left hover:bg-paper" onClick={() => insertClauseNow(c)} data-testid={`tpl-clause-${c.id}`}>
                    <span className="block text-ui text-ink">{c.name}</span>
                    <span className="block text-meta text-mute">{c.gist}</span>
                  </button>
                ))}
              </div>
            )}
        </TabsContent>
        <TabsContent value="settings" className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            <div>
              <FieldLabel className="mb-2 block text-sm font-normal text-ink-muted">Who signs</FieldLabel>
              <div className="flex flex-col gap-2">
                {SIGNER_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={signers.some((s) => s.owner === role)} onChange={() => toggleSigner(role)} disabled={!canEdit} data-testid={`tpl-signer-${role}`} />
                    {SIGNER_LABEL[role]}
                  </label>
                ))}
              </div>
              {signers.length === 0 && <p className="mt-1.5 text-meta text-bad">Nobody is set to sign this yet.</p>}
            </div>

            <Field data-testid="tpl-type-field">
              <FieldLabel htmlFor={`${uid}-type`} className="text-sm font-normal text-ink-muted">Document type<span className="text-ink-faint text-xs ml-1">optional</span></FieldLabel>
              <FieldContent>
                <NativeSelect id={`${uid}-type`} value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!canEdit} data-testid="tpl-type-select">
                  <option value="">—</option>
                  {documentTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </NativeSelect>
                {signerConfigSentence && <p className="mt-1.5 text-xs text-ink-muted" data-testid="tpl-type-signer-sentence">Signs as: {signerConfigSentence}</p>}
              </FieldContent>
            </Field>

            <div data-testid="tpl-labels-field">
              <FieldLabel className="mb-2 block text-sm font-normal text-ink-muted">Used for</FieldLabel>
              {labelChoices.length === 0 && labels.length === 0 ? (
                <p className="m-0 text-xs text-ink-muted" data-testid="tpl-labels-everyone">Everyone.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {[...new Set([...labelChoices.map((o) => o.group ?? ""), ...(labels.some((l) => !labelChoices.some((o) => o.key === l)) ? ["Other"] : [])])].map((group) => {
                    const opts = group === "Other"
                      ? labels.filter((l) => !labelChoices.some((o) => o.key === l)).map((l) => ({ key: l, label: l, group }))
                      : labelChoices.filter((o) => (o.group ?? "") === group);
                    return (
                      <div key={group || "none"} className="flex flex-col gap-1.5">
                        {group && <span className="text-meta text-mute">{group}</span>}
                        {opts.map((o) => (
                          <label key={o.key} className="flex items-center gap-2 text-sm text-ink">
                            <input type="checkbox" checked={labels.includes(o.key)} disabled={!canEdit}
                              onChange={() => setLabels((cur) => (cur.includes(o.key) ? cur.filter((x) => x !== o.key) : [...cur, o.key]))}
                              data-testid={`tpl-label-${o.key}`} />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                  <p className="m-0 text-xs text-ink-muted" data-testid="tpl-labels-hint">
                    {labels.length === 0 ? "Everyone — tick to limit who this is suggested for." : "Suggested for these people. It can still be sent to anyone."}
                  </p>
                </div>
              )}
            </div>

            <div data-testid="tpl-signed-copy-field">
              <FieldLabel className="mb-2 block text-sm font-normal text-ink-muted">Signed copy for this template<span className="text-ink-faint text-xs ml-1">optional</span></FieldLabel>
              <p className="m-0 mb-2 text-xs text-ink-muted">Leave a choice on "Practice default" to use Documents → Settings. Anything you change here applies only to documents made from this template.</p>
              <div className="grid gap-2 md:grid-cols-2">
                {[["signed_copy.letterhead", "Letterhead", "tri"], ["certificate.enabled", "Certificate of completion", "tri"], ["signed_copy.signature_style", "Signature style", ["both", "drawn", "typed"]], ["signed_copy.font", "Font", ["helvetica", "times", "inter"]]].map(([key, label, kind]) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-sm text-ink">
                    <span>{label}</span>
                    <NativeSelect value={key in signedCopy ? (kind === "tri" ? (signedCopy[key] ? "on" : "off") : signedCopy[key]) : ""} disabled={!canEdit} data-testid={`tpl-sc-${key}`}
                      onChange={(e) => { const v = e.currentTarget.value; setSc(key, v === "" ? undefined : kind === "tri" ? v === "on" : v); }}>
                      <NativeSelectOption value="">Practice default</NativeSelectOption>
                      {kind === "tri" ? (<><NativeSelectOption value="on">On</NativeSelectOption><NativeSelectOption value="off">Off</NativeSelectOption></>) : kind.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
                    </NativeSelect>
                  </label>
                ))}
                <label className="flex items-center justify-between gap-3 text-sm text-ink md:col-span-2">
                  <span>Footer text</span>
                  <Input value={signedCopy["signed_copy.footer_text"] ?? ""} disabled={!canEdit} maxLength={160} placeholder="Practice default" className="max-w-[320px]" data-testid="tpl-sc-footer"
                    onChange={(e) => setSc("signed_copy.footer_text", e.currentTarget.value)} />
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch id={`${uid}-parent`} checked={requiresParentUnder18} onCheckedChange={setRequiresParentUnder18} disabled={!canEdit} data-testid="tpl-parent-switch" />
              <label htmlFor={`${uid}-parent`} className="text-sm text-ink">An adolescent's agreement asks a parent too</label>
            </div>

            <Field data-testid="tpl-resign-field">
              <FieldLabel htmlFor={`${uid}-resign`} className="text-sm font-normal text-ink-muted">Sign it again after<span className="text-ink-faint text-xs ml-1">optional</span></FieldLabel>
              <FieldContent>
                <div className="flex items-center gap-3">
                  <Input id={`${uid}-resign`} type="number" min="1" max="60" value={reSignMonths === null ? "" : String(reSignMonths)}
                    onChange={(e) => setReSignMonths(e.target.value === "" ? null : Number(e.target.value))} disabled={!canEdit} className="w-24" data-testid="tpl-resign-input" />
                  <span className="text-xs text-ink-muted">months</span>
                </div>
              </FieldContent>
            </Field>

            <div>
              <FieldLabel className="mb-2 block text-sm font-normal text-ink-muted">Start a subscription when signed</FieldLabel>
              <DisabledWithReason disabled={true} reason="Signing starts billing once Money is connected." testId="tpl-start-subscription">
                {({ disabled, describedBy }) => <span className="text-sm text-ink-muted" aria-describedby={describedBy} data-disabled={disabled}>If attached to a plan, signing starts it.</span>}
              </DisabledWithReason>
              {plans.length === 0 ? (
                <NativeSelect disabled className="mt-3" data-testid="tpl-plan-select-empty"><option value="">No plans yet</option></NativeSelect>
              ) : (
                <NativeSelect className="mt-3" value={createsSubscriptionPlanId} onChange={(e) => setCreatesSubscriptionPlanId(e.target.value)} disabled={!canEdit} data-testid="tpl-plan-select">
                  <option value="">Nothing — no plan attached</option>
                  {[...new Set(plans.map((p) => p.program_name ?? ""))].map((group) => (
                    <optgroup key={group || "none"} label={group || "No program"}>
                      {plans.filter((p) => (p.program_name ?? "") === group).map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {p.interval}</option>
                      ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );

  return (
    <>
      {readOnlyNotice}
      {draftBanner}
      {versionPromptBanner}
      {saveErrorBanner}
      {sendTestResultBanner}

      <EditorPage
        header={{
          title: name || (isNew ? "New template" : loadedName || "Template"),
          meta: headerMeta,
          verbs: headerVerbs,
          onClose: close,
          dirty: isDirty,
          objectNoun: "template",
          testId: "tpl-editor-header",
        }}
        blocker={blockerBanner}
        rail={sidePanel}
        loading={false}
        testId="doc-template-editor"
      >
        {/* ★ EditorColumn (the shared archetype's own wrapper around `children`) adds px-11 pb-20 —
            fine for a normal settings form, wrong for a full-bleed white-page editor. The negative
            margin cancels exactly that padding so the grey backdrop and the strip reach the real
            edges of the content column, while the side panel (passed as `rail`, EditorPage's own
            sibling slot next to `<main>`, never inside EditorColumn) is unaffected either way. */}
        <div className="-mx-11 -mb-20 flex h-full min-h-0 flex-col bg-surface-sunken">
          {strip}
          <div className="flex-1 overflow-y-auto p-9">{page}</div>
        </div>
      </EditorPage>

      <DocsAIDraft open={showAiDraft} onOpenChange={setShowAiDraft} templateId={isNew ? null : currentId} onDraftReady={(body) => { if (editor) editor.commands.setContent(sectionsToTiptapDoc(body.sections)); }} />
      <DocsPublish open={showPublish} onOpenChange={setShowPublish} templateId={currentId} templateName={loadedName} sentInstances={sentInstances} onPublished={() => { setActive(true); onRefetch?.(); }} />
    </>
  );
}
