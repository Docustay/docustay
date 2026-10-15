// THE FAKE PROVIDER (AI-COST-AND-USAGE-SPEC §8): a deterministic stand-in for the model, so the meter, the limits, the caps, the ceiling, the errors, the retries, provider switching and the draft validator can all be tested by
// CLICKING without spending a cent. It exists only where KEYSTONE_AI_ALLOW_FAKE=1 and never in production (gateway.mjs: fakeAllowed / assertAiEnvironment; callers refuse before they reach here).
// Markers in the request text control it:
//   [usage:in=3000,out=4000]   the token counts it reports (default: about a quarter of the request's characters in, 600 out)
//   [fake:model=NAME]          the model name it reports (priced from the real price table when the name is in it)
//   [fake:error=timeout|429|500|malformed|toolong|nosig|empty]   an error mode (nosig = a draft where a party who signs has no signature block)
//   [fake:slow=MS]             answer after MS milliseconds (default 8000 when written as [fake:slow]) — to see queueing
// Chat turns: [fake:detect] lists a PDF draft's detected boxes; [fake:place] proposes placing the sure ones; [fake:create] makes a draft through the real tool; [fake:propose] proposes a change to the open document; [fake:run_check] runs the checks; [fake:play] looks at the skills; [fake:library=…] looks in the template library. Otherwise it answers in one sentence.
// Pure apart from the optional delay: no imports.

const FAKE_MODEL = "fake-model";
const MARK = /\[(usage|fake):([^\]]*)\]/gi;

