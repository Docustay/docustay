// Which kind of page a path is (shared by the depth gate and the visual gate).
const DEV_SUB = new Set(["quickstart", "api", "webhooks", "sdks", "cli", "mcp", "test-mode", "embedding", "embed", "keys-and-security", "agents", "plays"]);
export function typeOf(p) {
  if (p === "/") return "home"; if (p === "/developers") return "devhub"; if (p === "/pricing") return "pricing";
  if (p === "/features") return "featuresHub"; if (p === "/features/how-it-works") return "howItWorks"; if (p === "/features/scribe" || p === "/features/payments") return "featureBig"; if (p === "/features/proof") return "featureMid"; if (p.startsWith("/features/")) return "featureBuilt";
  if (p.startsWith("/developers/") && DEV_SUB.has(p.split("/")[2])) return "devpage"; if (p === "/use-cases") return "usecaseIndex"; if (p.startsWith("/use-cases/")) return "usecase";
  if (p === "/free-templates") return "templatesHub"; if (p.startsWith("/templates/")) return "template"; if (p === "/sign-pdf" || p.startsWith("/sign-pdf/")) return "signpdf";
  if (p === "/self-host") return "selfhost"; if (p.startsWith("/self-host/")) return "selfhostChild"; if (p === "/open-source" || p === "/licensing") return "osLicence"; if (p === "/trust") return "trust"; if (p === "/trust/legal-validity") return "legalValidity";
  if (p === "/about") return "about"; if (p === "/demo") return "demo"; if (p === "/changelog") return "changelog"; if (p.startsWith("/changelog/")) return "changelogEntry";
  if (p.startsWith("/tools/")) return "tool"; if (p.startsWith("/guides/")) return "guide"; if (p === "/contact") return "contact"; if (p === "/status") return "status"; if (p === "/legal/refunds" || p === "/legal/renewal") return "legalShort"; if (p.startsWith("/legal/")) return "legal"; if (p.startsWith("/docs")) return "docs"; if (p === "/404") return "notFound";
  return "other";
}
