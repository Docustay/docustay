// PH1 — the site snippet's channel classification and the declined path's click-id stripping (src/lib/site/posthogChannel.js).
import test from "node:test";
import assert from "node:assert/strict";
import { classify, stripIds, CLICK_IDS } from "../src/lib/site/posthogChannel.js";

const P = "https://docustay.app/pricing";
test("AI assistants are their own channel, by referrer or utm_source", () => {
  assert.deepEqual(classify(P, "https://chatgpt.com/"), { traffic_channel: "ai_assistant", ai_assistant: "chatgpt", ad_network: null });
  assert.equal(classify(P, "https://www.perplexity.ai/search?q=x").ai_assistant, "perplexity");
  assert.equal(classify(P, "https://claude.ai/chat/1").ai_assistant, "claude");
  assert.equal(classify(P, "https://gemini.google.com/app").ai_assistant, "gemini");
  assert.equal(classify(P, "https://copilot.microsoft.com/").ai_assistant, "copilot");
  assert.equal(classify(P + "?utm_source=chatgpt.com", "").traffic_channel, "ai_assistant");
});
test("ads by click id, search, social, email, campaign, referral, direct", () => {
  assert.deepEqual(classify(P + "?gclid=abc", "https://www.google.com/"), { traffic_channel: "paid_search", ai_assistant: null, ad_network: "google" });
  assert.equal(classify(P + "?gbraid=x", "").ad_network, "google");
  assert.equal(classify(P + "?msclkid=x", "").traffic_channel, "paid_search");
  assert.deepEqual(classify(P + "?fbclid=x", "https://facebook.com/"), { traffic_channel: "paid_social", ai_assistant: null, ad_network: "meta" });
  assert.equal(classify(P + "?li_fat_id=x", "").ad_network, "linkedin");
  assert.equal(classify(P + "?ttclid=x", "").ad_network, "tiktok");
  assert.equal(classify(P + "?utm_medium=cpc&utm_source=google", "").traffic_channel, "paid_search");
  assert.equal(classify(P, "https://www.google.co.uk/").traffic_channel, "organic_search");
  assert.equal(classify(P, "https://duckduckgo.com/").traffic_channel, "organic_search");
  assert.equal(classify(P, "https://news.ycombinator.com/item?id=1").traffic_channel, "social");
  assert.equal(classify(P + "?utm_medium=email", "").traffic_channel, "email");
  assert.equal(classify(P + "?utm_source=newsletter", "").traffic_channel, "campaign");
  assert.equal(classify(P, "https://someblog.dev/post").traffic_channel, "referral");
  assert.equal(classify(P, "").traffic_channel, "direct");
});
test("declined visitors: every ad click id is removed from the address, campaign tags stay", () => {
  const u = P + "?utm_source=x&" + CLICK_IDS.map((k) => `${k}=v`).join("&");
  const s = stripIds(u);
  for (const k of CLICK_IDS) assert.ok(!s.includes(`${k}=`), k);
  assert.ok(s.includes("utm_source=x"));
  assert.equal(stripIds("not a url"), "not a url");
});
