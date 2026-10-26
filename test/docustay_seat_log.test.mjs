// The daily seat count: only a Docustay workspace is counted; count and date only; the same day twice updates, never duplicates; the date is the Pacific date.
import assert from "node:assert/strict";
import { teamSeatUsage } from "../src/people/seats.mjs";
import { logSeatsToday } from "../src/product/docustaySeats.mjs";
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("  ok", name); };
const fakeTx = ({ product = "docustay", staff = 3, plan = "docustay_pro" } = {}) => { const calls = []; return { calls, query: async (sql, args) => { calls.push({ sql, args });
  if (/FROM keystone\.tenant/.test(sql)) return { rows: [{ product }] };
  if (/FROM keystone\.app_user/.test(sql)) return { rows: [{ n: staff }] };
  if (/FROM keystone\.invite/.test(sql)) return { rows: [{ n: 0 }] };
  if (/FROM keystone\.mainstay_subscription/.test(sql)) return { rows: [{ plan_key: plan, seat_limit: null }] };
  return { rows: [] }; } }; };
await t("a Docustay workspace is counted: the number of people who sign in, with the Pacific date", async () => { const tx = fakeTx({ staff: 3 }); const r = await logSeatsToday(tx, { tenantId: "t1", now: new Date("2026-10-06T06:30:00Z") }); assert.deepEqual(r, { tenantId: "t1", day: "2026-10-05", seatCount: 3 }); const ins = tx.calls.find((c) => /INSERT INTO keystone\.docustay_seat_day/.test(c.sql)); assert.deepEqual(ins.args, ["t1", "2026-10-05", 3]); assert.match(ins.sql, /ON CONFLICT \(tenant_id, day\) DO UPDATE/); });
await t("an organisation that is not a Docustay workspace is not counted and nothing is written (positive control above)", async () => { const tx = fakeTx({ product: "mainstay" }); assert.equal(await logSeatsToday(tx, { tenantId: "t2" }), null); assert.equal(tx.calls.some((c) => /INSERT/.test(c.sql)), false); });
await t("only count and date are stored: the insert names no person column", async () => { const tx = fakeTx(); await logSeatsToday(tx, { tenantId: "t3" }); const ins = tx.calls.find((c) => /INSERT/.test(c.sql)).sql; assert.doesNotMatch(ins, /email|name|user_id/i); });
await t("seat settings OFF: a Docustay workspace has no limit; ON: the included count is the limit and the extra-seat price is reported; a Workbench practice is never touched", async () => {
  const use = (plan, seatLimit = null) => teamSeatUsage({ query: async (sql) => /FROM keystone\.app_user/.test(sql) ? { rows: [{ n: 4 }] } : /FROM keystone\.invite/.test(sql) ? { rows: [{ n: 1 }] } : { rows: [{ plan_key: plan, seat_limit: seatLimit }] } });
  delete process.env.KEYSTONE_DOCUSTAY_INCLUDED_SEATS; delete process.env.KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR;
  let u = await use("docustay_pro"); assert.equal(u.limit, null); assert.equal(u.docustay, true); assert.equal(u.extraSeatPriceMinor, null); assert.equal(u.staff, 4);
  process.env.KEYSTONE_DOCUSTAY_INCLUDED_SEATS = "3"; process.env.KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR = "800";
  u = await use("docustay_pro"); assert.equal(u.limit, 3); assert.equal(u.extraSeatPriceMinor, 800);
  u = await use("practice", 10); assert.equal(u.limit, 10); assert.equal(u.docustay, false); assert.equal(u.extraSeatPriceMinor, null);   // positive control: the the platform limit is its own column, not the Docustay setting
  delete process.env.KEYSTONE_DOCUSTAY_INCLUDED_SEATS; delete process.env.KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR;
});
console.log(`ok — ${n} groups`);
