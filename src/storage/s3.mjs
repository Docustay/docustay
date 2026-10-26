// P18.3 — ★★★ OBJECT STORAGE. S3 API ONLY, AND THAT RESTRICTION IS THE WHOLE SAFETY ARGUMENT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE §Y8.3 ADOPTION TEST, RE-RUN ON SEAWEEDFS BEFORE BUILDING ON IT — AS P18.3 REQUIRES.
//     [MEASURED 2026-09-13 from the GitHub API, not from memory]
//
//   1 · LICENCE — **PASS.** `spdx_id: "Apache-2.0"`, `archived: false`, `disabled: false`. Permissive,
//       and it has stayed permissive. (MinIO stayed AGPLv3 to the end and archived anyway.)
//   2 · LAST RELEASE — **PASS, emphatically.** `tag_name: "4.46"`, `published_at:
//       "2026-09-08T03:45:26Z"` — five days before this was written. `pushed_at` was the same day.
//       34,619 stars, 760 open issues.
//   3 · ★★★ DOES ONE COMPANY CONTROL THE ROADMAP — **THIS IS THE ONE IT DOES NOT PASS CLEANLY.**
//       Contributor counts: `chrislusf` **10,457**; the next human is `kmlebedev` at **532**; then 104,
//       101, 54. **~94% of human commits are one person**, and there is a commercial SeaweedFS offering.
//       ★★ QUESTION 3 IS EXACTLY THE QUESTION MINIO FAILED. §Y8.3's own warning — *"MinIO would have
//          FAILED this test in 2024 if anyone had run it"* — applies here with the same shape, and
//          recording it as a pass would be the failure the test exists to prevent.
//
// ★★★ SO WHY ADOPT IT ANYWAY, STATED AS A REASON AND NOT A SHRUG:
//     **Because the exit cost is an endpoint change, not a rewrite — PROVIDED we only ever use the S3
//     API.** S3 is a standard with several independent implementations (Garage, RustFS, Ceph RGW, AWS
//     itself), so a SeaweedFS retreat means pointing `KEYSTONE_S3_ENDPOINT` somewhere else.
//   ★★ THAT IS PRECISELY WHAT WAS NOT TRUE OF MINIO. What hurt there was the ADMIN CONSOLE and
//      `mc` — vendor-specific surfaces with no standard behind them. Depending on those is what turned
//      a licence change into a migration.
//   ★★★ HENCE THE HARD RULE IN THIS FILE, AND IT IS CHECKABLE: **NO SEAWEEDFS-SPECIFIC ENDPOINT.**
//        No `/dir/assign`, no filer HTTP API, no `/status`, no volume-server call. If it is not in the
//        S3 API, it does not appear here — and `db/gates/p18_storage.mjs` greps this module for those
//        paths, so the restriction is enforced rather than intended.
//
// ★ AND NO SDK. `@aws-sdk/client-s3` is ~20 transitive packages for four requests, and it would make the
//   injected-fetch pattern (which is how every provider in this project is tested) impossible. The four
//   operations are signed by hand with SigV4 below — the signing is the only fiddly part and it is
//   confined to one function.

import { createHash, createHmac } from "node:crypto";
// ★★★ Task L9.2 (aws4fetch 1.0.20) — SigV4 for the four real operations below is now signed by
//     `AwsClient`, not by hand. `presignPut` (further down) keeps its own hand-rolled query-string
//     signer: aws4fetch's `sign()`/`AwsV4Signer` are Promise-based (they run on WebCrypto's
//     `subtle`, which has no synchronous form), and `presignPut` is called WITHOUT `await` both by
//     `test/s14_presign_put.test.mjs` and by `src/routes/uploads.mjs`'s `createUploadTicket`
//     (outside this task's file list) — making it async would silently hand both of them a Promise
//     instead of `{ url, method, headers, expiresAt }`. Flagged, not guessed around.
import { AwsClient } from "aws4fetch";
import { callOutside } from "../http/outside.mjs";
// ★★★ Task 9.13 — THE KILL SWITCH, read fresh every call, no cache (flags.mjs's own rule).
import { withTenant } from "../db/index.mjs";
import { flagIsOn } from "../platform/flags.mjs";

/** ★ Every S3 path this module is allowed to use. Any other shape is a bug, not a feature. */
export const S3_OPERATIONS = Object.freeze(["put", "get", "head", "delete"]);

