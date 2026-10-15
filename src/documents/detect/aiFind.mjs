// PDF FIELD DETECTION · "FIND FIELDS WITH AI", AS A BACKGROUND JOB (Run 4). Opt-in, off wherever AI is off, and never the first thing that happens: the program's own detector has already run.
// One job per request (keystone.document_detect_job), one worker task per PAGE, all pages in parallel. For each page the model is shown the page picture, the printed words with positions, and a NUMBERED list of
// boxes the program found (candidates, including the weak ones the normal run hides). It only ever answers with numbers, types, labels and people. It never gives a coordinate: a box on the screen is always one the
// program drew, so the model can drop a false box or rescue a weak one but cannot place anything off the page. Two separate calls per page (task 1: is this a form page, and which numbers are real blanks; task 2: what each
// kept blank is and whose it is), and an optional second check by the small model. Every answer is validated by plain code here; a page that cannot be answered keeps the program's own result and says so.
// Cost: ONE admission for the whole file up front (allowance, dollar caps, request rates), then each page's calls are written to the ledger as they finish; a file is limited to DETECT_AI.maxPages pages and a dollar cap.
// The result waits on the job until the editor applies it (applyDetectJob): the worker never writes into the person's saved draft while they are editing it.
import { conflict, notFound } from "../../http/errors.mjs";
import { emit, userActor } from "../../events/outbox.mjs";
import { parsePdfBodyData } from "../pdfBody.mjs";
import { readFileBytes } from "../files.mjs";
import { ports } from "../ports.mjs";
import { callModelRetry, readAiConfig, resolveKey } from "../engine/ai/jobs.mjs";
import { admit, finish, loadPolicy } from "../engine/ai/gateway.mjs";
import { modelFor } from "../engine/ai/modelPolicy.mjs";
import { extractJson } from "../engine/ai/providers.mjs";
import { costOf } from "../engine/ai/prices.mjs";
import { TASK1_SYSTEM, TASK2_SYSTEM, CHECK_SYSTEM, validateTask1, validateTask2, validateCheck, SAFE } from "./aiFindPure.mjs";
import { detect } from "./index.mjs";
import { suggestionsFrom } from "./toBody.mjs";
import { openPdf, renderPage, pagePng, pageWords } from "./render.mjs";

const DETECT_AI = Object.freeze({
  maxPages: Number(process.env.KEYSTONE_DETECT_AI_MAX_PAGES) || 20,        // pages looked at in one file; the rest keep the program's own result
  maxMicroUsdPerFile: Number(process.env.KEYSTONE_DETECT_AI_MAX_USD_MICRO) || 600_000,   // a hard stop for one file, in millionths of a dollar, checked before every page
  maxCandidatesPerPage: 70, maxWordsPerPage: 260, pageTimeoutMs: 75_000, staleMinutes: 4,
});
// ── building one page's request ──────────────────────────────────────────────────────────────────────────────────
const r3 = (v) => Math.round(v * 1000) / 1000;
const candLine = (c) => ({ n: c.n, type: c.type, label: c.label ?? null, x: r3(c.x), y: r3(c.y), w: r3(c.w), h: r3(c.h), sure: c.confidence, from: c.source });
async function pageMaterial(tx, { bytes, page, scanned }) {
  const { pdf, task } = await openPdf(bytes);
  try {
    const img = await renderPage(pdf, page, { dpi: 100 }), png = await pagePng(img, 1000);
    let words = []; if (!scanned) { const w = await pageWords(pdf, page); words = w.words.filter((x) => /[\p{L}\p{N}]/u.test(x.str)).slice(0, DETECT_AI.maxWordsPerPage).map((x) => ({ t: SAFE(x.str, 30), x: r3(x.x), y: r3(x.y) })); }
    return { png, words };
  } finally { try { await task.destroy(); } catch { /* released */ } }
}
const imageBlock = (png) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
const userFor = ({ png, words, cands, seats, page, extra = "" }) => [imageBlock(png), { type: "text", text: `Page ${page}.${seats?.length ? ` Seats: ${seats.map((s) => `${s.key} (${s.label})`).join(", ")}.` : ""}\nWORDS: ${JSON.stringify(words)}\nCANDIDATES: ${JSON.stringify(cands.map(candLine))}${extra}` }];
const usageOf = (r) => r?.usage ?? { input: r?.inputTokens ?? 0, output: r?.outputTokens ?? 0 };

