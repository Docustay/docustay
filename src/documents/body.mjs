// P15C.2 / P15C.3 — THE TEMPLATE BODY: ITS SHAPE, ITS VALIDATOR, AND ITS RECURSIVE READER.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS IS THE ANTI-DRIFT ITEM, AND THE THING IT PREVENTS IS MEASURED.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The system being replaced held **FIVE independent recursive walkers over FOUR nesting keys and
// THREE storage dialects that drifted inside ONE system**, and needed a **1,006-line reader** to
// reconcile dialects that a single unvalidated jsonb column had allowed to exist.
//   ★★ A jsonb column with no validator does not store "a document". It stores **whatever the last
//      writer happened to send**, and every reader afterwards has to guess. The 1,006 lines were not
//      incompetence; they were the cost of that permission, paid once per reader, forever.
//   ★★★ SO THE WRITE PATH REFUSES A SECOND DIALECT. Not warns, not normalises — REFUSES, naming the
//        expected shape. If a second dialect is representable, it will exist.
//
// ★ Two schemas, because a contract and a form are not the same object (see 0033's header). The
//   `kind` discriminator is checked in the DATABASE too, so neither layer is the only guard.

import { z } from "zod";
import { invalid } from "../http/errors.mjs";
import { assertVariablesResolvable } from "./variables.mjs";
import { ASSIGNMENT_TARGETS } from "./vocabulary.mjs";
import { parsePdfBodyData } from "./pdfBody.mjs";

/** The layout version of the JSON itself — NOT the template's revision number. See 0033. */
export const BODY_SCHEMA_VERSION = 1;

// ★ A key is machine-stable and is what a stored answer is filed under. Same rule as everywhere else
//   in this codebase, stated once here so the builder cannot invent a looser one.
const key = z.string().regex(/^[a-z][a-z0-9_]*$/,
  "a key must be lower-case, start with a letter, and contain only letters, digits and underscores");

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ THE FIVE SECTION OWNERS — AND THE RULE THAT NO PARTY BORROWS ANOTHER'S NAME.
// ═════════════════════════════════════════════════════════════════════════════
// CLAUDE.md §2.7. The live defect: a GLT tech client's signature rendered under a badge reading
// "PIR" on an EXECUTED instrument, because a `|| signerByRole.client` fallback let the recovery
// branch catch the tech party.
//  ★ `both` is in `ASSIGNMENT_TARGETS` because it is a legitimate ASSIGNMENT value ("either side may
//    act"). **It is not a party and can never own a section** — you cannot ask "both" to sign, and a
//    section owned by "both" is a section with no identifiable signer.
export const SECTION_OWNERS = Object.freeze(
  ASSIGNMENT_TARGETS.filter((t) => t !== "both"));

const owner = z.enum(SECTION_OWNERS);

// ═════════════════════════════════════════════════════════════════════════════
// A CONTRACT BODY — PROSE IN OWNED SECTIONS.
// ═════════════════════════════════════════════════════════════════════════════
// ★ `prose` carries text; `variable` names a value resolved AT SEND (never at render — 0009:149);
//   `signature` is a slot a named party signs.
// ★★★ FIX, 30 Sep 2026 (documents paragraph-formatting brief) — `marks` is a PURE ADDITION: every
//     block written before today has no `marks` key, `.optional()` reads that as "no emphasis", and
//     it renders identically to before. This is what "keep already-sent frozen snapshots rendering"
//     means in practice — the schema widens, it never narrows.
const proseBlock = z.object({
  type: z.literal("prose"),
  text: z.string().min(1, "a prose block with no text renders as blank space in an agreement"),
  marks: z.array(z.enum(["bold", "italic"])).optional(),
  // a link (Docustay written templates, Part 29b): another pure addition — a block with no href renders as before
  href: z.string().max(2000).regex(/^https?:\/\/\S+$/, "a link must start with http:// or https://").optional(),
}).strict();