export class StorageConfigError extends Error {
  constructor(message) { super(message); this.name = "StorageConfigError"; }
}

/**
 * ★★ THE CONFIGURATION, READ AT CALL TIME AND FAIL-LOUD. Same rule as the Resend key: never
 *    `process.env.X || 'literal'`, because a defaulted endpoint means a deployment writes a client's
 *    document somewhere nobody chose.
 */
export function s3Config(env = process.env) {
  const cfg = {
    endpoint: env.KEYSTONE_S3_ENDPOINT,
    bucket: env.KEYSTONE_S3_BUCKET,
    accessKeyId: env.KEYSTONE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.KEYSTONE_S3_SECRET_ACCESS_KEY,
    region: env.KEYSTONE_S3_REGION ?? "us-east-1",
  };
  const missing = Object.entries(cfg)
    .filter(([k, v]) => k !== "region" && (typeof v !== "string" || v.trim() === ""))
    .map(([k]) => `KEYSTONE_S3_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
  if (missing.length) {
    throw new StorageConfigError(
      `object storage is not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
      `not set. ★ There is deliberately NO default endpoint: a defaulted one means a client's document ` +
      `is written somewhere nobody chose, and the failure would only surface when somebody went looking ` +
      `for the file.`);
  }
  if (!/^https?:\/\//.test(cfg.endpoint)) {
    throw new StorageConfigError(`KEYSTONE_S3_ENDPOINT must be an http(s) URL — got ${cfg.endpoint}`);
  }
  return cfg;
}

export function storageIsConfigured(env = process.env) {
  try { s3Config(env); return true; } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ★★ SIGV4. Confined to this one function so the four operations below are plain.
// ─────────────────────────────────────────────────────────────────────────────
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const hmac = (key, s) => createHmac("sha256", key).update(s).digest();

/**
 * ★ Sign one request. `PATH-STYLE ADDRESSING` (`/bucket/key`), not virtual-host style, because a
 *   self-hosted endpoint has no per-bucket DNS — and getting this wrong produces a 403 that reads as
 *   a credential problem rather than an addressing one.
 * ★★★ Task L9.2 — signed by `aws4fetch`'s `AwsClient`, not by hand. `client.sign(...)`, never
 *     `client.fetch(...)`: `.fetch()` calls the GLOBAL `fetch` directly with no way to hand it this
 *     module's injected `fetchImpl`, which would bypass every test's transport double (in
 *     particular `test/kill_switches.test.mjs` items 6 and 9, which assert the real transport was
 *     never reached while `s3_enabled` is off) and the timeout/kill-switch wrapper `callOutside`
 *     below. `.sign()` returns the signed request untouched so `callOutside` still owns the send.
 */
async function signRequest({ method, bucket, key, body, cfg, now, query = null }) {
  const url = new URL(`${cfg.endpoint.replace(/\/+$/, "")}/${bucket}/${key.replace(/^\/+/, "")}`);
  if (query) url.search = query;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20260913T221500Z
  const payloadHash = sha256hex(body ?? "");

  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    region: cfg.region, service: "s3",
  });
  // ★ The real payload hash is handed in as a header BEFORE signing (never left for AwsClient to
  //   default to `UNSIGNED-PAYLOAD`, which it otherwise would for an s3-service header-signed
  //   request) — so what gets signed is the digest of the bytes actually sent, same as before.
  const signed = await client.sign(url.toString(), {
    method,
    headers: { "x-amz-content-sha256": payloadHash },
    aws: { datetime: amzDate },
  });

  return {
    url: signed.url,
    // ★ The credential is in a HEADER (`authorization`, set by aws4fetch) and is never logged,
    //   echoed, or put in a body.
    headers: Object.fromEntries(signed.headers.entries()),
  };
}

