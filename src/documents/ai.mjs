// @ts-check
// Stage 14 task 14.37 — AI DRAFT AND CHECK.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ AI OUTPUT IS A DRAFT A PERSON MUST READ. IT NEVER REACHES A PUBLISHED TEMPLATE OR A SIGNED
//     INSTRUMENT WITHOUT A HUMAN IN BETWEEN. `aiDraft` returns a parsed contract BODY to the caller
//     and stops — it never calls `createTemplate` / `newTemplateVersion` / `updateTemplateBody`
//     (`./templates.mjs`) and never touches `document_template.published_at` or `.active`
//     (`./publish.mjs`, 14.36, not opened here). The only way a draft's words reach a template row
//     is a SEPARATE, later POST to one of those authoring routes — `src/routes/writes.mjs:443-454`
//     — which calls `parseTemplateBody` again on its own path, and the only way a template reaches a
//     signer is `publishTemplate` (14.36) followed by `sendInstance`. Nothing in this file inserts
//     into `document_template`, `document_instance`, or emits a `.sent`/`.signed`/`.executed` topic.
//     `aiCheck` returns findings as DATA (`action.patch` is never applied, never executed, never
//     used as a path or URL) for a person to review and apply through those same authoring routes.
//
// ★★★ WHAT LEAVES THE PLATFORM IN THE REQUEST BODY, ENUMERATED: the tenant's own name
//     (`keystone.tenant.name`), this practice's own clause NAMES + GISTS (`keystone.document_clause
//     .name/.gist`, never `.body`), and — only when a `templateId` is given — the EXISTING
//     template's own name/builder/body (words the practice already authored, never a person's data).
//     `aiDraft`'s free-text `prompt` is staff describing what KIND of document they want ("A group
//     programme agreement") — never a client's name, DOB, sobriety date, notes, emergency contact,
//     consent detail or guardian relationship, none of which this module ever reads from the
//     database in the first place. No `app_user` row is queried anywhere below.
//
// ★★ MODEL OUTPUT IS UNTRUSTED DATA, NEVER AN INSTRUCTION. A draft is only ever handed to
//    `parseTemplateBody("contract", …)` — the SAME gate a human author's body goes through,
//    including the closed vocabularies a human author is held to: `vocabulary.mjs`'s
//    `ASSIGNMENT_TARGETS` (checked inside `body.mjs`'s schema) and `variableCatalogue.mjs`'s six
//    names (checked by `assertVariablesResolvable`, called from inside `parseTemplateBody` for a
//    contract). A body naming a variable nothing can resolve is `parseTemplateBody` throwing
//    `invalid` — caught below and turned into the ordinary `outcome:"failed"` / 502 path, exactly
//    like any other malformed draft. That is not a crash; it is the expected shape of "the model
//    invented a field". A check finding's `action.patch` is validated only for WIRE SHAPE
//    (`z.unknown()` — present, never interpreted) and is returned as opaque data.
//
// ★ COST / ABUSE: the caller is already gated before this module runs — `assertMay` on
//   `{object:"document", action:"template.author"}` (an app-supplied NAMED_ACTIONS check,
//   `src/routes/writes.mjs:970-991`, run for every row in `ROUTES`/`STAGE14_WRITES`, never a test)
//   and the app-wide per-IP/per-tenant limiter (`src/http/rateLimit.mjs`, applied before auth on
//   every request, `src/http/app.mjs:647-650`). This module adds its own third condition:
//   `MAX_PROMPT_CHARS` below bounds the one caller-supplied free-text field before it is ever sent.

import { ports } from "./ports.mjs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { callOutside } from "../http/outside.mjs";
import { dependency, invalid, notFound, configurationStatement } from "../http/errors.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { parseTemplateBody } from "./body.mjs";
import { VARIABLES } from "./variableCatalogue.mjs";
import { ASSIGNMENT_TARGETS } from "./vocabulary.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const EVENT_SECTION = "documents";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// ★ Never called in this build (no network — see task banner). The model is named in ONE place (engine/ai/prices.mjs); this file holds no model id (D-015).
import { DEFAULT_MODEL as MODEL } from "./engine/ai/prices.mjs";
const MAX_TOKENS = 4096;

