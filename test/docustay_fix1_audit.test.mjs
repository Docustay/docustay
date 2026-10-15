// D-026 / D-092 — audit lines read as sentences: known topics have wording, unknown ones read in plain English with the right article.
import test from "node:test";
import assert from "node:assert/strict";
import { describeTopic, TOPIC_WORDING } from "../src/audit/queries.mjs";

test("every Documents and Developer topic the product emits has its own wording", () => {
  for (const k of ["developer.api_key.created", "developer.api_key.revoked", "developer.webhook_endpoint.created", "documents.ai.job_requested", "documents.approval.requested", "documents.document.archived", "documents.pdf.imported", "documents.template.published"]) assert.ok(TOPIC_WORDING[k], k);
  assert.equal(describeTopic("developer.api_key.created"), "created an API key");
  assert.equal(describeTopic("documents.ai.job_requested"), "asked the AI for a draft");
});
test("an unknown topic still reads as English: the right article, acronyms in capitals, the whole middle as the thing", () => {
  assert.equal(describeTopic("jobs.ai.requested"), "requested an AI");
  assert.equal(describeTopic("x.api_key.frobbed"), "frobbed an API key");
  assert.equal(describeTopic("x.item.deleted"), "deleted an item");
  assert.equal(describeTopic("x.team_role.changed"), "changed a team role");
  assert.doesNotMatch(describeTopic("a.b.c"), /\./);
  assert.equal(describeTopic("zzz"), "did something this log does not have wording for");
});