// ★★★ FIX, 30 Sep 2026 — TWO KINDS OF BREAK, AND THEY ARE NOT THE SAME BREAK.
//     `paragraphBreak` sits BETWEEN blocks in `section.blocks` and marks "a new TipTap paragraph
//     starts here" — without it every prose/variable block in a section was one indistinguishable
//     run, which is the defect itself: `sectionsToTiptapDoc` had nothing to split ON. `lineBreak` is
//     a soft break WITHIN one paragraph (shift+enter) — a different fact, and collapsing the two into
//     one block type would lose which kind of break the author actually made.
//   ★ Neither type existed before today, so a body with none of them (every already-sent snapshot)
//     parses exactly as it always did: one merged paragraph per section — unchanged rendering, as
//     instructed.
const paragraphBreakBlock = z.object({ type: z.literal("paragraphBreak") }).strict();
const lineBreakBlock = z.object({ type: z.literal("lineBreak") }).strict();

// ★★★ A VARIABLE NAME IS A PATH INTO A RECORD, NOT AN IDENTIFIER INSIDE THE DOCUMENT — so it does
//     NOT use `key`. [FOUND 2026-09-15 by the schema refusing `client.name`] `key` is
//     `^[a-z][a-z0-9_]*$`, written for SECTION and SIGNATURE keys, which are names the document uses
//     to refer to its own parts. `client.name` says *the `name` of the `client`*, and the dotted form
//     is what P9.1's instruction spells and what every templating system uses.
//   ★★ AND THE REGEX IS NOT THE REAL CONSTRAINT ANYWAY — `assertVariablesResolvable` is, and it is
//      far tighter: the name must be IN THE CLOSED CATALOGUE (`src/documents/variables.mjs`). A
//      pattern admits infinitely many names that resolve to nothing; the catalogue admits six that
//      resolve to something. This pattern only stops a nonsense shape from reaching that check.
const variableName = z.string().regex(
  /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/,
  "a variable name is a dotted path of lower-case segments, like client.name");

const variableBlock = z.object({
  type: z.literal("variable"),
  // ★★ A variable carries its own FALLBACK LABEL, so an unresolved value can render as
  //    "[Client name — not provided]" rather than as a blank or a raw token. P15C.9's red-first turns
  //    on exactly this: **a blank is how an empty instrument reaches a client looking complete.**
  name: variableName,
  label: z.string().min(1, "a variable needs a human label for the unresolved case"),
}).strict();

const signatureBlock = z.object({
  type: z.literal("signature"),
  key,
  label: z.string().min(1, "a signature slot needs a label — an unlabelled block does not say whose it is"),
  // ★★★ PER-FIELD OWNERSHIP, OPTIONAL, AND IT OVERRIDES THE SECTION. This is what lets ONE section
  //     hold a client signature AND a staff signature — the merged clause. Under section-level
  //     ownership only, the staff block inherited the client's party and carried the client's date.
  owner: owner.optional(),
}).strict();

// ★★★ FIX, 30 Sep 2026 — A LIST ITEM IS INLINE CONTENT, THE SAME VOCABULARY AS A PARAGRAPH'S OWN
//     RUNS (text-with-marks, a variable, a line break) — never a second, simpler shape. A list has no
//     nested lists and no paragraph breaks inside an item (TipTap's own list-item model here is one
//     paragraph per item); if that is ever needed it is a new, explicit extension, not this one
//     silently stretched to cover it.
const listItemInline = z.discriminatedUnion("type", [proseBlock, variableBlock, lineBreakBlock]);
const listBlock = z.object({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(z.array(listItemInline).min(1, "a list item with no content is a bullet pointing at nothing"))
    .min(1, "a list with no items renders as an empty marker"),
}).strict();