// ★ Cost/abuse cap on the one free-text field a caller supplies (`aiDraft`'s `prompt`).
const MAX_PROMPT_CHARS = 4000;

const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** ★ READ AT CALL TIME, NEVER CACHED — same reasoning as `src/email/resend.mjs`'s own key read. */
function apiKey(env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim() !== "" ? key.trim() : null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SYSTEM PROMPTS — generated from the closed catalogues, never hand-retyped (same reasoning
// `variableCatalogue.mjs`'s own header gives for not retyping its six names anywhere else).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const VARIABLE_LINES = VARIABLES.map((v) => `  ${v.name} — ${v.label} (${v.why})`).join("\n");
const OWNER_LIST = ASSIGNMENT_TARGETS.join(", ");

const SHARED_RULES =
  "This is a coaching / recovery-coaching practice, deliberately NOT therapy — never write clinical, " +
  "diagnostic, therapeutic or medical-advice language.\n" +
  "Use they/them pronouns throughout — never assume a signer's gender.\n" +
  "Do not reproduce a real company's terms or a published form verbatim — write original prose for " +
  "this practice.\n" +
  "Never write a real person's name, date of birth, sobriety date, or any other personal detail — a " +
  "template holds VARIABLES, not values. The only variables that exist are:\n" + VARIABLE_LINES + "\n" +
  `Any section's "owner" must be one of: ${OWNER_LIST}.`;

const DRAFT_SYSTEM =
  "You draft ONE template body for a document authoring tool. Reply with ONLY a single JSON object, " +
  "no prose outside it, matching exactly: " +
  '{ "kind":"contract", "schema_version":1, "sections":[ { "key","title","owner","requires_signature",' +
  '"blocks":[…] } ] }. Reuse the practice\'s own named clauses where they fit rather than inventing new ' +
  "prose for something already written. At least one section must require a signature and contain a " +
  "signature block.\n\n" + SHARED_RULES;

const CHECK_SYSTEM =
  "You review an existing template body and report what a person should look at before publishing it. " +
  "Reply with ONLY a single JSON object, no prose outside it, matching exactly: " +
  '{ "findings":[ { "title","why","action":{"label","patch"} } ], "fine":[ "…" ] }. `patch` describes ' +
  "the suggested change as data; it is never applied automatically — a person reviews and applies it " +
  "through the ordinary template-editing routes.\n\n" + SHARED_RULES;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE `check` RESPONSE SHAPE — validated for WIRE SHAPE ONLY. `patch` is `z.unknown()`: present,
// never interpreted, never executed, never applied by this module.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const checkFindingSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  action: z.object({ label: z.string().min(1), patch: z.unknown() }).strict(),
}).strict();
const checkResponseSchema = z.object({
  findings: z.array(checkFindingSchema),
  fine: z.array(z.string()),
}).strict();

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONTEXT READS — tenant-scoped, never a person's row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function fetchTenantName(tx, tenantId) {
  // the practice's name comes from the host through the brand port (Documents does not read the tenant table)
  const { tenantName } = await (await ports()).brand.get(tx, { tenantId });
  return tenantName || null;
}

/** Names + gists only — never `.body` (the clause's own words never leave in this request). */
async function fetchClauses(tx, tenantId) {
  const { rows } = await run(tx, db.selectFrom("keystone.document_clause").select(["name", "gist"]).where("tenant_id", "=", tenantId).where("archived_at", "is", null).orderBy("name", "asc"));
  return rows.map((r) => ({ name: r.name, gist: r.gist }));
}

