import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const DEFAULT_URL = "https://app.docustay.app";
export const configPath = (env = process.env) => path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "docustay", "config.json");
export function readConfig(env = process.env) {
  let file = {}; try { file = JSON.parse(fs.readFileSync(configPath(env), "utf8")); } catch { /* none yet */ }
  return { apiKey: env.DOCUSTAY_API_KEY || file.apiKey || null, baseUrl: (env.DOCUSTAY_URL || file.baseUrl || DEFAULT_URL).replace(/\/+$/, ""), relayWebhookId: file.relayWebhookId ?? null };
}
export function writeConfig(patch, env = process.env) {
  const p = configPath(env); fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* new */ }
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(p, 0o600);
}
export const isTestKey = (key) => /^(?:gl|dsk)_test_/.test(String(key ?? ""));
export const mask = (key) => (key ? `${String(key).slice(0, key.indexOf("_", key.indexOf("_") + 1) + 5)}…${String(key).slice(-4)}` : "");