const contractSection = z.object({
  key,
  title: z.string().min(1, "a section needs a title — an untitled clause cannot be referred to"),
  owner,
  // ★★★ AND ONLY LABEL A PARTY THAT ACTUALLY SIGNED. [MEASURED in the source system] four live
  //     recovery schemas used `client` as authoring shorthand on `requiresSignature:false` sections;
  //     labelling those unconditionally put "Client" on three sections of a person-in-recovery's own
  //     proposal and "PIR" on the fourth — **the same person named two ways on one instrument.**
  //   ★ So this flag is REQUIRED, not defaulted: a role badge is a statement about who signed, and
  //     the renderer must be able to tell "owned by, for authoring" from "signed by".
  requires_signature: z.boolean(),
  // ★★★ FIX, 30 Sep 2026 — paragraphBreak/lineBreak/list added (documents paragraph-formatting
  //   brief). All three are new alternatives in the union, not a change to the existing three — a
  //   body written before today contains none of them and parses exactly as it always did.
  blocks: z.array(z.discriminatedUnion("type",
    [proseBlock, variableBlock, signatureBlock, paragraphBreakBlock, lineBreakBlock, listBlock]))
    .min(1, "a section with no blocks is an empty clause"),
}).strict();

export const contractBodySchema = z.object({
  kind: z.literal("contract"),
  schema_version: z.literal(BODY_SCHEMA_VERSION),
  sections: z.array(contractSection).min(1, "a contract with no sections is a blank page"),
}).strict();

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ P9.1 — THE FROZEN BODY IS THE AUTHORED BODY **PLUS THE VALUES RESOLVED AT SEND**.
// ═════════════════════════════════════════════════════════════════════════════
// Both renderers already read `values` — `pdf.mjs:213` and `esign/renderContract.jsx:103` — and
// [MEASURED 2026-09-15] nothing had ever written it, so every variable rendered
// "[label — not provided]", permanently. `resolveVariables` (src/documents/variables.mjs) fills it
// once, inside `sendInstance`'s transaction, because **the values are part of what the signer was
// shown** and §M0 LAW 3 freezes that at send. A variable resolved at RENDER would let a client's
// later name change rewrite an agreement they had already signed.
//
// ★★★ AND IT IS A SEPARATE SCHEMA, NOT A LOOSENED `contractBodySchema`. The authoring schema stays
//     `.strict()` with no `values`: a TEMPLATE must never carry baked-in values, or the same
//     template would issue two different agreements depending on when it was authored. One shape for
//     what a person writes, another for what was frozen — which is the live-vs-frozen distinction
//     this codebase already makes everywhere else.
//   ★ `values` is `Record<string,string>` and OPTIONAL. A variable that could not resolve is ABSENT,
//     never an empty string: absence renders the unresolved marker, `""` renders as a deliberate
//     blank, and a blank is how an empty instrument reaches a client looking complete.
export const frozenContractBodySchema = contractBodySchema.extend({
  values: z.record(z.string()).optional(),
}).strict();

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ A FORM BODY — A RECURSIVE FIELD TREE.
// ═════════════════════════════════════════════════════════════════════════════
// ★ Leaf types are questions. A CONTAINER (`panel`) has `children` and is NOT a question — it is
//   layout. The distinction matters for counting (see `countFields`), and counting is how the flat-
//   walk defect is detected at all.
export const FIELD_TYPES = Object.freeze([
  "text", "textarea", "number", "date", "select", "radio", "checkbox", "signature",
]);
export const CONTAINER_TYPES = Object.freeze(["panel"]);

// ★★★ ONE SCHEMA FOR A FIELD, WITH THE CONTAINER/LEAF PAIRING ENFORCED BY A REFINEMENT.
//     My first version built a `discriminatedUnion` over nine literal types by extending a refined
//     leaf schema — which **threw at import time** (`leafField.innerType is not a function`: a
//     superRefine wraps the object and the wrapper has no `.extend`). [EXECUTED] It failed on the
//     first smoke test, before any test existed.
//   ★★ The union was also the wrong shape for the actual rule. The real constraints are
//      RELATIONSHIPS between fields — a panel must have children and no options; a select must have
//      options and no children — and a refinement states those directly instead of encoding them in
//      nine near-identical branches that drift.
const fieldBase = z.object({
  key,
  type: z.enum([...FIELD_TYPES, ...CONTAINER_TYPES]),
  label: z.string().min(1, "a field with no label is an unanswerable question"),
  required: z.boolean().optional(),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) }).strict()).optional(),
  // ★★ THE RECURSION. `z.lazy` so a panel may contain panels to ANY depth — a schema permitting only
  //    one level would be the flat-walk defect moved into the validator.
  children: z.lazy(() => z.array(formField)).optional(),
}).strict();

