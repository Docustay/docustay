// AI cost and usage: the pure decisions (limits, model choice, prices). Every refusal has a positive control (the same call, just under the limit, runs).
import test from "node:test";
import assert from "node:assert/strict";
import { decide, fractionUsed, stateOf, MSG } from "../src/documents/engine/ai/limits.mjs";
import { modelFor } from "../src/documents/engine/ai/modelPolicy.mjs";
import { costOf, PRICES, HOSTED_MODELS, DEFAULT_MODEL, THINK_MODEL, INTERNAL_MODEL } from "../src/documents/engine/ai/prices.mjs";
import { aiPolicyFor, aiPlatformCeilingUsd } from "../src/product/docustayPlans.mjs";

const free = aiPolicyFor("docustay_free", {}), pro = aiPolicyFor("docustay_pro", {});
const none = { creditsUsed: 0, usdMicroUsed: 0, userCreditsUsed: 0, perMinute: 0, perHour: 0, perDay: 0, thinkMonth: 0, thinkDay: 0, failuresInWindow: 0, lastFailureAt: null };

test("the defaults the maintainer approved: Free 10 credits, Pro 150, caps $1.50 and $24", () => {
  assert.equal(free.creditsPerMonth, 10); assert.equal(pro.creditsPerMonth, 150);
  assert.equal(free.usdCapMicro, 1_500_000); assert.equal(pro.usdCapMicro, 24_000_000);
  assert.equal(aiPlatformCeilingUsd({}), 150);
  assert.equal(aiPolicyFor("docustay_pro", { KEYSTONE_AI_PRO_CREDITS: "12.5" }).creditsPerMonth, 12.5);
  assert.equal(aiPolicyFor("workbench_x"), null);
});
test("credits: a draft that fits runs; the one that would pass the allowance is refused with the plan's own sentence", () => {
  assert.equal(decide({ policy: free, usage: { ...none, creditsUsed: 9 }, weight: 1 }).ok, true);
  const r = decide({ policy: free, usage: { ...none, creditsUsed: 9.5 }, weight: 1 });
  assert.equal(r.ok, false); assert.equal(r.code, "ai_limit_credits"); assert.match(r.message, /allowance for this month is used/); assert.match(r.message, /Upgrade to Pro for 150 credits/);
  const p = decide({ policy: pro, usage: { ...none, creditsUsed: 150 }, weight: 1, resetsOnText: "1 Nov" });
  assert.match(p.message, /resets on 1 Nov/); assert.doesNotMatch(p.message, /Upgrade/);
});
test("the dollar cap stops AI even when credits remain", () => {
  assert.equal(decide({ policy: free, usage: { ...none, creditsUsed: 1, usdMicroUsed: 1_499_999 }, weight: 1 }).ok, true);
  assert.equal(decide({ policy: free, usage: { ...none, creditsUsed: 1, usdMicroUsed: 1_500_000 }, weight: 1 }).code, "ai_limit_usd");
});
test("request limits: minute, hour, day (and just under each runs)", () => {
  assert.equal(decide({ policy: pro, usage: { ...none, perMinute: 4 }, weight: 1 }).ok, true);
  assert.equal(decide({ policy: pro, usage: { ...none, perMinute: 5 }, weight: 1 }).code, "ai_rate_minute");
  assert.equal(decide({ policy: pro, usage: { ...none, perHour: 60 }, weight: 1 }).code, "ai_rate_hour");
  assert.equal(decide({ policy: free, usage: { ...none, perDay: 5 }, weight: 1 }).code, "ai_rate_day");
  assert.equal(decide({ policy: pro, usage: { ...none, perDay: 39 }, weight: 1 }).ok, true);
  assert.equal(decide({ policy: pro, usage: { ...none, perDay: 40 }, weight: 1 }).code, "ai_rate_day");
});
test("Think harder: Pro only, 20 a month, 3 a day", () => {
  assert.equal(decide({ policy: free, usage: none, weight: 3, thinkHarder: true }).code, "ai_think_pro");
  assert.equal(decide({ policy: pro, usage: { ...none, thinkDay: 2 }, weight: 3, thinkHarder: true }).ok, true);
  assert.equal(decide({ policy: pro, usage: { ...none, thinkDay: 3 }, weight: 3, thinkHarder: true }).code, "ai_think_day");
  assert.equal(decide({ policy: pro, usage: { ...none, thinkMonth: 20 }, weight: 3, thinkHarder: true }).code, "ai_think_month");
});
test("per-person share: only a team of two or more is protected, so a single owner can use the whole allowance", () => {
  assert.equal(decide({ policy: pro, usage: { ...none, userCreditsUsed: 95 }, weight: 1, teamSize: 1 }).ok, true);
  assert.equal(decide({ policy: pro, usage: { ...none, userCreditsUsed: 89 }, weight: 1, teamSize: 3 }).ok, true);
  assert.equal(decide({ policy: pro, usage: { ...none, userCreditsUsed: 89.5 }, weight: 1, teamSize: 3 }).code, "ai_limit_user");
});
test("abuse pause: more than 10 failures in 10 minutes pauses for 15; it ends by itself", () => {
  const now = Date.now();
  assert.equal(decide({ policy: pro, usage: { ...none, failuresInWindow: 10, lastFailureAt: now - 1000 }, weight: 1, now }).ok, true);
  const r = decide({ policy: pro, usage: { ...none, failuresInWindow: 11, lastFailureAt: now - 1000 }, weight: 1, now });
  assert.equal(r.code, "ai_abuse_pause"); assert.ok(r.retryAfterSeconds > 800);
  assert.equal(decide({ policy: pro, usage: { ...none, failuresInWindow: 11, lastFailureAt: now - 16 * 60_000 }, weight: 1, now }).ok, true);
});
test("own provider key: no allowance, no dollar cap, no platform pause; the abuse limit still applies", () => {
  assert.equal(decide({ policy: free, usage: { ...none, creditsUsed: 99, usdMicroUsed: 9e9 }, weight: 1, own: true, platform: { paused: true } }).ok, true);
  assert.equal(decide({ policy: free, usage: { ...none, failuresInWindow: 11, lastFailureAt: Date.now() }, weight: 1, own: true }).code, "ai_abuse_pause");
});
test("platform ceiling or a manual pause stops hosted workspaces with a clear sentence; no policy (self-host) is never stopped by it", () => {
  assert.equal(decide({ policy: pro, usage: none, weight: 1, platform: { paused: false, ceilingReached: true } }).code, "ai_platform_paused");
  assert.equal(decide({ policy: pro, usage: none, weight: 1, platform: { paused: true } }).message, MSG.platform);
  assert.equal(decide({ policy: null, usage: none, weight: 1, platform: { paused: true } }).ok, true);
});
test("the bar: calm under 80, amber at 80, red at 100", () => {
  assert.equal(stateOf(fractionUsed(free, 7.9)), "calm"); assert.equal(stateOf(fractionUsed(free, 8)), "low"); assert.equal(stateOf(fractionUsed(free, 10)), "used");
  assert.equal(fractionUsed(null, 5), null); assert.equal(stateOf(fractionUsed(free, 1, 1_500_000)), "used");
});
test("model choice: Sonnet 5.5 high by default; Haiku 5.5 when picked; hosted cannot pick Fable; own key and self-host can; Think harder is Opus; internal jobs are Haiku", () => {
  assert.deepEqual(modelFor({ feature: "draft" }), { model: DEFAULT_MODEL, effort: "high", fallback: null });
  assert.equal(modelFor({ feature: "chat", cfgModel: INTERNAL_MODEL }).model, INTERNAL_MODEL);
  assert.equal(modelFor({ feature: "draft", cfgModel: "claude-fable-5-1" }).model, DEFAULT_MODEL);
  assert.equal(modelFor({ feature: "draft", cfgModel: "claude-fable-5-1", own: true }).model, "claude-fable-5-1");
  assert.equal(modelFor({ feature: "draft", cfgModel: "claude-fable-5-1", selfHost: true }).model, "claude-fable-5-1");
  assert.equal(modelFor({ feature: "edit", thinkHarder: true }).model, THINK_MODEL);
  for (const f of ["review", "summary", "check", "play", "vision_check"]) assert.equal(modelFor({ feature: f, cfgModel: DEFAULT_MODEL }).model, INTERNAL_MODEL, f);
  assert.deepEqual([...HOSTED_MODELS], [DEFAULT_MODEL, INTERNAL_MODEL]);
});
test("prices: every model in use is priced; the published numbers cost out right", () => {
  assert.equal(costOf({ model: DEFAULT_MODEL, input: 1_000_000, output: 1_000_000 }).micro, 12_000_000);      // $2 + $10
  assert.equal(costOf({ model: THINK_MODEL, input: 500_000, output: 100_000 }).micro, 4_000_000);               // $2 + $2
  assert.equal(costOf({ model: INTERNAL_MODEL, input: 100_000, output: 10_000 }).micro, 15_000);               // under the tier: $0.01 + $0.005
  assert.equal(costOf({ model: INTERNAL_MODEL, input: 200_000, output: 10_000 }).micro, 125_000);              // over the tier: $0.10 + $0.025
  assert.equal(costOf({ model: DEFAULT_MODEL, input: 0, output: 0, cacheRead: 1_000_000 }).micro, 200_000);
  assert.deepEqual(costOf({ model: "no-such-model", input: 5 }), { micro: 0, known: false });
  for (const m of Object.keys(PRICES)) assert.ok(PRICES[m].in > 0 && PRICES[m].out > 0, m);
});

