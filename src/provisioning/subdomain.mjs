// P2.14 — SUBDOMAIN VALIDATION = THE **INTERSECTION** OF EVERY DOWNSTREAM SYSTEM'S RULES,
//         PLUS A RESERVED LIST.
//
// ★★★ INTERSECTION, NOT UNION. This is the whole item and it is easy to get backwards.
// A subdomain is only usable if EVERY downstream system accepts it. If we apply the union — "any
// system allows it" — we accept a name that one vendor will later reject, and we do not find out
// until provisioning, by which time the customer has typed it, seen it confirmed, and possibly
// paid. The strictest rule wins, always.
//
// ★★ AND THE CHECK MUST RUN BEFORE THE TENANT ROW IS WRITTEN. A name accepted here and rejected
// by a vendor later produces exactly the partial state P2.5 works to avoid: a live tenant holding
// a subdomain that can never be fully provisioned.
//
// ★ The constraints below are recorded WITH their source so a future session can re-derive them
// rather than trusting this comment.

/**
 * Per-system constraints. Each entry says what that system enforces, so the intersection is
 * auditable rather than a single hand-merged regex nobody can check.
 */
export const SYSTEM_RULES = [
  {
    system: "dns-label",
    why: "RFC 1035 host label — binds because the subdomain becomes a hostname",
    maxLength: 63,
    minLength: 1,
    test: (s) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s),
    explain: "letters, digits and hyphens only; must start and end with a letter or digit",
  },
  {
    system: "tls-certificate",
    why: "a wildcard certificate covers ONE label; an embedded dot would need its own cert",
    test: (s) => !s.includes("."),
    explain: "may not contain a dot",
  },
  {
    system: "postgres-slug",
    why: "stored lowercase and compared with lower(); mixed case would create two names that collide",
    test: (s) => s === s.toLowerCase(),
    explain: "must be lowercase",
  },
  {
    system: "email-local-part",
    why: "used to build addresses like noreply@<slug>.…; leading/trailing hyphens break some parsers",
    test: (s) => !s.startsWith("-") && !s.endsWith("-"),
    explain: "may not start or end with a hyphen",
  },
  {
    system: "url-safety",
    why: "appears in URLs and in generated document filenames",
    test: (s) => !/--/.test(s),
    // ★ A doubled hyphen is not merely ugly: `xn--` is the IDNA punycode prefix, and a label
    // beginning with any two-letter prefix followed by `--` is reserved by RFC 5891.
    explain: "may not contain a doubled hyphen (RFC 5891 reserves the xx-- form for punycode)",
  },
  {
    system: "minimum-length",
    why: "a 1–2 character subdomain collides with country codes and is unusable in practice",
    minLength: 3,
    test: (s) => s.length >= 3,
    explain: "must be at least 3 characters",
  },
];

// ★ RESERVED NAMES. Two distinct classes, and both matter:
//   1. Infrastructure we ourselves serve on — taking one would break the platform.
//   2. Names that let a tenant IMPERSONATE the platform to their own clients.
// ★★ The second class is a security concern, not a tidiness one: a tenant at `security.…` or
// `billing.…` sending mail is materially more convincing as a phishing origin.
export const RESERVED = new Set([
  // infrastructure
  "www", "api", "app", "admin", "mail", "smtp", "imap", "pop", "ftp", "ns", "ns1", "ns2",
  "mx", "cdn", "static", "assets", "media", "files", "img", "images",
  "dev", "staging", "stage", "test", "testing", "demo", "sandbox", "preview", "local",
  "status", "health", "metrics", "monitor", "grafana", "kibana",
  "db", "database", "postgres", "redis", "queue", "worker", "cron",
  "auth", "login", "logout", "signup", "signin", "sso", "oauth", "account", "accounts",
  "docs", "documentation", "help", "support", "blog", "news", "about", "legal", "privacy", "terms",
  // ★ impersonation risk
  "security", "billing", "payments", "invoice", "invoices", "noreply", "no-reply",
  "postmaster", "abuse", "webmaster", "hostmaster", "root", "system", "official", "verify",
  "keystone", "keystoneapp", "keystone-app",
  // super admin namespace (P2.16)
  "superadmin", "super-admin", "platform", "internal",
  // ★ PRODUCT FRONT DOORS (QUEUE §18.3c / §23.1.3, 3 Oct 2026). `docu.<domain>` is the Docustay site and `booking.<domain>` its sibling; a practice that claimed either as
  //   its slug would be served the wrong site, and could impersonate the product. Reserved BEFORE the domains go live so nobody can already hold them.
  "docu", "docustay", "booking", "bookings", "workbench", "examplecore", "sign", "esign", "sites", "site",
]);

/**
 * @returns {{ok: boolean, slug: string, failures: Array}}
 * ★ Returns ALL failures, not the first. A form that reveals one problem at a time turns a single
 * correction into four round trips.
 */
export function validateSubdomain(raw) {
  const failures = [];
  const slug = typeof raw === "string" ? raw.trim() : "";

  if (!slug) {
    return { ok: false, slug, failures: [{ system: "input", explain: "a subdomain is required" }] };
  }

  // ★ Every system's rule is evaluated — the INTERSECTION requires all of them to pass.
  for (const rule of SYSTEM_RULES) {
    if (rule.maxLength && slug.length > rule.maxLength) {
      failures.push({ system: rule.system, explain: `must be at most ${rule.maxLength} characters`, why: rule.why });
      continue;
    }
    if (!rule.test(slug)) {
      failures.push({ system: rule.system, explain: rule.explain, why: rule.why });
    }
  }

  if (RESERVED.has(slug.toLowerCase())) {
    failures.push({
      system: "reserved",
      explain: `"${slug}" is reserved`,
      why: "it is either platform infrastructure or a name that could be used to impersonate the platform",
    });
  }

  return { ok: failures.length === 0, slug, failures };
}

/** True only if EVERY system accepts it. Named so the intersection is obvious at the call site. */
export const isAcceptedByEverySystem = (slug) => validateSubdomain(slug).ok;