const formField = fieldBase.superRefine((f, ctx) => {
  const isContainer = CONTAINER_TYPES.includes(f.type);

  if (isContainer) {
    if (!Array.isArray(f.children) || f.children.length === 0) {
      ctx.addIssue({ code: "custom", path: ["children"],
        message: `a ${f.type} is a container and must hold at least one field — an empty one is a boundary around nothing` });
    }
    if (f.options) {
      ctx.addIssue({ code: "custom", path: ["options"],
        message: `a ${f.type} is layout, not a question, so it cannot carry options` });
    }
    if (f.required !== undefined) {
      // ★ A container cannot be "required": there is no answer to require. Silently ignoring the flag
      //   would let an author believe they had made a group mandatory.
      ctx.addIssue({ code: "custom", path: ["required"],
        message: `a ${f.type} cannot be required — it holds no answer of its own. Mark its children instead.` });
    }
    return;
  }

  if (f.children) {
    ctx.addIssue({ code: "custom", path: ["children"],
      message: `a ${f.type} is a leaf question and cannot hold children — only ${CONTAINER_TYPES.join(", ")} can` });
  }
  const needsOptions = ["select", "radio"].includes(f.type);
  if (needsOptions && (!f.options || f.options.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["options"],
      message: `a ${f.type} field must carry its options — without them it renders as an empty control` });
  }
  if (!needsOptions && f.options) {
    ctx.addIssue({ code: "custom", path: ["options"],
      message: `a ${f.type} field must NOT carry options — two shapes in one row is how a dialect starts` });
  }
});

export const formBodySchema = z.object({
  kind: z.literal("form"),
  schema_version: z.literal(BODY_SCHEMA_VERSION),
  fields: z.array(formField).min(1, "a form with no fields asks nothing"),
}).strict();

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ THE READER. RECURSIVE, AND ITS COUNT IS CHECKED AGAINST THE DATABASE'S.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Every LEAF field in a form body, at any depth, in document order.
 * ★★ CONTAINERS ARE NOT RETURNED. They are layout, not questions — and counting them would inflate
 *    the total and let a flat walker land on the right number for the wrong reason.
 */
export function flattenFormFields(fields) {
  const out = [];
  const walk = (arr) => {
    for (const f of arr ?? []) {
      if (!f || typeof f !== "object") continue;
      if (Array.isArray(f.children)) walk(f.children);
      else out.push(f);
    }
  };
  walk(fields);
  return out;
}

/** The leaf-field count. Must equal `keystone.form_field_count(body->'fields')` — asserted by test. */
export function countFields(fields) {
  return flattenFormFields(fields).length;
}

/**
 * ★★★ THE FLAT WALKER — SHIPPED DELIBERATELY, AS THE DEFECT'S OWN WITNESS.
 *
 * This is what a reader written without the recursion looks like. It is exported so the red-first
 * check can run BOTH and assert the flat one reports FEWER — the measurement P15C.2 demands, and the
 * one the legacy system produced by accident (155 vs 198 over three screenings).
 *  ★★ NOTHING IN `src/` CALLS IT, and `db/gates/write-census.mjs`-style scrutiny should keep it that
 *     way: it exists to FAIL, next to the thing that does not. A comment claiming "the recursive one
 *     is better" proves nothing; two counts do.
 */
export function flatCountFields_DEFECTIVE(fields) {
  return (fields ?? []).filter((f) => f && typeof f === "object" && !Array.isArray(f.children)).length;
}