// ── D-015 regression and the production guard ─────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fakeAllowed, assertAiEnvironment } from "../src/documents/engine/ai/gateway.mjs";
import { callModel } from "../src/documents/engine/ai/providers.mjs";
const walk = (d) => readdirSync(d).flatMap((n) => { const p = `${d}/${n}`; return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : /\.mjs$/.test(n) ? [p] : []; });
test("no model id appears anywhere in src/ except the price table and the model chooser (D-015 can not come back)", () => {
  const offenders = walk(new URL("../src", import.meta.url).pathname).filter((f) => !/engine\/ai\/(prices|modelPolicy)\.mjs$/.test(f)).filter((f) => /claude-(haiku|sonnet|opus|fable)-\d/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
test("every call site asks the chooser: user-facing work follows the setting, internal jobs are Haiku", () => {
  for (const f of ["draft", "edit", "chat", "file_read", "detect"]) {
    assert.equal(modelFor({ feature: f }).model, DEFAULT_MODEL, f);
    assert.equal(modelFor({ feature: f, cfgModel: INTERNAL_MODEL }).model, INTERNAL_MODEL, f);
  }
  for (const f of ["review", "summary", "check", "play", "vision_check"]) assert.equal(modelFor({ feature: f }).model, INTERNAL_MODEL, f);
  const seen = new Set(["draft", "edit", "chat", "file_read", "detect", "review", "summary", "check", "play", "vision_check", "think_harder"].map((f) => modelFor({ feature: f, thinkHarder: f === "think_harder" }).model));
  for (const m of seen) assert.ok(PRICES[m], `${m} is not in the price table`);
});
test("production guard: the test provider can not be enabled in production (startup check, the gateway and the provider all refuse)", async () => {
  assert.equal(fakeAllowed({ KEYSTONE_AI_ALLOW_FAKE: "1", KEYSTONE_ENVIRONMENT: "sandbox" }), true);
  assert.equal(fakeAllowed({ KEYSTONE_AI_ALLOW_FAKE: "1", KEYSTONE_ENVIRONMENT: "production" }), false);
  assert.equal(fakeAllowed({ KEYSTONE_ENVIRONMENT: "sandbox" }), false);
  assert.throws(() => assertAiEnvironment({ KEYSTONE_AI_ALLOW_FAKE: "1", KEYSTONE_ENVIRONMENT: "production" }), /must never be enabled/);
  assert.doesNotThrow(() => assertAiEnvironment({ KEYSTONE_AI_ALLOW_FAKE: "1", KEYSTONE_ENVIRONMENT: "sandbox" }));
  const refused = await callModel({ provider: "fake", system: "s", user: "u", env: { KEYSTONE_AI_ALLOW_FAKE: "1", KEYSTONE_ENVIRONMENT: "production" } });
  assert.equal(refused.ok, false);
  const allowed = await callModel({ provider: "fake", system: "s", user: "u", env: { KEYSTONE_AI_ALLOW_FAKE: "1", KEYSTONE_ENVIRONMENT: "sandbox" } });
  assert.equal(allowed.ok, true);
});
