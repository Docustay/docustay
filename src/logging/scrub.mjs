// Task 9.5 — ★★★ ONE SCRUBBER, THREE CALLERS (CT-095, 06 §2, §12).
//
// ★★ There was no general scrubber before this file (CT-075). `plainText` (src/queue/jobPolicy.mjs)
//    only redacted email addresses and URLs; `safeErrorText` (src/events/outbox.mjs) did the same;
//    neither touched a credential. This is the one implementation both, and the process logger in
//    src/http/app.mjs, now call.
//
// ★★★ THE ONE DELIBERATE EXCEPTION LIVES ELSEWHERE, NOT HERE. `keystone.google_identity.grant_error`
//     (src/run/grants.mjs:249-260) STORES a Google `error_description` whole and unscrubbed, because
//     that text is how a broken grant is diagnosed (CT-075: "A stage planner who 'fixes' that has
//     broken it."). This module has no opinion about that column — it is never called on that store
//     path. The *log* line for the same failure (`src/run/grants.mjs:255`) is a different statement
//     and DOES go through this scrubber.
//
// Patterns matched (06 §2):
//   · key-prefixed credentials: sk_, rk_, re_, whsec_, gl_live_, gl_test_, ks_ followed by
//     credential-shaped characters
//   · PEM private-key blocks — the WHOLE block, header and body, not just the header
//   · the value of an Authorization: or Cookie: header (the header name survives, so the line reads)
//   · OAuth token fields (access_token, refresh_token, id_token, client_secret) in JSON or form
//     encoding
//
// scrubSecrets is idempotent — scrubbing an already-scrubbed string changes nothing — because every
// replacement is the literal "[redacted]", which none of these patterns can match back into. It never
// throws: a non-string input returns "".

const REDACTED = "[redacted]";

// ★ Longest/most specific alternatives first within each prefix family so the match consumes the
//   whole credential-shaped run, not just a short prefix of it.
const KEY_PREFIX = /\b(?:gl_live_|gl_test_|dsk_live_|dsk_test_|whsec_|sk_|rk_|re_|ks_)[A-Za-z0-9_-]{4,}\b/g;

// ★ Matches "-----BEGIN <TYPE> PRIVATE KEY-----" through "-----END <TYPE> PRIVATE KEY-----"
//   (TYPE is "", "RSA ", "EC ", etc.) and replaces the ENTIRE block, not just the header line.
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

// ★ The header NAME is kept so the log line still reads ("Authorization: [redacted]"); only the
//   value is replaced.
const HEADER_VALUE = /\b(Authorization|Cookie)(\s*:\s*)([^\r\n]+)/gi;

// ★ JSON-encoded OAuth token fields: "access_token": "…" (with or without spaces around the colon).
const OAUTH_JSON_FIELD = /"(access_token|refresh_token|id_token|client_secret)"(\s*:\s*)"[^"]*"/gi;

// ★ Form-encoded OAuth token fields: access_token=… up to the next & or whitespace.
const OAUTH_FORM_FIELD = /\b(access_token|refresh_token|id_token|client_secret)=[^&\s]+/gi;

/**
 * ★★★ CT-095 — the one credential scrubber. Replaces every match of the patterns above with the
 * literal "[redacted]". Idempotent; never throws.
 * @param {unknown} text
 * @returns {string}
 */
export function scrubSecrets(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(PEM_BLOCK, REDACTED)
    .replace(KEY_PREFIX, REDACTED)
    .replace(HEADER_VALUE, `$1$2${REDACTED}`)
    .replace(OAUTH_JSON_FIELD, `"$1"$2"${REDACTED}"`)
    .replace(OAUTH_FORM_FIELD, `$1=${REDACTED}`);
}