// ★ AWS's own uri-encode, used ONLY for the query-string components below: `encodeURIComponent`
//   leaves `! ' ( ) *` unescaped, and SigV4's canonical query string requires every one of them
//   percent-encoded (uppercase hex) or the signature will not match what the store recomputes.
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * ★★★ TASK 14.77 / R-14.12 — THE QUERY-STRING SIGV4 VARIANT, FOR A BROWSER THAT CANNOT SEND
 *     `signRequest`'s `authorization` HEADER. Same config, same HMAC chain, same PATH-STYLE
 *     addressing as `signRequest` above — the signature rides the QUERY STRING instead, and the
 *     payload hash is the literal `UNSIGNED-PAYLOAD` (the caller's bytes never reach this function,
 *     so there is nothing to hash).
 * ★★ `expiresSeconds` IS CLAMPED TO 60–900: a long-lived presigned URL is a credential handed to
 *     whoever holds it, for as long as it lives, with no further check by this application — 15
 *     minutes (900s) is the ceiling, and 60s is a floor against a value so small the request could
 *     not physically complete before the store refuses it as a clock-skew artefact.
 * @returns { url, method: "PUT", headers: { "content-type": contentType }, expiresAt }
 */
export function presignPut({ key, contentType, expiresSeconds = 900 }, { env = process.env, now = () => new Date() } = {}) {
  const cfg = s3Config(env);
  const expires = Math.min(900, Math.max(60, Math.round(Number(expiresSeconds) || 900)));
  const url = new URL(`${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}/${key.replace(/^\/+/, "")}`);
  const nowDate = now();
  const amzDate = nowDate.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20260913T221500Z
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const signedHeaders = "content-type;host";

  // ★ Sorted by ENCODED name — the canonical-query-string rule SigV4 requires.
  const queryParams = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQueryString = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalHeaders = `content-type:${contentType}\nhost:${url.host}\n`;
  const canonicalRequest = [
    "PUT", url.pathname, canonicalQueryString, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  let k = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  for (const part of [cfg.region, "s3", "aws4_request"]) k = hmac(k, part);
  const signature = createHmac("sha256", k).update(stringToSign).digest("hex");

  // ★ Built as a STRING, never via `url.search = …` — the WHATWG `URL` setter re-parses and
  //   re-serialises whatever it is given, which is exactly the kind of second encoding pass that
  //   makes a computed signature stop matching the bytes actually sent. `canonicalQueryString` is
  //   already the exact, final, percent-encoded text that was signed; appending the signature (hex
  //   digits only — nothing to encode) is the only thing done to it after that.
  const finalUrl = `${url.origin}${url.pathname}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return {
    url: finalUrl,
    method: "PUT",
    headers: { "content-type": contentType },
    expiresAt: new Date(nowDate.getTime() + expires * 1000).toISOString(),
  };
}

/**
 * ★★★ THE FOUR OPERATIONS. Each returns a DESCRIBED OUTCOME and never throws for a storage failure —
 *     the same rule as `sendViaResend`, and for the same reason: a thrown error invites `catch {}`,
 *     which is how a failure gets inferred from silence.
 */
// ★ 9.6 Part 2 / F619: routed through `callOutside(..., {raw: true})` instead of calling the global
//   fetch directly — the wrapper's default (text-decoding, no-headers) mode cannot carry raw bytes or
//   `etag`/`content-length`, which `putObject`/`getObject`/`headObject` need. `callOutside` now owns
//   the timer; the manual `AbortController`/`setTimeout`/`clearTimeout` this function used to run
//   itself are gone. Same 20 000 ms default as before this change.
// ★★★ Task 9.13 — THE TENANT COMES OUT OF THE KEY, NOT A NEW PARAMETER. `objectKey()` (below) is
//     "the only way to make one" and every key it produces starts `t/{tenantId}/…` — so the guard
//     reads the same tenant boundary the key already encodes rather than asking every one of the
//     four public ops to carry a second, redundant tenantId argument.
const LEDGER_PREFIX = "_platform_ledger/deletion/";
const LEDGER_KEY_RE = /^_platform_ledger\/deletion\/[A-Za-z0-9._-]{1,160}\.json$/;
const LEDGER_LIST_QUERY_PREFIX = "list-type=2&prefix=_platform_ledger%2Fdeletion%2F";
// Operation Live B2 — a FOURTH narrow carve-out: the closed Pro add-on bundle (src/product/docustayAddonDelivery.mjs). It is the platform's own file, not any practice's, so it cannot sit under t/{tenantId}/ and has no kill-switch flag to read. Pinned to ONE fixed prefix and the exact bundle names, GET and PUT only.
const ADDON_KEY_RE = /^_platform_addon\/docustay-pro-(?:latest|[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\.tgz$/;
const KEY_TENANT_RE = /^t\/([0-9a-f-]{36})\//i;
const TENANT_LIST_RE = /^list-type=2&prefix=t%2F([0-9a-f-]{36})%2F(?:document_file|executed_document)%2F(?:&continuation-token=[A-Za-z0-9%._~-]+)?$/i;

function tenantIdFromKey(key) {
  const m = typeof key === "string" ? KEY_TENANT_RE.exec(key) : null;
  if (!m) {
    throw new StorageConfigError(
      `s3: key ${JSON.stringify(key)} is not in the t/{tenantId}/{kind}/{id} shape objectKey() ` +
      `produces, so the kill switch cannot tell which practice's flag to read. Build every key ` +
      `through objectKey() — never a hand-built path.`);
  }
  return m[1];
}

