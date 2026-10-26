// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.006 — `/settings/documents`. **THE TYPE LAYER. NOT THE TEMPLATE AND NOT THE INSTANCE.**
//
// ★★★ THE THREE LEVELS ARE THE WHOLE POINT AND MERGING THEM IS HOW A SIGNED INSTRUMENT CHANGES
//     AFTER SIGNATURE: **type** (the class and its seven axes — this screen) · **template** (the
//     words, versioned — `TemplateBuilder`) · **instance** (one issued copy). A document TYPE says
//     what kind of thing this is and who signs it; it carries no words and no signatures.
//
// ★★★ THE SEVEN AXES COME FROM THE SERVER'S OWN `vocabulary`, NEVER FROM A LIST HERE. The route
//     serves `signer_configs`, `audiences`, `divisions`, `applies_to` and `assignment_targets`
//     alongside the data, and the reason is recorded on the route itself: *"a second declaration
//     is a second answer to 'who signs next'."* ★★ `TemplateBuilder` learned the same lesson the
//     expensive way — a hardcoded five-owner map hid two legal owners and rendered them as raw
//     identifiers. Deriving costs nothing and cannot drift.
//
// ★★ THE KEY IS DERIVED FROM THE LABEL, NOT ASKED FOR. Asking a person for a snake_case
//    identifier invites two categories that differ only in punctuation — the client method's own
//    comment says so. It is shown before saving so it is never a surprise.
//
// ★ A CATEGORY MUST EXIST BEFORE A TYPE CAN JOIN ONE. That is a real ordering, so the type
//   surface says what to do first rather than offering an empty picker.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import DocumentAxesScreenTable1Table from "./DocumentAxesScreenTable1Table.jsx";
import DocumentAxesScreenDocCategorySheet from "./DocumentAxesScreenDocCategorySheet.jsx";
import DocumentAxesScreenDocTypeSheet from "./DocumentAxesScreenDocTypeSheet.jsx";

export default function DocumentAxesScreen({ view = null, rank = null, onDone = null }) {
  const categories = useMemo(() => view?.categories ?? [], [view?.categories]);
  const types = useMemo(() => view?.types ?? [], [view?.types]);
  const vocab = useMemo(() => view?.vocabulary ?? {}, [view?.vocabulary]);

  // ★ Both write routes are `minRank: "admin"` (`src/routes/writes.mjs:121-122`). The list is
  //   readable below that floor; the buttons are not drawn for somebody the server would refuse.
  const isAdmin = useMemo(
    () => RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin"),
    [rank]
  );

  let open = null;          // "category" | "type"
  const [openState, setOpenState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // Form state for category
  const [categoryLabel, setCategoryLabel] = useState("");

  // Form state for type
  const [typeLabel, setTypeLabel] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [signerConfig, setSignerConfig] = useState("");
  const [audience, setAudience] = useState("");
  const [division, setDivision] = useState("");
  const [appliesTo, setAppliesTo] = useState("");
  const [assignedTo, setAssignedTo] = useState("");

  // ★★ THE DERIVED IDENTIFIER. Shown before saving — see the header.
  const keyOf = (text) =>
    String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const derivedKey = keyOf(categoryLabel || typeLabel);

  function start(which) {
    setCategoryLabel("");
    setTypeLabel("");
    setCategoryId("");
    setSignerConfig("");
    setAudience("");
    setDivision("");
    setAppliesTo("");
    setAssignedTo("");
    setProblem(null);
    setOpenState(which);
  }

  const categoryReady = keyOf(categoryLabel).length > 0;
  // ★★ EVERY AXIS IS REQUIRED, because a type with an unset axis is a type whose signing behaviour
  //    is undefined — and the place that discovers it is a signature ceremony, not this screen.
  const typeReady =
    keyOf(typeLabel).length > 0 &&
    !!categoryId &&
    !!signerConfig &&
    !!audience &&
    !!division &&
    !!appliesTo &&
    !!assignedTo;

  async function save() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      if (openState === "category") {
        await api.createDocumentCategory({
          key: keyOf(categoryLabel),
          label: categoryLabel.trim(),
        });
      } else {
        await api.createDocumentType({
          key: keyOf(typeLabel),
          label: typeLabel.trim(),
          categoryId,
          signerConfig,
          audience,
          division,
          appliesTo,
          defaultAssignedTo: assignedTo,
        });
      }
      setOpenState(null);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  const pretty = (v) => String(v).replace(/_/g, " ");

  return (
    <>
      <PageHeader title="Documents" count={types.length} noun="document type">
        {/* ★ QUEUE §23.2.2 — the Documents island's own settings (reminders, how a signed copy looks, the certificate, retention) are one click from here. */}
        <Button asChild type="button" variant="outline" data-testid="doc-settings-link">
          <a href="/documents/settings">Signing, signed copy and records</a>
        </Button>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="doc-category-trigger"
              onClick={() => start("category")}
            >
              New category
            </Button>
            <Button
              type="button"
              data-testid="doc-type-trigger"
              onClick={() => start("type")}
            >
              New document type
            </Button>
          </div>
        )}
      </PageHeader>

      {types.length === 0 ? (
        <EmptyState
          kind="first-run"
          headline="No document types yet"
          line="A document type says what kind of thing a document is and who signs it. The words come later, in a template."
          testId="doc-types-empty"
        />
      ) : (
        <DocumentAxesScreenTable1Table
          types={types}
          pretty={pretty}
        />
      )}

      {openState === "category" && (
        <DocumentAxesScreenDocCategorySheet
          open={openState === "category"}
          onOpenChange={setOpenState}
          busy={busy}
          problem={problem}
          label={categoryLabel}
          onLabelChange={setCategoryLabel}
          derivedKey={derivedKey}
          categoryReady={categoryReady}
          onCancel={() => setOpenState(null)}
          onSubmit={save}
        />
      )}

      {openState === "type" && (
        <DocumentAxesScreenDocTypeSheet
          open={openState === "type"}
          onOpenChange={setOpenState}
          categories={categories}
          vocab={vocab}
          busy={busy}
          problem={problem}
          label={typeLabel}
          onLabelChange={setTypeLabel}
          categoryId={categoryId}
          onCategoryIdChange={setCategoryId}
          signerConfig={signerConfig}
          onSignerConfigChange={setSignerConfig}
          audience={audience}
          onAudienceChange={setAudience}
          division={division}
          onDivisionChange={setDivision}
          appliesTo={appliesTo}
          onAppliesToChange={setAppliesTo}
          assignedTo={assignedTo}
          onAssignedToChange={setAssignedTo}
          derivedKey={derivedKey}
          typeReady={typeReady}
          onCancel={() => setOpenState(null)}
          onSubmit={save}
          pretty={pretty}
        />
      )}
    </>
  );
}
