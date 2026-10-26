// The published OpenAPI file is complete: every webhook event is described, every body has an example, the error kinds match the code, the licence is the facts file's.
import assert from "node:assert/strict";
import { buildOpenApi } from "../scripts/build-api-files.mjs";
import { DOCUSTAY_WEBHOOK_TOPICS } from "../src/developer/webhookTopics.mjs";
import { ErrorKind } from "../src/http/errors.mjs";
import { FACTS } from "../src/product/docustayPrices.mjs";

const doc = await buildOpenApi();
assert.deepEqual(Object.keys(doc.webhooks).sort(), [...DOCUSTAY_WEBHOOK_TOPICS].sort(), "every webhook event is in the OpenAPI file, and only those");
assert.deepEqual(doc.components.schemas.Error.properties.error.properties.kind.enum, Object.values(ErrorKind), "the error kinds are the code's");
assert.equal(doc.info.license.name, FACTS.licences.server);
const bare = [];
for (const [p, item] of Object.entries(doc.paths)) for (const [m, op] of Object.entries(item)) {
  if (!["get", "post", "put", "patch", "delete"].includes(m)) continue;
  for (const mt of [...Object.values(op.requestBody?.content ?? {}), ...Object.values(op.responses ?? {}).flatMap((r) => Object.values(r.content ?? {}))]) if (mt.example === undefined && !mt.examples && mt.schema?.example === undefined) bare.push(`${m} ${p}`);
  assert.ok(op.description, `${m} ${p} has a description`);
}
assert.deepEqual(bare, [], "every request and response body has an example");
assert.match(doc.info.description, new RegExp(Object.values(ErrorKind).join("`, `")), "the description lists the code's error kinds");
console.log("openapi complete: ok");