/** Every signature slot in a CONTRACT body, with the party that owns it resolved. */
export function contractSignatureSlots(sections) {
  const out = [];
  for (const s of sections ?? []) {
    for (const b of s?.blocks ?? []) {
      if (b?.type !== "signature") continue;
      // ★ field owner first, then the SECTION's — a chain within one field's own ownership, never a
      //   fallback from one PARTY to another (§2.7).
      out.push({ key: b.key, label: b.label, owner: b.owner ?? s.owner, section_key: s.key });
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE BOUNDARY. One function, both kinds, and it REFUSES rather than normalising.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * @param builder "contract" | "form" — from the ROUTE, not from the body. A body that claims to be
 *        a contract on the form route is refused, which is P15C.5's second red-first.
 */
export function parseTemplateBody(builder, body) {
  if (builder !== "contract" && builder !== "form" && builder !== "pdf") {
    throw invalid(`builder must be "contract", "form" or "pdf" — got ${JSON.stringify(builder)}`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalid("a template body must be an object carrying `kind`, `schema_version` and its content");
  }
  // ★★★ THE ROUTE DECIDES, AND THE BODY MUST AGREE. Checked BEFORE the schema so the error names the
  //     real problem ("you sent a form to the contract builder") instead of forty shape complaints.
  if (body.kind !== builder) {
    throw invalid(
      `this is the ${builder} builder and the body says kind=${JSON.stringify(body.kind)}. §A5: the ` +
      `contract builder and the form builder are SEPARATE tools with SEPARATE template sets — a body ` +
      `is never moved between them, it is authored in the tool that owns it.`);
  }

  // ★ QUEUE §23.4 — the uploaded-file builder has its own pure module (the browser reads it too); its refusals carry the same `issues` shape.
  if (builder === "pdf") {
    try { return parsePdfBodyData(body); } catch (e) { throw invalid(e.message, { issues: e.issues ?? [] }); }
  }
  const schema = builder === "contract" ? contractBodySchema : formBodySchema;
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join(".") || "(root)", code: i.code, message: i.message,
    }));
    // ★★ THE EXPECTED SHAPE IS NAMED IN THE REFUSAL. P15C.3's red-first requires the write to be
    //    refused "naming the expected shape" — an error that says only "invalid" leaves the author
    //    guessing, and guessing is how a second dialect gets written.
    throw invalid(
      `this ${builder} body does not match the one permitted shape. A ${builder} body is ` +
      (builder === "contract"
        ? `{ kind:"contract", schema_version:1, sections:[ { key, title, owner, requires_signature, blocks:[…] } ] }`
        : `{ kind:"form", schema_version:1, fields:[ { key, type, label } | { key, type:"panel", label, children:[…] } ] }`) +
      `. There is exactly one shape on purpose: an unvalidated body is how the system being replaced ` +
      `arrived at three dialects and a 1,006-line reader to reconcile them.`,
      { issues });
  }

  // ★★★ KEY UNIQUENESS, ACROSS THE WHOLE BODY AND THROUGH THE RECURSION. A duplicate key means two
  //     questions write to one stored answer — the second silently overwrites the first, and on a
  //     signature block it means two parties share one mark.
  const keys = builder === "form"
    ? flattenFormFields(result.data.fields).map((f) => f.key)
    : contractSignatureSlots(result.data.sections).map((s) => s.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) {
    throw invalid(
      `duplicate key(s) ${[...new Set(dupes)].join(", ")} in this ${builder} body. Two fields sharing ` +
      `a key write to ONE stored answer, so the second silently overwrites the first — and on a ` +
      `signature block it means two parties would share one mark.`);
  }

  // ★ A contract must be SIGNABLE by somebody, or it is a notice pretending to be an agreement.
  if (builder === "contract") {
    const signing = result.data.sections.filter((s) => s.requires_signature);
    if (signing.length === 0) {
      throw invalid(
        "no section of this contract requires a signature. An agreement nobody signs is a notice; if " +
        "that is what you meant, author it as a form.");
    }
    // ★★ AND EVERY SECTION THAT REQUIRES A SIGNATURE MUST CONTAIN A SLOT TO SIGN IN. Otherwise the
    //    instrument asks a party for a signature it gives them nowhere to make — which presents to
    //    the signer as a document that cannot be completed and to staff as a stuck pipeline row.
    const withoutSlot = signing.filter(
      (s) => !(s.blocks ?? []).some((b) => b.type === "signature"));
    if (withoutSlot.length) {
      throw invalid(
        `section(s) ${withoutSlot.map((s) => s.key).join(", ")} require a signature but contain no ` +
        `signature block. The signer would be asked for a signature with nowhere to make it.`);
    }
  }

  // ★★★ P9.1 — AND A CONTRACT MAY ONLY NAME VARIABLES SOMETHING CAN RESOLVE. Checked at AUTHORING,
  //     which is the only moment the author is in the room. By send the instrument is in front of a
  //     client with a permanent hole in it reading "[label — not provided]", and the person who
  //     typed the token is not there to notice.
  //   ★ The catalogue is closed (`src/documents/variables.mjs`) so a typo — `clint.name` — is a
  //     refusal with the legal names in it, not a silent blank on a signed agreement.
  if (builder === "contract") assertVariablesResolvable(result.data);

  return result.data;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P15C.3, SECOND HALF — THE VALIDATOR FOR `template_snapshot`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// [MEASURED at 0009:159] `template_snapshot`'s ONLY constraint was `IS NOT NULL`, via `executed_shape`
// — and `buildTemplateSnapshot` was NAMED IN A COMMENT (0009:149) and existed nowhere else. So the
// frozen copy of a legal instrument was an unconstrained jsonb blob: **anything at all satisfied it,
// including `{}`.**
//   ★★ THAT IS THE SAME PERMISSION AS AN UNVALIDATED BODY, ON THE OBJECT WHERE IT MATTERS MOST. A body
//      that drifts produces a bad author experience; a SNAPSHOT that drifts produces an executed
//      instrument nobody can read back — and the whole point of §M0 LAW 3 is that it can be.
//   ★★★ AND `{}` WOULD HAVE PASSED `executed_shape`. "The snapshot is present" and "the snapshot says
//        anything" are different claims, and only the first was checked.

/** The layout version of a snapshot. Bumped when the shape changes, never reused. */
export const SNAPSHOT_LAW3_VERSION = 1;

const priceFrozenSchema = z.object({
  price_id: z.string().uuid(),
  amount_minor: z.number().int(),
  currency: z.string().min(1),
  // ★ `coerce` because this arrives as a Date from `pg` on the write path and as an ISO string when
  //   read back out of jsonb. Both are the same fact; refusing one of them would make the validator
  //   reject the very row it had just approved.
  effective_from: z.coerce.date(),
}).strict();

const disclosureSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("CAPTURED"),
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
    // ★★ THE TEXT ITSELF, NOT A HASH AND NOT A URL. A hash cannot be read back to a person and a URL
    //    is a promise about the future rather than a record of the past.
    text: z.unknown().refine((v) => v !== null && v !== undefined,
      "a CAPTURED disclosure must carry the text the signer was shown"),
    accepted_at: z.coerce.date().nullable(),
    is_current: z.boolean(),
    verified_against: z.array(z.string().min(1)).min(1),
  }).strict(),
  // ★★★ THE TWO NON-CAPTURED STATES ARE DISTINCT AND BOTH MUST CARRY A REASON. `NOT_ACCEPTED` is a
  //     DEFECT (a consumer signed with no disclosure); `NO_CONSUMER_SIGNER` is not (nothing was owed).
  //     A single "not captured" status would make a compliance reader unable to tell them apart.
  z.object({
    status: z.enum(["NOT_ACCEPTED", "NO_CONSUMER_SIGNER"]),
    version: z.null(),
    text: z.null(),
    detail: z.string().min(1, "a non-captured disclosure must say WHY, in words a reader can act on"),
  }).strict(),
]);

