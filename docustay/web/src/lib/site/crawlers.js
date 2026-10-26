// Every AI and search crawler named in robots.txt: allowed on the public pages, kept out of the app, the API and the signing pages (they hold customers' documents).
// Sources, checked 12 Oct 2026 against each operator's own page: OpenAI developers.openai.com/api/docs/bots · Anthropic support.claude.com (crawler article) · Google developers.google.com/crawling (common crawlers) · Apple support.apple.com/119829 · Meta developers.facebook.com/docs/sharing/webmasters/web-crawlers · Perplexity docs.perplexity.ai/guides/bots · Amazon developer.amazon.com/amazonbot · Common Crawl (CCBot) · DuckDuckGo help (DuckAssistBot) · Mistral docs.mistral.ai/robots · You.com docs.you.com/youbot · Diffbot docs.diffbot.com.
// robots.txt only asks. Crawlers that ignore it (and user-requested fetchers such as ChatGPT-User, Perplexity-User and Meta-ExternalFetcher, which their operators say may bypass it) are not controlled by it: only authentication and network rules do that.
export const CRAWLERS = {
  "OpenAI": ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "OAI-AdsBot"],
  "Anthropic": ["ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai"],
  "Perplexity": ["PerplexityBot", "Perplexity-User"],
  "Google": ["Googlebot", "Googlebot-Image", "Google-Extended", "GoogleOther", "GoogleOther-Image", "GoogleOther-Video", "Google-CloudVertexBot"],
  "Microsoft": ["Bingbot"],
  "Apple": ["Applebot", "Applebot-Extended"],
  "Meta": ["Meta-ExternalAgent", "Meta-ExternalFetcher", "Meta-WebIndexer", "FacebookBot", "facebookexternalhit"],
  "Amazon": ["Amazonbot", "Amzn-SearchBot", "Amzn-User"],
  "ByteDance": ["Bytespider"],
  "Common Crawl": ["CCBot"],
  "Cohere": ["cohere-ai", "cohere-training-data-crawler"],
  "DuckDuckGo": ["DuckAssistBot"],
  "Mistral": ["MistralAI-User", "MistralAI-Index", "MistralAI-Training"],
  "You.com": ["YouBot"],
  "Diffbot": ["Diffbot"],
  "Others": ["ImagesiftBot", "Omgilibot", "Timpibot"],   // named in public bot lists; their operators publish little, so these three are listed on that evidence only
};
export const BOTS = Object.values(CRAWLERS).flat();
// Kept out of every crawler: the API, the signing pages, and every signed-in app route (the app lives on app.docustay.app; these also stop a crawler that reaches them on this host).
export const KEEP_OUT = ["/api/", "/sign/", "/f/", "/embed/", "/documents", "/settings", "/admin", "/automations", "/billing", "/console", "/contracts", "/create", "/forms", "/payments", "/people", "/contacts", "/playbooks", "/plays", "/reports", "/upgrade", "/login", "/signup", "/forgot", "/invite", "/oauth", "/reset", "/setup", "/templates$"];
// A public path that must stay crawlable even though an app route shares its first letters.
export const MUST_ALLOW = ["/", "/pricing", "/docs", "/docs/quickstart", "/free-templates", "/templates/nda-template", "/whats-next", "/demo", "/about", "/openapi.json", "/llms.txt"];
export const robotsTxt = (base) => {
  const rules = `Allow: /\n${KEEP_OUT.map((p) => `Disallow: ${p}`).join("\n")}\n`;
  return `# Docustay: the public pages are open to every search and AI crawler, training crawlers included.\n# The API, the signing pages and the signed-in app are closed to all of them: they hold customers' documents.\n# robots.txt is a request. It cannot control a crawler that ignores it.\n${BOTS.map((b) => `User-agent: ${b}`).join("\n")}\n${rules}\nUser-agent: *\n${rules}\nSitemap: ${base}/sitemap.xml\n`;
};
