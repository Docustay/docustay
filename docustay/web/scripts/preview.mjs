#!/usr/bin/env node
// Serves the built site from its OWN COPY of the build folder (build-preview), so rebuilding while a preview runs can never crash it.
// Without this a running server loads page code lazily from build/, and `vite build` replaces those files under it: pages not yet visited then answer 500 (reproduced 5 Oct 2026, ERR_MODULE_NOT_FOUND).
//   node scripts/preview.mjs [port]        default 5190; Ctrl-C to stop; run `npm run build` again and restart to see changes
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const port = process.argv[2] ?? "5190", copy = path.join(ROOT, "build-preview");
if (!fs.existsSync(path.join(ROOT, "build", "index.js"))) { console.error("no build yet: run `npm run build` first"); process.exit(1); }
fs.rmSync(copy, { recursive: true, force: true }); fs.cpSync(path.join(ROOT, "build"), copy, { recursive: true });
const srv = spawn("node", ["build-preview/index.js"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, PORT: port, HOST: "127.0.0.1", ORIGIN: `http://127.0.0.1:${port}`, DOCUSTAY_API_URL: process.env.DOCUSTAY_API_URL ?? "http://127.0.0.1:8791" } });
console.log(`preview on http://127.0.0.1:${port} (a copy of build/; rebuilds do not affect it)`);
srv.on("exit", (c) => process.exit(c ?? 0));
