// Channel classification and click-id stripping for the PostHog site snippet (PostHog.svelte). Pure functions, tested in tests/posthog-site.test.mjs.
export const CLICK_IDS = ["gclid", "gbraid", "wbraid", "msclkid", "fbclid", "ttclid", "li_fat_id", "dclid", "twclid", "igshid"];
export const AI = { "chatgpt.com": "chatgpt", "chat.openai.com": "chatgpt", "perplexity.ai": "perplexity", "claude.ai": "claude", "gemini.google.com": "gemini", "copilot.microsoft.com": "copilot", "you.com": "you", "phind.com": "phind" };
const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z]+|ecosia\.org|search\.brave\.com|baidu\.com)$/;
const SOCIAL = /(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|lnkd\.in|reddit\.com|news\.ycombinator\.com|producthunt\.com|youtube\.com|tiktok\.com|threads\.net|bsky\.app|mastodon\.social)$/;

/** The channel a visit came from: ai_assistant, paid_search, paid_social, organic_search, social, email, campaign, referral or direct. */
export function classify(href, referrer) {
  let q, ref = "";
  try { q = new URL(href).searchParams; } catch { q = new URLSearchParams(); }
  try { ref = new URL(referrer).hostname.replace(/^www\./, ""); } catch { /* none */ }
  const medium = (q.get("utm_medium") ?? "").toLowerCase(), source = (q.get("utm_source") ?? "").toLowerCase();
  const ai = AI[ref] ?? Object.entries(AI).find(([h]) => source.includes(h.split(".")[0]))?.[1] ?? null;
  const ad = q.has("gclid") || q.has("gbraid") || q.has("wbraid") || q.has("dclid") ? "google" : q.has("msclkid") ? "microsoft" : q.has("fbclid") ? "meta"
    : q.has("ttclid") ? "tiktok" : q.has("li_fat_id") ? "linkedin" : q.has("twclid") ? "x" : null;
  const channel = ai ? "ai_assistant"
    : (ad && ["google", "microsoft"].includes(ad)) || /^(cpc|ppc|paid|paidsearch|paid_search)$/.test(medium) ? "paid_search"
    : ad || /^(paid_social|paidsocial|social_paid)$/.test(medium) ? "paid_social"
    : /^e-?mail$/.test(medium) ? "email"
    : SEARCH.test(ref) ? "organic_search" : SOCIAL.test(ref) || medium === "social" ? "social"
    : medium || source ? "campaign" : ref ? "referral" : "direct";
  return { traffic_channel: channel, ai_assistant: ai, ad_network: ad };
}
/** A URL with every ad click id removed (the declined path). */
export const stripIds = (u) => { try { const x = new URL(u); for (const k of CLICK_IDS) x.searchParams.delete(k); return x.toString(); } catch { return u; } };