async function s3Request(method, key, body, { fetchImpl = globalThis.fetch, env = process.env,
                                             now = () => new Date(), timeoutMs = 20_000, query = null } = {}) {
  // ★★★ Task 9.13 — THE GUARD, AT THE TOP, BEFORE SIGNING AND BEFORE THE TRANSPORT.
  //
  // ★★★ FIX [MEASURED 23 Sep 2026, Group A deploy] — EXACTLY ONE CARVE-OUT: THE BUCKET-LEVEL HEAD.
  //   THE DEFECT THIS CLOSES: `probeStorage` (src/health/probes.mjs:261) deliberately calls
  //   `headObject({ key: "" })` — S3 **HeadBucket**, path-style `/<bucket>/`, NOT a key. Its own
  //   comment (probes.mjs:255-260) records why that is the only correct shape: S3 answers 404
  //   whether the KEY is missing or the WHOLE BUCKET is, so a probe that HEADed a key read a
  //   DELETED BUCKET as healthy (Stage 2 final review M1). A bucket-level HEAD therefore has no
  //   key, and so has no tenant. `tenantIdFromKey("")` throws StorageConfigError, that throw
  //   reached `/readyz`'s storage check, `/readyz` answered 503, and Railway's deploy healthcheck
  //   refused EVERY keystone-app deployment. [EXECUTED 23 Sep 2026: deployment
  //   185577b7-7e37-4900-872c-5c1c117dc1ec FAILED with the app itself logging "startup invariants
  //   ok" and "listening on :8080"; the app's own readyz, run against the production service
  //   environment, returned storage ok:false — 's3: key "" is not in the t/{tenantId}/{kind}/{id}
  //   shape'.] This is the same class as F487: the store was fine and the CHECK was what refused.
  //
  // ★★ WHY THIS DOES NOT WEAKEN THE KILL SWITCH. The switch is PER PRACTICE and is read out of the
  //    key's own `t/{tenantId}/` prefix. A bucket-level HEAD names no practice, reads no object and
  //    returns no object bytes — there is no practice whose flag could apply to it and nothing
  //    tenant-scoped for it to expose. The carve-out is pinned to BOTH facts at once (method is
  //    HEAD **and** the key is exactly empty), so every real object operation — every GET, PUT,
  //    DELETE, and every HEAD of an actual key — still goes through `tenantIdFromKey` and still
  //    obeys `s3_enabled`, unchanged. A hand-built path is still refused: "" is not a path.
  // ★★★ FIX, 30 Sep 2026 (worker-failures brief) — A SECOND, EQUALLY NARROW CARVE-OUT: THE PLATFORM
  //   HEALTH PROBE. MEASURED live: `watch_system` reported "File storage: could not run: s3: key
  //   \"_platform_health/probe\" is not in the t/{tenantId}/{kind}/{id} shape" on every run —
  //   `probeStorageReadWrite` (`src/health/probes.mjs`) deliberately uses one FIXED, hand-built key
  //   (its own comment: "net storage effect ~zero... one FIXED key, overwritten every run"), because
  //   it asks whether the STORE ITSELF is healthy — a platform question, like the bucket-level HEAD
  //   above, not "is practice X's storage working". Pinning it to any one real tenant's id would
  //   make platform health depend on that ONE practice's own kill switch, which is the wrong
  //   question for the same reason the bucket HEAD carve-out gives for reading no tenant. Pinned to
  //   the EXACT fixed key `probeStorageReadWrite` uses (never a prefix, never a pattern) so no real
  //   object path can ever match it by accident — a hand-built path is still refused everywhere else.
  const isBucketHead = method === "HEAD" && key === "";
  const isPlatformHealthProbe = key === "_platform_health/probe";
  // ★ Round 3 — a THIRD, equally narrow carve-out: the platform's deletion ledger (src/product/deletion.mjs). It records that a person or a workspace was deleted (a hash and an id, never a name) and must outlive the workspace it is about, so
  //   it cannot sit under that workspace's `t/{tenantId}/` prefix, and a deleted workspace has no kill-switch flag left to read. Pinned to ONE fixed prefix and a safe file name, and to read/write/list methods only (never DELETE).
  const isPlatformLedger = (method === "PUT" || method === "GET") && LEDGER_KEY_RE.test(key);
  const isPlatformAddon = (method === "PUT" || method === "GET") && ADDON_KEY_RE.test(key);
  const isLedgerList = method === "GET" && key === "" && typeof query === "string" && query.startsWith(LEDGER_LIST_QUERY_PREFIX);
  // Run 9 Part 4.4 — the re-encrypt job lists ONE workspace's stored files by prefix. The tenant is read out of the prefix and the kill switch applies exactly as for any object call.
  const tenantList = method === "GET" && key === "" && typeof query === "string" ? TENANT_LIST_RE.exec(query) : null;
  if (!isBucketHead && !isPlatformHealthProbe && !isPlatformLedger && !isPlatformAddon && !isLedgerList) {
    const tenantId = tenantList ? tenantList[1] : tenantIdFromKey(key);
    const s3Enabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "s3_enabled", tenantId));
    if (!s3Enabled) {
      // ★ Same "described outcome, never throws for a storage failure" shape as every other result
      //   this function returns — a kill switch being off is reported the same honest way a real
      //   storage failure is, never a silent success and never a 500.
      return { ok: false, status: null, headers: null, body: null,
        error: `s3_enabled is off for this practice — a platform operator turned it off. No ${method} ` +
          `can run until it is switched back on.` };
    }
  }
  const cfg = s3Config(env);
  const { url, headers: signedHeaders } = await signRequest({
    method, bucket: cfg.bucket, key, body, cfg, now: now(), query,
  });
  const result = await callOutside("s3", url, { method, headers: signedHeaders, body }, {
    fetchImpl, timeoutMs, raw: true,
  });
  if (result.status === null) {
    // network error or timeout — callOutside's catch branch; no HTTP response was ever read.
    return { ok: false, status: null, headers: null, body: null,
      error: result.timedOut ? `s3 ${method} did not respond within ${timeoutMs}ms`
                              : `s3 ${method} request failed` };
  }
  return { ok: result.ok, status: result.status, headers: result.headers, body: result.body,
    // ★ The provider's own words on failure — never a re-description (errors.mjs's rule).
    error: result.ok ? null
      : `s3 ${method} responded ${result.status}: ${(result.body?.toString("utf8") ?? "").slice(0, 300)}` };
}

