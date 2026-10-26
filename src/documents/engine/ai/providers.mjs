// THE SHARED DOCUMENT ENGINE — model providers. ONE function, `callModel`, over four providers: anthropic, openai_compatible, own_endpoint, test_double.
// Every call goes through callOutside (time limit, error kind, no retries; the job layer retries). The model NAME is a setting, never a literal in a caller.
// A key is passed in by the job (this file reads no database and no environment except the two documented below).
//   KEYSTONE_AI_DEFAULT_MODEL   the model used when a workspace names none (the default lives in prices.mjs)
//   KEYSTONE_AI_ALLOW_FAKE      the `fake` provider (fake.mjs) is available only when this is "1" and KEYSTONE_ENVIRONMENT is not production
//   RAILWAY_ENVIRONMENT_NAME    the test_double provider refuses to run when this is "production"
import { callOutside } from "../../../http/outside.mjs";
import { fakeCall } from "./fake.mjs";
import { DEFAULT_MODEL } from "./prices.mjs";

import { anthropicHeaders } from "../../anthropicHeaders.mjs";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PROVIDERS = Object.freeze(["anthropic", "openai_compatible", "own_endpoint", "test_double", "fake"]);

// ★ S-5 (security audit run 5, 10 Oct 2026): an endpoint an ORGANISATION typed is not one of ours. It must be a public https address (http://localhost only when KEYSTONE_ENVIRONMENT is "local"),
//   a redirect is never followed, and the answer is cut off at 2 MiB — see `guard` in src/http/outside.mjs and src/http/publicDestination.mjs.
// a self-hosted install ("lan") may point at an AI server on its own network (Ollama and the like); a hosted one may not
const ENDPOINT_GUARD = (env) => ({ allowLocal: env?.KEYSTONE_SELF_HOST === "1" ? "lan" : env?.KEYSTONE_ENVIRONMENT === "local", maxBytes: 2 * 1024 * 1024 });
const REFUSED_ENDPOINT = "That endpoint address is not allowed. It must be a public https address.";
const fail = (message, extra = {}) => ({ ok: false, text: null, inputTokens: null, outputTokens: null, refused: false, message, ...extra });
const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * @param {object} a
 * @param {string} a.provider  one of PROVIDERS
 * @param {string} [a.model]   from the workspace setting; empty = the provider's default
 * @param {string} [a.endpoint] openai_compatible: base address; own_endpoint: the full address
 * @param {string|null} a.apiKey
 * @param {string} a.system @param {string} a.user @param {number} [a.maxTokens]
 * @param {Function} [a.fetchImpl] @param {number} [a.timeoutMs] @param {(req:{system:string,user:string})=>string} [a.double]  test_double's canned answer
 */