export const templateSnapshotSchema = z.object({
  law3_version: z.literal(SNAPSHOT_LAW3_VERSION),
  builder: z.enum(["contract", "form", "pdf"]),
  title: z.string().min(1, "a snapshot with no title is an instrument nobody can name"),
  template_id: z.string().uuid().nullable(),
  // ★ The frozen BODY, when the instance carried one. Validated as a body when present, so a snapshot
  //   cannot quietly contain a dialect the live table would refuse.
  template: z.unknown().nullable(),
  terms: z.string().nullable(),
  price: priceFrozenSchema.nullable(),
  disclosure: disclosureSchema,
  // ★ F888 (found 3 Oct 2026 by the Documents regression run on the sandbox): `executeInstance` adds this key when the TEMPLATE starts a subscription (writes.mjs, "F07"), and this schema is
  //   `.strict()`, so EVERY agreement tied to a plan was refused at execution with "not the one permitted shape" — signed by nobody, ever. The key is optional (most agreements start nothing).
  creates_subscription_plan_id: z.string().uuid().optional(),
}).strict();

/**
 * Validate a snapshot before it is frozen onto an instrument.
 *
 * ★★ IT REFUSES RATHER THAN REPAIRING. A snapshot that is missing a field cannot be completed after
 *    the fact — the price that was in force, the text the signer saw, and the moment they saw it are
 *    all gone by the time anybody notices. Refusing the EXECUTION is recoverable; a half-built
 *    snapshot on a signed instrument is not.
 */