/** The practice's own existing template — words it already authored, never a person's data. */
async function fetchTemplate(tx, tenantId, templateId) {
  if (!templateId) return null;
  const { rows } = await run(tx, db.selectFrom("keystone.document_template").select(["id", "builder", "name", "body"]).where("tenant_id", "=", tenantId).where("id", "=", templateId));
  if (rows.length === 0) throw notFound("That template is not in this workspace.");
  return rows[0];
}

async function insertRequestRow(tx, {
  tenantId, kind, templateId, promptSha256, inputTokens = null, outputTokens = null, outcome, actorUserId,
}) {
  await run(tx, db.insertInto("keystone.document_ai_request").values({
    tenant_id: tenantId ?? null,
    kind: kind ?? null,
    template_id: templateId ?? null,
    prompt_sha256: promptSha256 ?? null,
    input_tokens: inputTokens ?? null,
    output_tokens: outputTokens ?? null,
    outcome: outcome ?? null,
    requested_by: actorUserId ?? null,
  }));
}

function extractResponseText(body) {
  const block = Array.isArray(body?.content) ? body.content.find((b) => b?.type === "text") : null;
  return typeof block?.text === "string" ? block.text : null;
}

function parseJsonText(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * ★★★ THE ONE PLACE THIS MODULE CALLS OUT. Never retried (`callOutside`'s own rule); never throws
 *     for a provider failure — `result.ok`/`result.status` is read, not caught.
 */
async function callAnthropic(requestPayload, { fetchImpl, timeoutMs } = {}) {
  const key = apiKey();
  return callOutside("anthropic", ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  }, { fetchImpl, timeoutMs });
}

/**
 * ★★★ THE SHARED SHAPE FOR BOTH `aiDraft` AND `aiCheck`: key absent → `not_configured` row, thrown
 *     `dependency()` (502, never retried by a caller reading `retryable`); a model call that answers
 *     but comes back unusable (bad HTTP status, unparsable JSON, or fails `parseResponse` — which is
 *     where `parseTemplateBody`'s variable-catalogue refusal for `aiDraft` lands) → `failed` row,
 *     thrown `dependency()`; a model call that actively declines (Anthropic's own `stop_reason:
 *     "refusal"`) → `refused` row, thrown `dependency()`. **The event fires on every branch that
 *     reached the model — ok, refused or failed — and NEVER on `not_configured`, which never called
 *     out at all** (R-14.11's field 9: "event only on a model call").
 */
async function runAiRequest(tx, {
  tenantId, kind, templateId, actorUserId, requestPayload, notConfiguredMessage, failedMessage,
  fetchImpl, timeoutMs, parseResponse,
}) {
  const promptSha256 = sha256Hex(JSON.stringify(requestPayload));

  if (!apiKey()) {
    await insertRequestRow(tx, { tenantId, kind, templateId, promptSha256, outcome: "not_configured", actorUserId });
    // ★ the maintainer, 29 Sep 2026 — FOUND LIVE: this threw via `dependency()`, a 502 whose message F479's rule
    //   genericises on the wire ("Something went wrong on our side...") — the actual, fixed, no-data
    //   sentence ("AI checking isn't set up on this deployment.") never reached the screen, which is
    //   exactly the case `configurationStatement()` exists for (see its own doc comment; the sign-in
    //   and file-storage screens already use it for the identical situation).
    throw configurationStatement(notConfiguredMessage);
  }

  const result = await callAnthropic(requestPayload, { fetchImpl, timeoutMs });
  const usage = result.body && typeof result.body === "object" ? result.body.usage : null;
  const inputTokens = Number.isFinite(usage?.input_tokens) ? usage.input_tokens : null;
  const outputTokens = Number.isFinite(usage?.output_tokens) ? usage.output_tokens : null;

  const refused = result.ok && result.body?.stop_reason === "refusal";

  let parsed = null;
  if (result.ok && !refused) {
    const text = extractResponseText(result.body);
    const json = text !== null ? parseJsonText(text) : null;
    if (json !== null) {
      // ★★ MODEL OUTPUT IS UNTRUSTED — a shape refusal here (including
      //    `parseTemplateBody`'s "names N variable(s) nothing can resolve") is a NORMAL outcome,
      //    not a crash: caught, recorded as `failed`, never rethrown as an internal error.
      try { parsed = parseResponse(json); } catch { parsed = null; }
    }
  }

  const outcome = refused ? "refused" : (result.ok && parsed !== null) ? "ok" : "failed";
  await insertRequestRow(tx, { tenantId, kind, templateId, promptSha256, inputTokens, outputTokens, outcome, actorUserId });

  // ★ event only on a model call — not_configured returns/throws above, before this line.
  await emit(tx, {
    tenantId, topic: kind === "draft" ? "documents.ai.draft_generated" : "documents.ai.check_run",
    emittedBy: EVENT_SECTION,
    actor: userActor(actorUserId),
    // ★★ 02 §2.4 — outcome only, never the content the model returned or was asked for.
    payload: { template_id: templateId ?? null, outcome },
  });

  if (outcome === "refused") throw dependency("The assistant declined this request. Try rephrasing it.");
  if (outcome === "failed") throw dependency(failedMessage);
  return parsed;
}

/**
 * ★ `{fetchImpl, timeoutMs}` is an ADDITIVE third argument, never read by
 *   `registerWriteRoutes`'s two-argument `route.fn(db, args)` call — it exists only so a caller
 *   (a test) can inject a stub; production traffic always falls through to `callOutside`'s own
 *   `globalThis.fetch` default. It does not change the named fields field 4 lists on the second
 *   argument.
 */
export async function aiDraft(tx, { tenantId, prompt, templateId = null, actorUserId = null }, opts = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw invalid("prompt is required — say what kind of document you want drafted");
  }
  const trimmed = prompt.trim();
  if (trimmed.length > MAX_PROMPT_CHARS) {
    throw invalid(`prompt must be ${MAX_PROMPT_CHARS} characters or fewer — got ${trimmed.length}`);
  }

  const practiceName = await fetchTenantName(tx, tenantId);
  const clauses = await fetchClauses(tx, tenantId);
  const template = await fetchTemplate(tx, tenantId, templateId);

  const requestPayload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: DRAFT_SYSTEM,
    messages: [{
      role: "user",
      content: JSON.stringify({
        request: trimmed,
        practice: { name: practiceName },
        available_clauses: clauses,
        existing_template: template
          ? { name: template.name, builder: template.builder, body: template.body }
          : null,
      }),
    }],
  };

  const parsed = await runAiRequest(tx, {
    tenantId, kind: "draft", templateId, actorUserId, requestPayload,
    notConfiguredMessage: "AI drafting isn't set up on this deployment.",
    failedMessage: "The draft came back in a shape we can't use. Try again.",
    fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs,
    parseResponse: (json) => parseTemplateBody("contract", json),
  });

  return { body: parsed };
}

/** See `aiDraft`'s doc comment for the additive third `opts` argument. */
export async function aiCheck(tx, { tenantId, templateId, actorUserId = null }, opts = {}) {
  if (typeof templateId !== "string" || !templateId) {
    throw invalid("templateId is required");
  }

  const practiceName = await fetchTenantName(tx, tenantId);
  const clauses = await fetchClauses(tx, tenantId);
  const template = await fetchTemplate(tx, tenantId, templateId); // throws notFound when missing

  const requestPayload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: CHECK_SYSTEM,
    messages: [{
      role: "user",
      content: JSON.stringify({
        practice: { name: practiceName },
        available_clauses: clauses,
        template: { name: template.name, builder: template.builder, body: template.body },
      }),
    }],
  };

  return runAiRequest(tx, {
    tenantId, kind: "check", templateId, actorUserId, requestPayload,
    notConfiguredMessage: "AI checking isn't set up on this deployment.",
    failedMessage: "The check came back in a shape we can't use. Try again.",
    fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs,
    parseResponse: (json) => checkResponseSchema.parse(json),
  });
}