// ── the database side ────────────────────────────────────────────────────────────────────────────────────────────
const publicJob = (r) => ({
  id: r.id, instanceId: r.instance_id, state: r.state, pagesTotal: r.pages_total, pagesDone: r.pages_done, message: r.message ?? null, credits: Number(r.credits), provider: r.provider, model: r.model,
  failedPages: Object.entries(r.pages ?? {}).filter(([k, v]) => k !== "_meta" && v?.state === "failed").map(([k]) => Number(k)).sort((a, b) => a - b),
  skippedPages: Object.entries(r.pages ?? {}).filter(([k, v]) => k !== "_meta" && v?.state === "skipped").map(([k]) => Number(k)).sort((a, b) => a - b), createdAt: r.created_at, finishedAt: r.finished_at ?? null,
});
const insideAny = (fields, s) => fields.some((f) => { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; return f.page === s.page && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h; });

/** Ask for the AI look at a draft. Returns at once with the job; the pages are worked by the worker. Throws a plain-words refusal when AI is off, the allowance is used or the file has nothing for it to look at. */
export async function createDetectJob(tx, { tenantId, actorUserId = null, instanceId, secondCheck = false, env = process.env, emit: emitFn = emit }) {
  const cfg = await readAiConfig(tx);
  if (!cfg.enabled) throw conflict("AI is not turned on for this workspace. Find fields still works without it.", { code: "ai_off" });
  if (!["anthropic", "fake"].includes(cfg.provider)) throw conflict("The AI look needs Anthropic's models: the chosen provider cannot read pictures.", { code: "no_vision" });
  const { rows: [i] } = await tx.query(`SELECT state, template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (!i) throw notFound("no such document");
  if (i.state !== "draft") throw conflict("Only a draft can be searched for fields.", { code: "not_draft" });
  const body = parsePdfBodyData(i.template_body_snapshot ?? {});
  const { rows: [busy] } = await tx.query(`SELECT id FROM keystone.document_detect_job WHERE instance_id = $1 AND state IN ('queued','running') LIMIT 1`, [instanceId]);
  if (busy) throw conflict("The AI is already looking at this document.", { code: "detect_busy", jobId: busy.id });
  const { bytes } = await readFileBytes(tx, { fileId: body.file.file_id });
  const [weak, normal] = await Promise.all([detect(bytes, { timeoutMs: 60_000, minConfidence: 0.3 }), detect(bytes, { timeoutMs: 60_000 })]);
  if (!weak.ok) throw conflict(weak.reason === "timeout" ? "That file took too long to read." : "That file could not be read for fields.", { code: "detect_failed" });
  const cand = suggestionsFrom(structuredClone(weak.result)).suggestions, base = normal.ok ? suggestionsFrom(structuredClone(normal.result)).suggestions : [];
  const pages = {}; let work = 0;
  const pageNos = [...new Set([...weak.result.pages.map((p) => p.page)])].sort((a, b) => a - b);
  for (const p of pageNos) {
    const info = weak.result.pages.find((x) => x.page === p), onPage = cand.filter((c) => c.page === p).sort((a, b) => a.y - b.y || a.x - b.x);
    const exact = onPage.some((c) => c.source === "native" || c.source === "remembered");
    const entry = { cand: onPage.slice(0, DETECT_AI.maxCandidatesPerPage).map((c, k) => ({ n: k + 1, type: c.type, x: c.x, y: c.y, w: c.w, h: c.h, confidence: c.confidence, source: c.source, ...(c.label ? { label: c.label } : {}), ...(c.sensitive ? { sensitive: true } : {}), ...(c.format ? { format: c.format } : {}), ...(c.group ? { group: c.group } : {}) })), base: base.filter((b) => b.page === p), scanned: Boolean(info?.scanned) };
    if (exact) pages[p] = { ...entry, state: "skipped", message: "This page already has fields of its own; they are exact." };
    else if (!entry.cand.length) pages[p] = { ...entry, state: "skipped", message: "The program found nothing on this page to look at." };
    else if (work >= DETECT_AI.maxPages) pages[p] = { ...entry, state: "skipped", message: `Only the first ${DETECT_AI.maxPages} pages are looked at.` };
    else { pages[p] = { ...entry, state: "queued", attempts: 0 }; work += 1; }
  }
  if (!work) throw conflict("The program found no boxes on these pages for the AI to look at.", { code: "nothing_to_look_at" });
  const policy = env.KEYSTONE_SELF_HOST === "1" ? null : await loadPolicy(tx, { tenantId });
  const perPage = policy?.weights?.detect ?? 0;
  const adm = await admit(tx, { tenantId, userId: actorUserId, feature: "detect", cfg, weight: perPage * work, env });
  pages._meta = { own: adm.own, planKey: adm.planKey, effort: adm.effort, perPage, requestId: adm.requestId, model: adm.model };
  const seats = [...body.roles, ...weak.result.roles.filter((r) => !body.roles.some((x) => x.key === r.key))];
  const { rows: [row] } = await tx.query(
    `INSERT INTO keystone.document_detect_job (tenant_id, instance_id, pages_total, pages, seats, second_check, provider, model, requested_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING id`,
    [tenantId, instanceId, work, JSON.stringify(pages), JSON.stringify(seats), secondCheck === true, cfg.provider, adm.model, actorUserId]);
  await emitFn(tx, { tenantId, topic: "documents.detect.job_requested", emittedBy: "documents", subjectType: "document_detect_job", subjectId: row.id, actor: userActor(actorUserId), payload: { job_id: row.id, instance_id: instanceId, pages: Object.entries(pages).filter(([k, v]) => k !== "_meta" && v.state === "queued").map(([k]) => Number(k)) } });
  return { jobId: row.id, state: "queued", pagesTotal: work };
}

export async function getDetectJob(tx, { jobId }) {
  const { rows: [r] } = await tx.query(`SELECT * FROM keystone.document_detect_job WHERE id = $1`, [jobId]);
  if (!r) throw notFound("That AI look was not found.");
  return publicJob(r);
}
export async function cancelDetectJob(tx, { jobId }) {
  await tx.query(`UPDATE keystone.document_detect_job SET state = 'cancelled', finished_at = now(), message = 'Cancelled.' WHERE id = $1 AND state IN ('queued','running')`, [jobId]);
  return getDetectJob(tx, { jobId });
}

/** The pages of this job that are waiting (or whose worker died) and should be started again. A sweep calls this; a page is claimed atomically so a double start does nothing. */
export async function stalePagesOf(tx) {
  const { rows } = await tx.query(
    `SELECT j.id, j.tenant_id, e.key AS page FROM keystone.document_detect_job j, jsonb_each(j.pages) e
      WHERE j.state IN ('queued','running') AND e.key <> '_meta' AND (e.value->>'state' = 'queued' AND j.created_at < now() - interval '45 seconds'
         OR e.value->>'state' = 'running' AND (e.value->>'startedAt')::timestamptz < now() - ($1 || ' minutes')::interval)`, [String(DETECT_AI.staleMinutes)]);
  return rows.map((r) => ({ jobId: r.id, tenantId: r.tenant_id, page: Number(r.page) }));
}

/** The worker's side for ONE page. Idempotent: a page that is not waiting is left alone. `run(fn, { userId })` opens a short tenant transaction per statement (as that person when given) so none is held open across the model calls. */
export async function runDetectPage(run, { tenantId, jobId, page }, opts = {}) {
  const dtx = { query: (sql, params) => run((t) => t.query(sql, params)) };
  const env = opts.env ?? process.env, key = String(page);
  const { rows: [job] } = await dtx.query(
    `UPDATE keystone.document_detect_job j SET state = 'running', started_at = coalesce(started_at, now()),
            pages = jsonb_set(pages, ARRAY[$2::text], (pages->$2::text) || jsonb_build_object('state', 'running', 'startedAt', now()::text, 'attempts', coalesce((pages->$2::text->>'attempts')::int, 0) + 1))
      WHERE j.id = $1 AND j.state IN ('queued','running') AND ((pages->$2::text->>'state') = 'queued' OR ((pages->$2::text->>'state') = 'running' AND (pages->$2::text->>'startedAt')::timestamptz < now() - ($3 || ' minutes')::interval AND coalesce((pages->$2::text->>'attempts')::int, 0) < 3))
    RETURNING j.*`, [jobId, key, String(DETECT_AI.staleMinutes)]);
  if (!job) return { claimed: false };
  const pg = job.pages[key], meta = job.pages._meta ?? {};
  const asRequester = { query: (sql, params) => run((t) => t.query(sql, params), { userId: job.requested_by ?? null }) };   // a draft is visible to the person it belongs to: the page reads it as them
  const save = async (patch, usage, credits) => {
    const merged = { ...pg, ...patch, finishedAt: new Date().toISOString() }; delete merged.startedAt;
    const { rows: [u] } = await dtx.query(
      `UPDATE keystone.document_detect_job SET pages = jsonb_set(pages, ARRAY[$2::text], $3::jsonb), pages_done = pages_done + 1, input_tokens = input_tokens + $4, output_tokens = output_tokens + $5, credits = credits + $6
        WHERE id = $1 AND (pages->$2::text->>'state') = 'running' RETURNING id`, [jobId, key, JSON.stringify(merged), Math.round(usage.input), Math.round(usage.output), credits]);
    if (!u) return false;
    await dtx.query(
      `UPDATE keystone.document_detect_job j SET finished_at = now(), state = CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_each(j.pages) e WHERE e.key <> '_meta' AND e.value->>'state' = 'done') THEN 'failed' ELSE 'done' END,
              message = CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_each(j.pages) e WHERE e.key <> '_meta' AND e.value->>'state' = 'done') THEN 'The AI could not read these pages. The program''s own result is kept.' ELSE j.message END
        WHERE j.id = $1 AND j.state = 'running' AND NOT EXISTS (SELECT 1 FROM jsonb_each(j.pages) e WHERE e.key <> '_meta' AND e.value->>'state' IN ('queued','running'))`, [jobId]);
    return true;
  };
  const tokens = { input: 0, output: 0 }; let credits = 0;
  const failPage = (message) => save({ state: "failed", message }, tokens, credits);
  try {
    if (job.state === "cancelled") return { claimed: true, state: "cancelled" };
    const spent = costOf({ model: job.model, input: job.input_tokens, output: job.output_tokens }).micro;
    if (spent >= DETECT_AI.maxMicroUsdPerFile) { await save({ state: "skipped", message: "This file reached its AI cost limit; the program's own result is kept for this page." }, tokens, 0); return { claimed: true, state: "skipped" }; }
    const cfg = await readAiConfig(dtx);
    const apiKey = await resolveKey(dtx, { tenantId, provider: job.provider, env });
    if (!apiKey && job.provider !== "fake") { await failPage("AI is not set up: no key is available."); return { claimed: true, state: "failed" }; }
    const { rows: [inst] } = await asRequester.query(`SELECT template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [job.instance_id]);
    const body = parsePdfBodyData(inst?.template_body_snapshot ?? {});
    const { bytes } = await readFileBytes(asRequester, { fileId: body.file.file_id });
    const { png, words } = await pageMaterial(dtx, { bytes, page, scanned: pg.scanned });
    const seats = job.seats ?? [], seatKeys = new Set(seats.map((s) => s.key));
    const policy = env.KEYSTONE_SELF_HOST === "1" ? null : await loadPolicy(dtx, { tenantId });
    const ctx = { tenantId, userId: job.requested_by, feature: "detect", provider: job.provider, model: job.model, effort: meta.effort ?? null, own: Boolean(meta.own), policy, weight: meta.perPage ?? 0, planKey: meta.planKey ?? null, requestId: meta.requestId ?? null, startedAt: Date.now() };
    const call = async (system, user, ctx2, creditsHere) => {
      const r = await callModelRetry({ provider: job.provider, model: ctx2.model, effort: ctx2.effort, endpoint: cfg.endpoint, apiKey, system, user, maxTokens: 1500, timeoutMs: opts.timeoutMs ?? DETECT_AI.pageTimeoutMs, fetchImpl: opts.fetchImpl, retryDelays: opts.retryDelays, env });
      const u = usageOf(r); tokens.input += u.input ?? 0; tokens.output += u.output ?? 0;
      await finish(dtx, ctx2, { status: r.ok ? "ok" : "error", usage: u, code: r.ok ? null : (r.kind ?? "error"), model: r.model || undefined, credits: r.ok ? creditsHere : 0 });
      if (r.ok) credits += creditsHere;
      return r;
    };
    // task 1: is this a form page, and which numbered boxes are real blanks
    const t1 = await call(TASK1_SYSTEM, userFor({ png, words, cands: pg.cand, seats, page }), ctx, meta.perPage ?? 0);
    if (!t1.ok) { await failPage(t1.message ?? "The AI did not answer."); return { claimed: true, state: "failed" }; }
    const a1 = validateTask1(extractJson(t1.text), pg.cand.length);
    if (!a1) { await failPage("The AI's answer could not be read."); return { claimed: true, state: "failed" }; }
    if (!a1.form) { await save({ state: "done", form: false, boxes: [] }, tokens, credits); return { claimed: true, state: "done" }; }
    // task 2: what each kept box is, and whose
    const kept = pg.cand.filter((c) => a1.keep.includes(c.n));
    const t2 = await call(TASK2_SYSTEM, userFor({ png, words, cands: kept, seats, page }), ctx, 0);
    let boxes = validateTask2(t2.ok ? extractJson(t2.text) : null, pg.cand, a1.keep, seatKeys);
    // optional second check by the small model
    if (job.second_check) {
      const small = { ...ctx, ...modelFor({ feature: "vision_check", env }), feature: "vision_check", weight: 0 };
      const t3 = await call(CHECK_SYSTEM, userFor({ png, words: [], cands: kept, seats: [], page }), small, 0);
      if (t3.ok) { const wrong = new Set(validateCheck(extractJson(t3.text), a1.keep)); boxes = boxes.filter((b) => !wrong.has(b.n)); }
    }
    await save({ state: "done", form: boxes.length > 0, boxes }, tokens, credits);
    return { claimed: true, state: "done" };
  } catch (e) {
    console.error(`detect page job=${jobId} page=${page}: ${e?.message ?? e}`);
    if (await failPage("This page could not be read by the AI. The program's own result is kept.").catch(() => false)) return { claimed: true, state: "failed" };
    throw e;
  }
}

