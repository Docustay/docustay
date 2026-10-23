// PLAN-AWARE PROMPTING, THE WEB'S ONE COPY (Part 2, 19 Oct 2026; specs/v1/PROMPTING-SPEC.md). The server decides (POST /api/product/docustay/preflight and the options on every refusal); this file only asks,
// remembers what the person dismissed, keeps to one prompt a screen, and reports what happened. Nothing here knows a price: every number and every word of an option arrives in the answer.
import { api } from "$lib/api.js";
import { plan } from "./plan.svelte.js";

/** The refusal codes a gate throws, and the preflight action that asks the same question first. */
export const ACTION_OF = Object.freeze({ plan_document_limit: "send_document", budget_reached: "send_document", plan_people_limit: "invite_person", plan_template_limit: "create_template", plan_signer_limit: "send_document",
  ai_limit_credits: "ai_draft", ai_limit_usd: "ai_draft", plan_pro_required: "use_feature", too_big: "upload" });
export const LIMIT_CODES = Object.freeze(Object.keys(ACTION_OF));
/** The server records limit_hit for these itself; the three below are thrown outside the plan code, so the browser reports them. */
const WEB_REPORTS = new Set(["ai_limit_credits", "ai_limit_usd", "too_big"]);
const METER_OF = Object.freeze({ plan_document_limit: "documents", budget_reached: "budget", plan_people_limit: "people", plan_template_limit: "templates", plan_signer_limit: "signers", ai_limit_credits: "drafts", ai_limit_usd: "drafts", plan_pro_required: "feature", too_big: "upload" });

const un = (r) => r?.json?.data ?? r?.json ?? null;
/** Ask the plan before acting. null when it could not be read (the action then simply goes on; the server still refuses what it must). */
export async function askPreflight(action, size = {}, item = null) {
  const r = await api("/api/product/docustay/preflight", { method: "POST", body: { action, ...size, ...(item ? { item } : {}) } });
  return r.ok ? un(r) : null;
}

// ── what is shown ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The one sheet (limit or feature lock) for the whole app; mounted once by PlanSheetHost in the signed-in layout. */
export const planSheet = $state({ answer: null, form: "sheet", ctx: null });
export function showPlanSheet(answer, { form = "sheet", ctx = null } = {}) { if (answer) { planSheet.answer = answer; planSheet.form = form; planSheet.ctx = ctx; } }
export const closePlanSheet = () => { planSheet.answer = null; planSheet.ctx = null; };

/** At most one prompt on a screen: the first note to claim it keeps it; the layout frees it when the route changes. A sheet always wins (the person asked for it by acting). */
const screen = $state({ holder: null });
export const claimScreen = (id) => { if (screen.holder && screen.holder !== id) return false; screen.holder = id; return true; };
export const releaseScreen = (id) => { if (screen.holder === id) screen.holder = null; };
export const resetScreen = () => { screen.holder = null; };
export const screenHolder = () => screen.holder;

/** Soft warnings wait for real value first: nothing before the workspace has sent its first document (the status payload's `usage.everSent`). */
export const beforeFirstSend = () => plan.data?.usage?.everSent !== true;

const dismissKey = (a) => `docustay:prompt-off:${a.meter?.key ?? a.reason ?? a.action}:${a.period?.start ?? "none"}`;
/** Dismissed once for this meter in this billing period (remembered in this browser; a new period asks again). */
export function isDismissed(a) { try { return localStorage.getItem(dismissKey(a)) === "1"; } catch { return false; } }
export function rememberDismissed(a) { try { localStorage.setItem(dismissKey(a), "1"); } catch { /* the note simply shows again next time */ } }

/** What kind of prompt this answer is. `blocked` is a refusal (always said); `price` tells a charge before it happens (never hidden, never dismissed); `soft` is a warning at 80 percent or the last free unit
 *  (once per meter per period, never before the first sent document); `info` is a plain usage line with nothing to buy. */
