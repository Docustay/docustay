// Run 7 part 6 — LOG REDACTION FOR THE WHOLE PROCESS. The server and the worker write their logs with console.*; this wraps those methods once, at start, so every line leaves the process with
// credentials scrubbed (scrubSecrets, src/logging/scrub.mjs) and email addresses replaced by "[email]". Names cannot be told from other words, so code that logs about a person logs their id;
// this is the backstop for the lines that do not. Error objects are logged by their stack, scrubbed the same way. Installed by src/server.mjs and src/worker.mjs before anything else runs.
import { format } from "node:util";
import { scrubSecrets } from "./scrub.mjs";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** One log line made safe to keep: no credential, no email address. Never throws. */
export function redactLine(text) {
  if (typeof text !== "string") return "";
  return scrubSecrets(text).replace(EMAIL, "[email]");
}

let installed = false;
export function installLogRedaction(target = console) {
  if (installed && target === console) return;
  for (const m of ["log", "info", "warn", "error", "debug"]) {
    const orig = target[m].bind(target);
    target[m] = (...args) => orig(redactLine(format(...args)));
  }
  if (target === console) installed = true;
}
