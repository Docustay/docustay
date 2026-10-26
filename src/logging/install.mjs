// Run 7 part 6 — imported FIRST by src/server.mjs and src/worker.mjs (an ES module's imports run in order), so no line is logged before redaction is on.
import { installLogRedaction } from "./redactLogs.mjs";
if (process.env.KEYSTONE_LOG_REDACTION !== "off") installLogRedaction();