/**
 * ★ Parse a body that has already been FROZEN onto an instrument — i.e. one that may carry the
 *   values resolved at send. Same rules as authoring, plus `values`.
 */
export function parseFrozenContractBody(body) {
  const result = frozenContractBodySchema.safeParse(body);
  if (!result.success) {
    throw invalid(
      "this frozen contract body is not a legal body. It must satisfy every authoring rule, and may " +
      "additionally carry `values` — the variable values resolved at SEND (P9.1).",
      { issues: result.error.issues.map((i) => ({
          path: i.path.join(".") || "(root)", code: i.code, message: i.message })) });
  }
  return result.data;
}

export function parseTemplateSnapshot(snapshot) {
  const result = templateSnapshotSchema.safeParse(snapshot);
  if (!result.success) {
    throw invalid(
      "this template_snapshot is not the one permitted shape, so the instrument would be unreadable " +
      "later. §M0 LAW 3 requires law3_version · builder · title · template_id · template · terms · " +
      "price · disclosure, and the disclosure must be CAPTURED, NOT_ACCEPTED or NO_CONSUMER_SIGNER " +
      "with a reason. ★ Before this validator existed the column's ONLY constraint was IS NOT NULL — " +
      "an empty object satisfied it.",
      { issues: result.error.issues.map((i) => ({
          path: i.path.join(".") || "(root)", code: i.code, message: i.message })) });
  }
  // ★★ AND IF IT CARRIES A BODY, THE BODY MUST STILL BE A LEGAL BODY. Checked here rather than trusted
  //    because the snapshot is written by a different code path from the template, and "it was valid
  //    when it was authored" is not a statement about what was frozen.
  if (result.data.template && typeof result.data.template === "object") {
    const k = result.data.template.kind;
    // ★★ THE FROZEN VARIANT, because by the time a body reaches a snapshot it carries the values
    //    resolved at send (P9.1). Parsing it with the AUTHORING schema — which is `.strict()` and
    //    knows nothing about `values` — would refuse every instrument that actually used a variable,
    //    at EXECUTE, which is the worst possible moment to discover it.
    if (k === "contract") parseFrozenContractBody(result.data.template);
    else if (k === "form" || k === "pdf") parseTemplateBody(k, result.data.template);
  }
  return result.data;
}
