// src/product/demoConfig.mjs — Launch step 8: the public demo's switch and limits. Pure (imports nothing), so the sign-in config route, the demo module and the tests all read the one answer.
// The demo is OFF unless KEYSTONE_DEMO_ENABLED=1, and never on a self-hosted install (a self-host's owner comes from /setup; nobody gets a throw-away workspace there).
const int = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };
export const demoEnabled = (env = process.env) => env.KEYSTONE_DEMO_ENABLED === "1" && env.KEYSTONE_SELF_HOST !== "1";
export const demoLimits = (env = process.env) => ({
  hours: int(env.KEYSTONE_DEMO_HOURS, 24, 1, 72),                    // a demo workspace lives this long, then is purged
  perIpPerHour: int(env.KEYSTONE_DEMO_PER_IP_HOUR, 3, 1, 50),        // new demos one address may start in an hour
  maxActive: int(env.KEYSTONE_DEMO_MAX_ACTIVE, 300, 1, 5000),        // demo workspaces alive at once, across everyone
  aiPrompts: int(env.KEYSTONE_DEMO_AI_PROMPTS, 5, 0, 50),            // real Scribe prompts per demo; after that the scripted "Demo AI" answers
  uploadBytes: int(env.KEYSTONE_DEMO_UPLOAD_BYTES, 2 * 1024 * 1024, 1024, 25 * 1024 * 1024),   // the one PDF a demo visitor may upload
  uploads: int(env.KEYSTONE_DEMO_UPLOADS, 1, 0, 5),
});