/** Put the job's result into the draft: the AI's pick for every page it answered, the program's own result for every page it did not. Fields the person has already placed are never touched. Safe to call again. */
export async function applyDetectJob(tx, { jobId }) {
  const { rows: [j] } = await tx.query(`SELECT * FROM keystone.document_detect_job WHERE id = $1`, [jobId]);
  if (!j) throw notFound("That AI look was not found.");
  if (j.state === "queued" || j.state === "running") throw conflict("The AI is still looking at this document.", { code: "detect_running" });
  const { rows: [i] } = await tx.query(`SELECT state, template_body_snapshot FROM keystone.document_instance WHERE id = $1`, [j.instance_id]);
  if (!i) throw notFound("no such document");
  if (i.state !== "draft") throw conflict("Only a draft can be searched for fields.", { code: "not_draft" });
  const body = parsePdfBodyData(i.template_body_snapshot ?? {});
  const roles = [...body.roles]; const have = new Set(roles.map((r) => r.key)); const nameToKey = new Map(roles.map((r) => [r.label.toLowerCase(), r.key]));
  const newRole = (name) => { const k = nameToKey.get(name.toLowerCase()); if (k) return k; if (roles.length >= 12) return null; let n = roles.length + 1; while (have.has(`signer_${n}`)) n += 1; const key = `signer_${n}`; roles.push({ key, label: name.slice(0, 80) }); have.add(key); nameToKey.set(name.toLowerCase(), key); return key; };
  const out = []; let aiPages = 0;
  for (const [k, pg] of Object.entries(j.pages).filter(([k]) => k !== "_meta").sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const p = Number(k);
    if (pg.state === "done") {
      aiPages += 1; const byN = new Map(pg.cand.map((c) => [c.n, c]));
      for (const b of pg.boxes ?? []) {
        const c = byN.get(b.n); if (!c) continue;
        const role = b.roleKey ?? (b.roleName ? newRole(b.roleName) : null) ?? roles[0]?.key ?? "signer_1";
        out.push({ id: `a${p}-${b.n}`, type: b.type, page: p, x: c.x, y: c.y, w: Math.max(0.005, c.w), h: Math.max(0.005, c.h), why: b.label ? `checked by the AI: “${b.label.slice(0, 60)}”` : "checked by the AI", confidence: 0.9, source: "ai", ...(b.label ? { label: b.label.slice(0, 120) } : {}), role, ...(c.sensitive ? { sensitive: true } : {}), ...(c.format ? { format: c.format } : {}), ...(b.group ?? c.group ? { group: String(b.group ?? c.group).slice(0, 40) } : {}) });
      }
    } else for (const s of pg.base ?? []) out.push(s);
  }
  const suggestions = out.filter((s) => !insideAny(body.fields, s)).slice(0, 500);
  const next = { ...body, roles, ...(suggestions.length ? { suggestions } : {}) }; if (!suggestions.length) delete next.suggestions;
  parsePdfBodyData(next);
  await tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, updated_at = now() WHERE id = $1`, [j.instance_id, JSON.stringify(next)]);
  return { suggestions, roles, job: publicJob(j), note: { fields: suggestions.length, signers: roles.length, aiPages, lowConfidence: suggestions.filter((s) => (s.confidence ?? 1) < 0.6).length } };
}