/** Every marker in a text → { in, out, model, error, slow, flags:Set }. */
export function parseMarkers(text) {
  const o = { in: null, out: null, model: null, error: null, slow: null, flags: new Set(), args: {} };
  for (const m of String(text ?? "").matchAll(MARK)) {
    const kind = m[1].toLowerCase(), body = m[2].trim();
    if (kind === "usage") { for (const kv of body.split(",")) { const [k, v] = kv.split("=").map((x) => x.trim()); if (k === "in" && /^\d+$/.test(v)) o.in = Number(v); if (k === "out" && /^\d+$/.test(v)) o.out = Number(v); } continue; }
    const [k, v] = body.split("=").map((x) => x.trim());
    if (k === "model" && v) o.model = v; else if (k === "error" && v) o.error = v.toLowerCase(); else if (k === "slow") o.slow = /^\d+$/.test(v ?? "") ? Number(v) : 8000; else { o.flags.add(k.toLowerCase()); if (v) o.args[k.toLowerCase()] = v; }
  }
  return o;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const titleOf = (text) => { const t = String(text ?? "").replace(MARK, "").replace(/\s+/g, " ").trim().split(/[.!?\n]/)[0].split(" ").slice(0, 6).join(" ").replace(/[^\w ,'’-]/g, "").trim(); return (t || "Test document").slice(0, 60); };
const usageOf = (m, request) => ({ input: m.in ?? Math.max(1, Math.ceil(String(request).length / 4)), output: m.out ?? 600 });

/** The draft the brief path expects (DRAFT_SCHEMA). `nosig` names two parties but lets only one of them sign. */
export function fakeDraft(request, { nosig = false } = {}) {
  const title = titleOf(request);
  const document = [
    `## ${title}`, "",
    `This agreement is between {{Client name;type=text;role=Client;label=Client name}} (the “Client”) and the Provider (the “Provider”). The Client and the Provider both sign below.`, "",
    "## What this covers", "",
    "The Provider will do the work the Client asked for, on the dates agreed in writing. The Client will pay what was agreed and give the Provider what it needs to do the work.", "",
    "## Signatures", "",
    `Client: {{Client signature;type=signature;role=Client}} {{Client date signed;type=date_signed;role=Client}}`, "",
    ...(nosig ? [] : [`Provider: {{Provider signature;type=signature;role=Provider}} {{Provider date signed;type=date_signed;role=Provider}}`, ""]),
  ].join("\n");
  return {
    title, document,
    people: nosig ? [{ role: "Client", action: "signer", step: 1 }] : [{ role: "Client", action: "signer", step: 1 }, { role: "Provider", action: "signer", step: 2 }],
    signing_order: "all", email_subject: `Please sign: ${title}`, email_message: "Hello, please read and sign. Thank you.", reminders: "3_7", expiry_days: 30,
    assumptions: ["This is a draft from the test provider."], open_questions: [], careful: [],
  };
}

/** A non-brief draft or an edit (the older shapes): the source document, or patches. */
function fakeLegacy(system, user, request) {
  const edit = /patches/i.test(String(system)) && /replace_text|insert_block/i.test(String(system));
  if (edit) return { patches: [{ op: "insert_block", after: 1, node: { type: "paragraph", content: [{ type: "text", text: `Edited by the test provider: ${titleOf(request)}.` }] } }], message: "One paragraph added (test provider)." };
  return { title: titleOf(request), source: { type: "doc", content: [{ type: "heading", attrs: { level: 2, key: "s1" }, content: [{ type: "text", text: titleOf(request) }] }, { type: "paragraph", content: [{ type: "text", text: "This is a draft from the test provider." }] }] }, notes: [] };
}

/**
 * The same result shape as callModel() in providers.mjs.
 * @param {{system?:string, user?:string, schema?:object|null, model?:string, maxTokens?:number}} a
 */
export async function fakeCall({ system = "", user = "", schema = null, model = "" } = {}) {
  const userText = Array.isArray(user) ? user.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : `${user}`;
  const request = userText;
  const m = parseMarkers(`${system}\n${userText}`);
  if (m.slow) await wait(m.slow);
  const u = usageOf(m, `${system}${userText}`);
  const reported = m.model || model || FAKE_MODEL;
  const fail = (message, extra) => ({ ok: false, text: null, inputTokens: null, outputTokens: null, refused: false, message, ...extra });
  if (m.error === "timeout") return fail("The AI provider did not answer in time; try again.", { kind: "timeout", retryable: false });
  if (m.error === "429") return fail("The AI provider is busy; try again in a minute.", { kind: "http", status: 429, retryable: true });
  if (m.error === "500") return fail("The AI provider did not answer; try again.", { kind: "http", status: 500, retryable: true });
  if (m.error === "toolong") return fail("The draft was longer than the space the assistant had for it, so it stopped part way. Ask for a shorter document, or split it in two.", { kind: "length", inputTokens: u.input, outputTokens: u.output });
  const ok = (text) => ({ ok: true, text, inputTokens: u.input, outputTokens: u.output, usage: { input: u.input, output: u.output, cacheRead: 0, cacheWrite: 0 }, model: reported, refused: false, message: null });
  if (m.error === "malformed") return ok("this is not json {");
  if (m.error === "empty") return ok("{}");
  // the AI look for fields (detect/aiFind.mjs): three prompts, each answered from the numbered candidates in the request. [fake:look=nonform] says "not a form page"; [fake:look=dropfirst] keeps all but the first;
  // [fake:look=newrole] names a person with no seat; [fake:look=check1] makes the small model call the first kept box wrong.
  const cands = () => { try { return JSON.parse(/CANDIDATES: (.*)$/s.exec(userText)?.[1]?.split("\n")[0] ?? "[]"); } catch { return []; } };
  const lookMode = /\[fake:look=([a-z0-9]+)\]/i.exec(`${system}\n${userText}`)?.[1]?.toLowerCase() ?? "";
  if (/You decide which numbered boxes/.test(String(system))) {
    const list = cands(); const sure = list.filter((c) => c.sure >= 0.6 && !/\[fake:drop\]/.test(c.label ?? ""));
    if (lookMode === "nonform" || !sure.length) return ok(JSON.stringify({ form_page: false, keep: [] }));
    return ok(JSON.stringify({ form_page: true, keep: (lookMode === "dropfirst" ? sure.slice(1) : sure).map((c) => c.n) }));
  }
  if (/You name blanks that a person has already confirmed/.test(String(system))) {
    const seat = /Seats: ([a-z0-9_]+)/.exec(userText)?.[1] ?? "signer_1";
    return ok(JSON.stringify({ boxes: cands().map((c, i) => ({ n: c.n, type: c.type, label: c.label ?? `Box ${c.n}`, role: lookMode === "newrole" && i === 0 ? "Landlord" : seat })) }));
  }
  if (/You double-check the boxes/.test(String(system))) return ok(JSON.stringify({ wrong: lookMode === "check1" ? [cands()[0]?.n].filter(Boolean) : [] }));
  const wantsReview = /Reply with only JSON: \{"issues"/.test(String(system));
  if (wantsReview) return ok(JSON.stringify({ issues: [] }));
  if (schema && schema.properties?.document) return ok(JSON.stringify(fakeDraft(request, { nosig: m.error === "nosig" })));
  return ok(JSON.stringify(fakeLegacy(system, user, request)));
}

/** The chat stream the orchestrator reads (same events as streamAnthropic). `messages` is the Anthropic-shaped history; the last user text carries the markers. */
export async function* fakeStream({ model = "", system = "", messages = [], tools = [] } = {}) {
  const last = [...messages].reverse().find((x) => x.role === "user" && (typeof x.content === "string" || (Array.isArray(x.content) && x.content.some((b) => b?.type === "text"))));
  const lastText = typeof last?.content === "string" ? last.content : (last?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  const m = parseMarkers(lastText);
  const afterTool = messages.at(-1)?.role === "user" && Array.isArray(messages.at(-1).content) && messages.at(-1).content.every((b) => b?.type === "tool_result");
  if (m.slow) await wait(m.slow);
  const u = usageOf(m, `${JSON.stringify(system).length > 0 ? lastText : ""}${JSON.stringify(messages).length}`);
  if (m.error === "timeout") { yield { type: "error", status: 0, kind: "network", message: "The AI provider could not be reached; try again." }; return; }
  if (m.error === "429") { yield { type: "error", status: 429, kind: "rate_limited", message: "The AI provider is busy; try again in a minute." }; return; }
  if (m.error === "500") { yield { type: "error", status: 500, kind: "provider", message: "The AI provider did not answer; try again." }; return; }
  const has = (n) => tools.some((t) => t.name === n);
  const content = []; const usage = { input: u.input, output: u.output, cacheRead: 0, cacheCreation: 0 };
  let stopReason = "end_turn";
  if (!afterTool) {
    const call = m.flags.has("create") && has("docustay.doc.create") ? { name: "docustay.doc.create", input: { title: titleOf(lastText), from: "blocks", blocks: [{ type: "heading", text: titleOf(lastText) }, { type: "paragraph", text: "This agreement is a draft from the test provider." }, { type: "signature", role: "Client" }], people: [{ name: "Test Person", email: "test.person@example.test", role: "Client", action: "signer" }], test: true } }
      : m.flags.has("ask") && has("docustay.ask.questions") ? { name: "docustay.ask.questions", input: { questions: [{ header: "Form type", question: "What kind of form is this?", options: [{ label: "Job application", description: "Name, contact details, a resume upload and a signature", recommended: true }, { label: "Event sign-up", description: "Name, email and which day" }, { label: "Volunteer form", description: "Contact details and agreement to the rules" }] }] } }
      : m.flags.has("form") && has("docustay.template.create") ? { name: "docustay.template.create", input: { name: titleOf(lastText.split("\n").filter((x) => x.trim()).at(-1)), kind: "form", blocks: [{ type: "heading", text: titleOf(lastText.split("\n").filter((x) => x.trim()).at(-1)) }, { type: "paragraph", text: "Fill this in and sign at the end (test provider)." }, { type: "field", fieldType: "text", role: "Applicant", label: "Full name" }, { type: "field", fieldType: "email", role: "Applicant", label: "Email" }, { type: "field", fieldType: "phone", role: "Applicant", label: "Phone" }, { type: "field", fieldType: "date", role: "Applicant", label: "Start date" }, { type: "signature", role: "Applicant" }] } }
      : m.flags.has("run_check") && has("docustay.doc.run_check") ? { name: "docustay.doc.run_check", input: {} }
      : m.flags.has("play") && has("docustay.plays.list") ? { name: "docustay.plays.list", input: {} }
      // Run 9 Part 4R: [fake:library=rental application] looks in the template library first; [fake:fromlib=rental-application] makes the draft from that built-in
      : m.flags.has("library") && has("docustay.library.find") ? { name: "docustay.library.find", input: { query: m.args.library ?? "" } }
      : m.flags.has("fromlib") && has("docustay.doc.create") ? { name: "docustay.doc.create", input: { title: titleOf(lastText), from: "library", library: m.args.fromlib ?? "", people: [(() => { const [pn, pe] = String(m.args.person ?? "").split("|"); return pn && pe ? { name: pn.trim(), email: pe.trim(), role: "Applicant", action: "signer" } : { name: "Test Person", email: "test.person@example.test", role: "Applicant", action: "signer" }; })()], test: true } }
      : m.flags.has("detect") && has("docustay.pdf.detect_fields") ? { name: "docustay.pdf.detect_fields", input: {} }
      : m.flags.has("place") && has("docustay.pdf.propose_fields") ? { name: "docustay.pdf.propose_fields", input: { summary: "Place the boxes the program is sure about (test provider)", place: "confident" } }
      // Run 9 — Scribe actions and questions: [fake:remind_many=lease] · [fake:find=nda|not_signed|2026-09-01|2026-09-30] · [fake:explain=Early termination] · [fake:template] · [fake:reminders=3,7] · [fake:void] · [fake:sendcheck]
      : m.flags.has("remind_many") && has("docustay.confirm.remind_many") ? { name: "docustay.confirm.remind_many", input: { query: m.args.remind_many ?? "" } }
      : m.flags.has("find") && has("docustay.docs.find") ? (() => { const [words, state, from, to] = String(m.args.find ?? "").split("|"); return { name: "docustay.docs.find", input: { ...(words ? { words } : {}), ...(state ? { state } : {}), ...(from ? { from, dateOf: "made" } : {}), ...(to ? { to } : {}), question: titleOf(lastText.split("\n").filter((x) => x.trim()).at(-1)) } }; })()
      : m.flags.has("explain") && has("docustay.docs.explain_clause") ? { name: "docustay.docs.explain_clause", input: { clause: m.args.explain ?? "", explanation: `(test provider) “${m.args.explain ?? ""}” says what happens in that case, in plain words.` } }
      : m.flags.has("template") && has("docustay.confirm.make_template") ? { name: "docustay.confirm.make_template", input: {} }
      : m.flags.has("reminders") && has("docustay.confirm.set_reminders") ? { name: "docustay.confirm.set_reminders", input: { days: String(m.args.reminders ?? "").split(",").filter(Boolean).map(Number) } }
      : m.flags.has("void") && has("docustay.confirm.void") ? { name: "docustay.confirm.void", input: { reason: "Sent to the wrong person (test provider)" } }
      : m.flags.has("sendcheck") && has("docustay.doc.check_before_sending") ? { name: "docustay.doc.check_before_sending", input: {} }
      : m.flags.has("propose") && has("docustay.doc.propose_changes") ? { name: "docustay.doc.propose_changes", input: { summary: "Add one sentence (test provider)", patches: [{ op: "insert_block", after: 1, node: { type: "paragraph", content: [{ type: "text", text: "Added by the test provider." }] } }] } }
      : null;
    if (call) { const id = `toolu_fake_${Math.random().toString(36).slice(2, 10)}`; content.push({ type: "tool_use", id, name: call.name, input: call.input }); yield { type: "tool_use", id, name: call.name, input: call.input }; stopReason = "tool_use"; }
  }
  if (stopReason !== "tool_use") {
    const text = afterTool ? "Done. That is the test provider's summary of what happened." : `This is the test provider's answer (${model || FAKE_MODEL}).`;
    for (const part of text.match(/.{1,24}/g) ?? [text]) yield { type: "text", text: part };
    content.push({ type: "text", text });
  }
  yield { type: "done", stopReason, content, usage, model: m.model || model || FAKE_MODEL };
}