/**
 * ★★★ THE KEY LAYOUT, AND IT IS TENANT-FIRST FOR A REASON.
 *     `t/{tenantId}/{kind}/{id}` — the tenant is the FIRST path segment, so
 *       · a bucket policy or an IAM prefix rule can scope by tenant if that is ever wanted;
 *       · a listing is per tenant by construction;
 *       · and an operator looking at the bucket can tell whose file it is without a lookup.
 *   ★★ THE OBJECT STORE HAS NO RLS. It cannot: it is not Postgres. So the tenant boundary here is the
 *      KEY, and the rule that makes it hold is that a key is COMPUTED from a verified tenant id, never
 *      accepted from a caller. `objectKey` is the only way to make one, and it refuses a bad id.
 */
export function objectKey({ tenantId, kind, id }) {
  if (typeof tenantId !== "string" || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new StorageConfigError(
      `objectKey: tenantId must be a uuid — got ${JSON.stringify(tenantId)}. ★ The object store has no ` +
      `row-level security, so the tenant boundary IS this path segment. A key built from an unverified ` +
      `id is a key that can point at another tenant's prefix.`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(kind ?? "")) {
    throw new StorageConfigError(`objectKey: kind must be a lowercase identifier — got ${JSON.stringify(kind)}`);
  }
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
    // ★★ NO SLASHES, NO DOTS-DOTS. A caller-supplied id containing `../` is path traversal inside the
    //    bucket — it would let one tenant's write land in another tenant's prefix.
    throw new StorageConfigError(
      `objectKey: id must be 1-128 chars of [A-Za-z0-9._-] — got ${JSON.stringify(id)}. ★ Slashes and ` +
      `traversal sequences are refused: they would let a write escape this tenant's prefix.`);
  }
  return `t/${tenantId}/${kind}/${id}`;
}