export function kindOf(a) {
  if (!a) return "none";
  if (a.severity === "blocked" || a.allowed === false) return "blocked";
  if (a.severity === "warn" || a.severity === "limit" || (a.severity === "info" && a.meter?.key === "budget" && a.message && (a.afterThis?.budgetPercent ?? a.meter?.percent ?? 0) >= 50)) return "soft";   // the budget speaks from half way, in money
  if ((a.cost?.minor ?? 0) !== 0 || (a.cost?.feePercent ?? 0) > 0) return "price";
  return a.message ? "info" : "none";   // a plain usage line ("7 of 10 free AI drafts left"): no options, no ask
}

// ── analytics ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const seenShown = new Set();
/** prompt_shown (once per prompt per page load), prompt_clicked, prompt_dismissed, limit_hit. Facts only; the server adds the plan and the is_test flag. Fire and forget. */
export function report(name, a, { form = "note", option = null, once = false } = {}) {
  try {
    if (!a) return;
    const k = `${name}:${form}:${a.action}:${a.reason ?? ""}:${a.severity}:${option ?? ""}`;
    if (once) { if (seenShown.has(k)) return; seenShown.add(k); }
    void api("/api/product/docustay/prompt-event", { method: "POST", body: { name, action: a.action, severity: a.severity, form, meter: a.meter?.key ?? METER_OF[a.reason] ?? (a.action === "connect_payments" ? "fee" : a.action === "use_feature" ? "feature" : undefined), reason: a.reason ?? undefined, option: option ?? undefined, route: typeof location !== "undefined" ? location.pathname.replace(/\/[0-9a-f-]{20,}/g, "").split("/").slice(0, 2).join("/") || "/" : undefined } });
  } catch { /* analytics never gets in the way */ }
}

// ── refusals ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The code a refused call carries, or null when it was not a plan limit. */
export const refusalCode = (r) => { const c = r?.json?.error?.detail?.code; return LIMIT_CODES.includes(c) ? c : null; };

/** Turn a refused API result into a prompt answer: the server's own words, plus the options and the meter (the refusal's own, else one preflight asked after the fact). */
export async function fromRefusal(r, { action = null, size = {}, item = null } = {}) {
  const code = refusalCode(r); if (!code) return null;
  const d = r.json.error.detail ?? {}, act = action ?? ACTION_OF[code];
  let ans = { action: act, allowed: false, plan: plan.data?.plan ? { key: String(plan.data.plan.key).replace(/^docustay_/, ""), name: plan.data.plan.name } : null, period: plan.data?.usage?.periodStart ? { start: plan.data.usage.periodStart, end: plan.data.usage.periodEnd } : null,
    meter: null, cost: { minor: 0 }, afterThis: null, severity: "blocked", reason: code, options: d.options ?? [], message: r.json.error.message ?? "" };
  {   // the refusal says what happened; the preflight adds where the person stands (the meter and the dated reset) and the options
    const p = await askPreflight(act, size, item ?? d.item ?? null);
    if (p) ans = { ...p, allowed: false, severity: "blocked", reason: p.reason ?? code, message: ans.message || p.message, options: ans.options.length ? ans.options : p.options };
  }
  return ans;
}

/** The one thing every call site does with a refused result: if it was a plan limit, say so in the sheet (and report limit_hit for the codes only the browser sees) and return true; otherwise false, and
 *  the caller shows its usual error. */
export async function handleRefusal(r, ctx = {}) {
  const ans = await fromRefusal(r, ctx); if (!ans) return false;
  if (WEB_REPORTS.has(ans.reason)) report("limit_hit", ans, { form: "sheet" });
  showPlanSheet(ans, { form: ans.reason === "plan_pro_required" ? "lock" : "sheet", ctx });
  return true;
}

/** Open the feature lock for a Pro item (what it does, which plans have it). Used by every Pro lock. */
export async function openFeatureLock(item) {
  const ans = await askPreflight("use_feature", {}, item);
  if (ans && ans.allowed === false) showPlanSheet(ans, { form: "lock", ctx: { item } });
  return Boolean(ans);
}
