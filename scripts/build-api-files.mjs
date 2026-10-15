#!/usr/bin/env node
// Part 30 item 2 — writes the published API description (OpenAPI 3.1) and the Postman collection from the SAME registry the live server serves, so neither can drift from the code.
// Our own generator (no third-party converter): Postman collection format v2.1.0. Output: docustay/web/static/api/{openapi.json,docustay.postman_collection.json}.
import fs from "node:fs";
import { Hono } from "hono";
import { registerDocumentsV1 } from "../src/routes/developerDocuments.mjs";

export async function buildOpenApi() {
  const app = new Hono(); registerDocumentsV1(app, { tokenRoute: async () => ({}) });
  return (await app.request("/api/v1/openapi.json")).json();
}

import { sample } from "../src/developer/openapiPolish.mjs";

export function buildPostman(doc) {
  const folders = new Map();
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = op.tags?.[0] ?? "Other";
      const segs = path.replace(/^\//, "").split("/").map((p) => p.replace(/^\{(\w+)\}$/, ":$1"));
      const query = (op.parameters ?? []).filter((p) => p.in === "query").map((p) => ({ key: p.name, value: p.example ?? "", disabled: true, description: p.description ?? "" }));
      const pathVars = (op.parameters ?? []).filter((p) => p.in === "path").map((p) => ({ key: p.name, value: p.example ?? sample(doc, p.schema) ?? "", description: p.description ?? "" }));
      const reqBody = op.requestBody?.content?.["application/json"]?.schema;
      const header = [{ key: "Accept", value: "application/json" }];
      if (reqBody) header.push({ key: "Content-Type", value: "application/json" });
      if (/Idempotency-Key/i.test(op.description ?? "") || (op.parameters ?? []).some((p) => p.in === "header" && /^idempotency-key$/i.test(p.name))) header.push({ key: "Idempotency-Key", value: "{{$guid}}", description: "8–200 characters; a retry with the same key and body does not repeat the action." });
      const item = {
        name: op.summary ?? `${method.toUpperCase()} ${path}`,
        request: { method: method.toUpperCase(), header, description: op.description ?? "", url: { raw: `{{baseUrl}}/${segs.join("/")}`, host: ["{{baseUrl}}"], path: segs, query, variable: pathVars },
          ...(reqBody ? { body: { mode: "raw", raw: JSON.stringify(sample(doc, reqBody), null, 2), options: { raw: { language: "json" } } } } : {}) },
      };
      if (!folders.has(tag)) folders.set(tag, []);
      folders.get(tag).push(item);
    }
  }
  return {
    info: { name: "Docustay API", description: doc.info?.description ?? "", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }] },
    variable: [{ key: "baseUrl", value: "https://app.docustay.app" }, { key: "apiKey", value: "dsk_test_replace_me" }],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = await buildOpenApi();
  fs.mkdirSync("docustay/web/static/api", { recursive: true });
  fs.writeFileSync("docustay/web/static/api/openapi.json", `${JSON.stringify(doc, null, 2)}\n`);
  fs.writeFileSync("docustay/web/static/api/docustay.postman_collection.json", `${JSON.stringify(buildPostman(doc), null, 2)}\n`);
  console.log(`wrote ${Object.keys(doc.paths).length} paths`);
}