/** The platform deletion ledger (Round 3): write one entry, list every entry, read one. Fixed prefix, no deletes; see the carve-out in s3Request. */
const ledgerKey = (name) => `${LEDGER_PREFIX}${name}.json`;
export async function putLedgerEntry({ name, body }, opts = {}) {
  const key = ledgerKey(name);
  if (!LEDGER_KEY_RE.test(key)) throw new StorageConfigError(`ledger entry name ${JSON.stringify(name)} is not a safe file name`);
  const r = await s3Request("PUT", key, body, opts);
  return { ok: r.ok, status: r.status, error: r.error, key };
}
export async function getLedgerEntry({ key }, opts = {}) {
  const r = await s3Request("GET", key, undefined, opts);
  return r.ok ? { ok: true, body: r.body, error: null } : { ok: false, body: null, error: r.error };
}
/** Every ledger key, oldest name first. Follows S3 continuation tokens. */
export async function listLedgerEntries(opts = {}) {
  const keys = []; let token = null;
  for (let page = 0; page < 1000; page += 1) {
    const q = LEDGER_LIST_QUERY_PREFIX + (token ? `&continuation-token=${rfc3986(token)}` : "");
    const r = await s3Request("GET", "", undefined, { ...opts, query: q });
    if (!r.ok) return { ok: false, keys, error: r.error };
    const xml = r.body?.toString("utf8") ?? "";
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, "&"));
    const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    if (!next) break;
    token = next[1].replace(/&amp;/g, "&");
  }
  return { ok: true, keys: keys.sort(), error: null };
}

/** Every stored file key of one kind under one workspace's prefix (`t/{tenantId}/{kind}/`), oldest name first. Follows S3 continuation tokens. Only the document kinds can be listed; the kill switch applies. */
export async function listTenantObjects({ tenantId, kind = "document_file" }, opts = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(tenantId))) throw new StorageConfigError("listTenantObjects: tenantId must be a uuid");
  if (kind !== "document_file" && kind !== "executed_document") throw new StorageConfigError("listTenantObjects: only the document kinds can be listed");
  const keys = []; let token = null;
  for (let page = 0; page < 100000; page += 1) {
    const q = `list-type=2&prefix=${rfc3986(`t/${tenantId}/${kind}/`)}` + (token ? `&continuation-token=${rfc3986(token)}` : "");
    const r = await s3Request("GET", "", undefined, { ...opts, query: q });
    if (!r.ok) return { ok: false, keys, error: r.error };
    const xml = r.body?.toString("utf8") ?? "";
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, "&"));
    const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    if (!next) break;
    token = next[1].replace(/&amp;/g, "&");
  }
  return { ok: true, keys: keys.sort(), error: null };
}

export async function putObject({ key, body, contentType = "application/octet-stream" }, opts = {}) {
  const r = await s3Request("PUT", key, body, opts);
  return { ok: r.ok, status: r.status, error: r.error, key,
           etag: r.headers?.etag ?? null,
           // ★ The digest we computed, so a later read can be verified against what we sent rather than
           //   against whatever the store now holds.
           sha256: body === undefined || body === null ? null : sha256hex(body) };
}

export async function getObject({ key }, opts = {}) {
  const r = await s3Request("GET", key, undefined, opts);
  if (!r.ok) return { ok: false, status: r.status, error: r.error, body: null, sha256: null };
  return { ok: true, status: r.status, error: null, body: r.body, sha256: sha256hex(r.body) };
}

export async function headObject({ key }, opts = {}) {
  const r = await s3Request("HEAD", key, undefined, opts);
  return { ok: r.ok, status: r.status, error: r.error,
           size: Number(r.headers?.["content-length"] ?? 0) || null };
}

export async function deleteObject({ key }, opts = {}) {
  const r = await s3Request("DELETE", key, undefined, opts);
  // ★ S3 returns 204 for a delete, and 204 for deleting something that was never there. Both are "it
  //   is not there now", which is what the caller asked for — so neither is an error.
  return { ok: r.ok, status: r.status, error: r.error };
}
