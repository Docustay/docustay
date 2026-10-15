// The daily Docustay plan reconcile walks EVERY paid workspace, not just the first 200 by tenant id (migration 0747). Page size 1 over the real database proves the keyset walk
// returns exactly what a direct count says, in order, with no repeats.
import { test } from "node:test"; import assert from "node:assert/strict"; import pg from "pg";
const WORKER = process.env.KEYSTONE_DATABASE_URL;   // the application pool role (app_rw): the role the worker TASK code reads this list through (the 15 Oct 2026 finding: it was granted to another role only)
const ADMIN = process.env.KEYSTONE_ADMIN_URL;
test("the reconcile list pages through every paid Docustay subscription", { skip: !ADMIN || !WORKER }, async () => {
  const a = new pg.Client({ connectionString: ADMIN }), w = new pg.Client({ connectionString: WORKER }); await a.connect(); await w.connect();
  try {
    const { rows: want } = await a.query(`SELECT tenant_id::text FROM keystone.workbench_subscription WHERE plan_key LIKE 'docustay\\_%' AND stripe_subscription_id IS NOT NULL AND status <> 'canceled' ORDER BY tenant_id`);
    assert.ok(want.length >= 2, "positive control: there are at least two subscriptions to page through");
    const got = []; let after = null;
    for (let i = 0; i < 500; i++) { const page = (await w.query(`SELECT tenant_id::text, stripe_subscription_id FROM keystone_auth.list_docustay_subscriptions_after($1, 1)`, [after])).rows; if (!page.length) break; got.push(page[0].tenant_id); after = page[0].tenant_id; }
    assert.deepEqual(got, want.map((r) => r.tenant_id), "a page size of one still returns every subscription, in order, once");
    assert.equal(new Set(got).size, got.length, "no repeats");
  } finally { await a.end(); await w.end(); }
});
