// The API reference's data, derived from static/api/openapi.json at build time (never written by hand). Server-side only: the page is prerendered.
const deref = (spec, s) => (s?.$ref ? deref(spec, spec.components.schemas[s.$ref.split("/").pop()]) : s);
const typeOf = (spec, s) => { s = deref(spec, s) ?? {}; if (s.enum) return s.enum.join(" | "); if (s.type === "array") return `array of ${typeOf(spec, s.items)}`; return Array.isArray(s.type) ? s.type.join(" or ") : (s.type ?? "object"); };
export const example = (spec, schema, depth = 0) => {
  let s = deref(spec, schema) ?? {};
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.type)) s = { ...s, type: s.type.find((t) => t !== "null") ?? "null" };   // a nullable field shows its real type
  if (depth > 4) return {};
  if (s.type === "array") return [example(spec, s.items, depth + 1)];
  if (s.properties) return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, example(spec, v, depth + 1)]));
  const alt = s.anyOf ?? s.oneOf; if (alt?.length) return example(spec, alt[0], depth + 1);
  if (s.additionalProperties && typeof s.additionalProperties === "object") return { key: example(spec, s.additionalProperties, depth + 1) };   // a map (z.record): R13-D319, it was shown as "string"
  if (s.type === "object") return {};
  if (s.type === "integer" || s.type === "number") return s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 0);
  return s.type === "boolean" ? false : s.enum?.[0] ?? (s.format === "uuid" ? "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e" : "string");
};
const fieldsOf = (spec, schema) => {
  const s = deref(spec, schema); if (!s?.properties) return [];
  const req = new Set(s.required ?? []);
  return Object.entries(s.properties).map(([name, v]) => ({ name, type: typeOf(spec, v), required: req.has(name), description: String(v.description ?? deref(spec, v)?.description ?? "").trim() }));
};
export const slugOf = (method, path) => `${method}-${path}`.toLowerCase().replace(/[{}]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export function operations(spec) {
  const out = [];
  for (const [path, ops] of Object.entries(spec.paths)) for (const [method, op] of Object.entries(ops)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const body = op.requestBody?.content?.["application/json"]?.schema;
    const ok = Object.entries(op.responses ?? {}).find(([c]) => /^2/.test(c));
    const okSchema = ok?.[1]?.content?.["application/json"]?.schema;
    out.push({
      id: slugOf(method, path), tag: (op.tags ?? ["Other"])[0], method: method.toUpperCase(), path, summary: op.summary ?? "", description: String(op.description ?? "").trim(),
      params: (op.parameters ?? []).map((x) => ({ name: x.name, in: x.in, required: Boolean(x.required), type: typeOf(spec, x.schema), description: String(x.description ?? "").trim() })),
      body: body ? fieldsOf(spec, body) : [], bodyExample: body ? example(spec, body) : null,
      responses: Object.entries(op.responses ?? {}).map(([code, r]) => ({ code, description: String(r.description ?? "") })),
      okCode: ok?.[0] ?? "200", okExample: okSchema ? example(spec, okSchema) : null,
    });
  }
  return out;
}
export const tagsOf = (ops) => { const m = new Map(); for (const o of ops) { if (!m.has(o.tag)) m.set(o.tag, []); m.get(o.tag).push(o); } return [...m].map(([tag, items]) => ({ tag, items })); };
