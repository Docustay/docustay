// REMEMBER THIS FORM (PDF-FIELD-DETECTION-SPEC §5): the layout of a sent document is kept, and the same printed form comes back with its boxes. The picture-hash rules are pure; the table is exercised on a real database when one is given
// (KEYSTONE_TEST_PG_URL = a scratch database with migrations applied; the test refuses to run against anything that is not local).
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { distance, sameLayout, findLayout, rememberLayout, suggestionsFromLayout } from "../src/documents/detect/remember.mjs";

const flip = (hex, n) => { let v = BigInt(`0x${hex}`); for (let i = 0; i < n; i += 1) v ^= 1n << BigInt(i * 3); return v.toString(16).padStart(16, "0"); };
const H = "a5a5a5a55a5a5a5a";

test("picture hashes: the same page, a few marks of ink and a different page", () => {
  assert.equal(distance(H, H), 0); assert.equal(distance(H, flip(H, 4)), 4);
  assert.ok(sameLayout([{ hash: H }], [{ hash: flip(H, 5) }]), "a form with something written on it is still that form");
  assert.ok(!sameLayout([{ hash: H }], [{ hash: flip(H, 20) }]), "control: a different page is not");
  assert.ok(!sameLayout([{ hash: H }], [{ hash: H }, { hash: H }]), "control: a different page count is not");
});

const URL_ = process.env.KEYSTONE_TEST_PG_URL;
test("the layout table: remember, find, refresh, and never find it for other pages", { skip: URL_ ? false : "set KEYSTONE_TEST_PG_URL to a local scratch database to run this" }, async () => {
  assert.match(URL_, /@(localhost|127\.0\.0\.1)[:/]/, "only a local database");
  const c = new pg.Client({ connectionString: URL_ }); await c.connect();
  try {
    await c.query("BEGIN");
    const { rows: [t] } = await c.query(`SELECT id FROM keystone.tenant LIMIT 1`); assert.ok(t, "a tenant exists in the scratch database");
    const pages = [{ hash: H }, { hash: flip(H, 2) }], fields = [{ id: "a", type: "signature", role: "signer_1", page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.04, label: "Client signature", autofill: undefined }];
    assert.equal(await findLayout(c, { pages }), null, "nothing remembered yet");
    const id = await rememberLayout(c, { tenantId: t.id, pages, name: "Intake", fields, roles: [{ key: "signer_1", label: "Client" }] }); assert.ok(id);
    const hit = await findLayout(c, { pages: [{ hash: flip(H, 1) }, { hash: flip(H, 2) }] }); assert.equal(hit.id, id);
    assert.equal(suggestionsFromLayout(hit).suggestions[0].source, "remembered"); assert.equal(suggestionsFromLayout(hit).suggestions[0].confidence, 1);
    assert.equal(await findLayout(c, { pages: [{ hash: flip(H, 30) }, { hash: flip(H, 2) }] }), null, "control: a different first page");
    const again = await rememberLayout(c, { tenantId: t.id, pages, name: "Intake", fields: [...fields, { ...fields[0], id: "b", page: 2 }], roles: [] }); assert.equal(again, id, "the same form refreshes the same row");
    const { rows: [r] } = await c.query(`SELECT jsonb_array_length(fields) AS n, uses FROM keystone.document_form_layout WHERE id = $1`, [id]); assert.equal(r.n, 2); assert.equal(r.uses, 1);
    assert.equal(await rememberLayout(c, { tenantId: t.id, pages, name: "x", fields: [], roles: [] }), null, "a form with no fields is not worth remembering");
  } finally { await c.query("ROLLBACK"); await c.end(); }
});

test("Pass 3: a near-blank page (hash with hardly any dark blocks) is never 'the same form' as another near-blank page", () => {
  const blank = "0000000000000000", sparse = "0000000000000101";
  assert.ok(!sameLayout([{ hash: blank }], [{ hash: blank }]), "two plain pages are not recognised as one form");
  assert.ok(!sameLayout([{ hash: blank }], [{ hash: sparse }]));
  assert.ok(sameLayout([{ hash: "ffff0000ffff0000" }], [{ hash: "ffff0000ffff0001" }]), "positive control: a structured page is still recognised");
});