export async function callModel({ provider, model = "", effort = null, endpoint = "", apiKey = null, system, user, maxTokens = 4096, schema = null, fetchImpl, timeoutMs = 90_000, double = null, env = process.env }) {
  if (!PROVIDERS.includes(provider)) return fail("That AI provider is not one this service knows.", { kind: "config" });

  if (provider === "fake") {
    if (env.KEYSTONE_AI_ALLOW_FAKE !== "1" || env.KEYSTONE_ENVIRONMENT === "production") return fail("The test provider is not available here.", { kind: "config" });
    return fakeCall({ system, user, schema, model, maxTokens });
  }

  if (provider === "test_double") {
    if (env.RAILWAY_ENVIRONMENT_NAME === "production") return fail("The test provider is not available here.", { kind: "config" });
    const canned = schema ? JSON.stringify({ title: "Test agreement", document: "## Agreement\n\nThis is a test agreement between {{Party name;type=text;role=Client;label=Your name}} and the provider.\n\n## Payment\n\nThe fee is as agreed in writing.", people: [{ role: "Client", action: "signer", step: 1 }], signing_order: "all", email_subject: "Please sign the test agreement", email_message: "Hello, please read and sign. Thank you.", reminders: "3_7", expiry_days: 30, assumptions: ["The fee is agreed outside this document."], open_questions: ["Which law applies?"], careful: [] }) : null;
    const text = double ? double({ system, user }) : canned ?? JSON.stringify({ title: "Test document", source: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Test document" }] }, { type: "paragraph", content: [{ type: "text", text: "This is a canned draft from the test provider." }] }] }, notes: [] });
    return { ok: true, text, inputTokens: 0, outputTokens: 0, refused: false, message: null };
  }

  if (provider === "anthropic") {
    if (!apiKey) return fail("AI drafting is not set up: no key is available for this provider.", { kind: "not_configured" });
    const r = await callOutside("anthropic", ANTHROPIC_URL, {
      method: "POST", headers: anthropicHeaders(apiKey, env),
      body: JSON.stringify({ model: model || env.KEYSTONE_AI_DEFAULT_MODEL || DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }], ...(schema || (effort && env.KEYSTONE_AI_EFFORT !== "off") ? { output_config: { ...(schema ? { format: { type: "json_schema", schema } } : {}), ...(effort && env.KEYSTONE_AI_EFFORT !== "off" ? { effort } : {}) } } : {}) }),
    }, { fetchImpl, timeoutMs });
    if (!r.ok) return fail(r.status === 401 || r.status === 403 ? "The AI provider refused the key." : r.status === 429 ? "The AI provider is busy; try again in a minute." : "The AI provider did not answer; try again.", { kind: r.kind, status: r.status, retryable: r.retryable });
    const block = Array.isArray(r.body?.content) ? r.body.content.find((b) => b?.type === "text") : null;
    if (r.body?.stop_reason === "refusal") return fail("The assistant declined this request. Try rephrasing it.", { refused: true, kind: "refused", inputTokens: num(r.body?.usage?.input_tokens), outputTokens: num(r.body?.usage?.output_tokens) });
    // ALWAYS read why it stopped: a cut-off answer is a length problem, never "could not be read"
    if (r.body?.stop_reason === "max_tokens") return fail("The draft was longer than the space the assistant had for it, so it stopped part way. Ask for a shorter document, or split it in two.", { kind: "length", inputTokens: num(r.body?.usage?.input_tokens), outputTokens: num(r.body?.usage?.output_tokens) });
    if (typeof block?.text !== "string") return fail("The assistant's answer was empty.", { kind: "shape" });
    return { ok: true, text: block.text, inputTokens: num(r.body?.usage?.input_tokens), outputTokens: num(r.body?.usage?.output_tokens), usage: { input: r.body?.usage?.input_tokens ?? 0, output: r.body?.usage?.output_tokens ?? 0, cacheRead: r.body?.usage?.cache_read_input_tokens ?? 0, cacheWrite: r.body?.usage?.cache_creation_input_tokens ?? 0 }, model: typeof r.body?.model === "string" ? r.body.model : null, refused: false, message: null };
  }

  if (provider === "openai_compatible") {
    if (!endpoint) return fail("Set the endpoint address for this provider.", { kind: "not_configured" });
    if (!model) return fail("Set the model name for this provider.", { kind: "not_configured" });
    const url = `${endpoint.replace(/\/+$/, "")}/chat/completions`;
    const r = await callOutside("ai_openai_compatible", url, {
      method: "POST", headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    }, { fetchImpl, timeoutMs, guard: ENDPOINT_GUARD(env) });
    if (r.refused) return fail(REFUSED_ENDPOINT, { kind: "config" });
    if (!r.ok) return fail(r.status === 401 || r.status === 403 ? "The AI provider refused the key." : r.status === 429 ? "The AI provider is busy; try again in a minute." : "The AI provider did not answer; try again.", { kind: r.kind, status: r.status, retryable: r.retryable });
    if (r.body?.choices?.[0]?.finish_reason === "length") return fail("The draft was longer than the space the assistant had for it, so it stopped part way. Ask for a shorter document, or split it in two.", { kind: "length", inputTokens: num(r.body?.usage?.prompt_tokens), outputTokens: num(r.body?.usage?.completion_tokens) });
    const text = r.body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return fail("The AI provider's answer was empty.", { kind: "shape" });
    return { ok: true, text, inputTokens: num(r.body?.usage?.prompt_tokens), outputTokens: num(r.body?.usage?.completion_tokens), model: typeof r.body?.model === "string" ? r.body.model : null, refused: false, message: null };
  }

  // own_endpoint: POST { system, user, model, max_tokens } → { text, input_tokens?, output_tokens? }
  if (!endpoint) return fail("Set the endpoint address for this provider.", { kind: "not_configured" });
  const r = await callOutside("ai_own_endpoint", endpoint, {
    method: "POST", headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ system, user, model, max_tokens: maxTokens }),
  }, { fetchImpl, timeoutMs, guard: ENDPOINT_GUARD(env) });
  if (r.refused) return fail(REFUSED_ENDPOINT, { kind: "config" });
  if (!r.ok) return fail(r.status === 429 ? "Your own endpoint is busy; try again in a minute." : "Your own endpoint did not answer; check it and try again.", { kind: r.kind, status: r.status, retryable: r.retryable });
  if (typeof r.body?.text !== "string") return fail("Your own endpoint's answer had no text field.", { kind: "shape" });
  return { ok: true, text: r.body.text, inputTokens: num(r.body.input_tokens), outputTokens: num(r.body.output_tokens), refused: false, message: null };
}

/** The model's text → a JSON object, tolerating a fenced block or leading words. null when there is none. */
export function extractJson(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } }
  return null;
}
