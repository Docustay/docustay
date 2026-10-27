// The page registry: every marketing page is data here, drawn by PageView. A route asks for a page by path; the build asks for the list.
import { SEND, SEND_NAME, CURL_SEND } from "./snippets.js";
import { FEATURE_PAGES } from "./features.js";
import { SELFHOST_PAGES } from "./selfhost.js";
import { USECASE_PAGES } from "./usecases.js";
import { DEV_PAGES } from "./developers.js";
import { TRUST_PAGES } from "./trust.js";
import { COMPANY_PAGES } from "./company.js";
import { V1_PAGES } from "./v1.js";
import { SUITE_PAGES } from "./payments-suite.js";
import { AI_PLAN } from "./aiPlan.js";
import facts from "../facts.gen.json" with { type: "json" };
import { ADD as ADD3 } from "./pass3.js";
import { ADD4 } from "./pass4.js";
const ADD = Object.fromEntries([...new Set([...Object.keys(ADD3), ...Object.keys(ADD4)])].map((k) => [k, [...(ADD3[k] ?? []), ...(ADD4[k] ?? [])]]));
import { dollars, DEFAULT_PLANS, SELFHOST_PRO_YEARLY_MINOR, COMMERCIAL_FROM_MINOR, LIMITS, FACTS_CHECKED } from "../plans.js";

const ORDER = ["javascript", "typescript", "python", "go", "php", "csharp"];
export const sendTabs = () => ORDER.filter((k) => SEND[k]).map((k) => ({ label: SEND_NAME[k] ?? k, code: SEND[k] }));

const GROUPS = [FEATURE_PAGES, SELFHOST_PAGES, USECASE_PAGES, DEV_PAGES, TRUST_PAGES, COMPANY_PAGES, V1_PAGES, SUITE_PAGES];
const hubTabs = () => [{ label: "curl", code: CURL_SEND }, { label: "JavaScript", code: SEND.javascript }, { label: "Python", code: SEND.python }];
const fill = (b) => (b.tabs === "__SEND_TABS__" ? { ...b, tabs: sendTabs() } : b.tabs === "__HUB_TABS__" ? { ...b, tabs: hubTabs() } : b.t === "tree" ? { ...b, selfPro: `${dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install`, commercial: `from about ${dollars(COMMERCIAL_FROM_MINOR)} a year` } : b);
// The /product pages became /features (V2, 14 Oct 2026): every internal link and mention is rewritten once, here, so no page links to a redirect. Plays and Playbooks is the only name for reusable instructions.
const MOVED = { "/product": "/features/how-it-works", "/product/sending": "/features/how-it-works#send", "/product/signing-order": "/features/how-it-works#send", "/product/signing": "/features/how-it-works#sign", "/product/tracking": "/features/how-it-works#prove", "/product/proof": "/features/proof", "/product/payments": "/features/payments", "/product/scribe": "/features/scribe", "/product/teams": "/pricing#teams", "/product/templates": "/free-templates", "/product/forms": "/free-templates" };
const relink = (v) => v.replace(/\/form-templates\/([a-z0-9-]+)/g, "/templates/$1").replace(/\/(document|form)-templates(?![A-Za-z0-9/-])/g, "/free-templates").replace(/\/product(\/[a-z-]+)?(?![A-Za-z0-9/-])/g, (m) => MOVED[m] ?? m).replace(/Templates and skills API/g, "Plays and Playbooks API").replace(/templates and skills API/g, "Plays and Playbooks API").replace(/your own skills and playbooks are on Pro/g, "your own Plays and Playbooks are on Pro").replace(/Write your own skills/g, "Write your own Plays");
// The tokens a page may use in its words. Every number is read from the one price list (prices.json through plans.js) or the generated facts, so a page never types a price by hand.
const cents = (m) => (m % 100 === 0 ? dollars(m) : `$${(m / 100).toFixed(2)}`);
const TOKENS = () => ({ FREE_CREDITS: AI_PLAN.freeCredits, PRO_CREDITS: AI_PLAN.proCredits, FREE_DOCS: DEFAULT_PLANS.free.docsPerMonth, PRO_PRICE: dollars(DEFAULT_PLANS.pro.monthlyMinor), SELFHOST_PRICE: dollars(SELFHOST_PRO_YEARLY_MINOR),
  FREE_TEMPLATES: DEFAULT_PLANS.free.templatesPerMonth, FREE_SIGNERS: DEFAULT_PLANS.free.signersPerMonth, PAYG_TEMPLATES: DEFAULT_PLANS.payg.templatesPerMonth, COMMERCIAL_FROM: dollars(COMMERCIAL_FROM_MINOR),
  FREE_MB: LIMITS.freeUploadMb, PRO_MB: LIMITS.proUploadMb, FREE_EMAILS: LIMITS.freeEmailsPerDay, PRO_EMAILS: LIMITS.proEmailsPerDay, API_RATE: LIMITS.apiRequestsPerMinute, FACTS_CHECKED, OPS: facts.operations, MCP_TOOLS: facts.mcpTools, LANGS: facts.languages, HEADLINE: facts.tagline.headline, TAG_SHORT: facts.tagline.short, TAG_VERY_SHORT: facts.tagline.veryShort, SITE_TITLE: facts.tagline.siteTitle, SUPPORT: facts.tagline.support, PAYG_LINE: facts.tagline.payAsYouGoLine, ABOUT_LINE: facts.tagline.about, SCOPES: facts.scopes, TEMPLATES: facts.templates, SDK_LANGS: facts.sdkLanguages, SDK_LANGS_WORD: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"][facts.sdkLanguages],
  PAYG_PERSON: dollars(DEFAULT_PLANS.payg.personMonthlyMinor), PAYG_DOCS: DEFAULT_PLANS.payg.docsIncluded, PAYG_DOC_OVER: cents(DEFAULT_PLANS.payg.docOverMinor), PAYG_DRAFTS: DEFAULT_PLANS.payg.draftsIncluded, DRAFT_OVER: cents(DEFAULT_PLANS.payg.draftOverMinor),
  LIFETIME_PRICE: dollars(DEFAULT_PLANS.lifetime.oneTimeMinor), LIFETIME_DRAFTS: DEFAULT_PLANS.lifetime.draftsIncluded, BUDGET: dollars(DEFAULT_PLANS.budget.defaultMinor), BULK_FREE: DEFAULT_PLANS.free.bulkCap,
  FREE_FEE: `${DEFAULT_PLANS.free.feeBps / 100}%`, PRO_FEE: `${DEFAULT_PLANS.pro.feeBps / 100}%` });
let TOK = null;
const aiFill = (v) => (typeof v === "string" ? relink(v).replace(/__([A-Z0-9_]+)__/g, (m, k) => { TOK ??= TOKENS(); return k in TOK ? String(TOK[k]) : m; }) : v);
const deep = (o) => (Array.isArray(o) ? o.map(deep) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : aiFill(o));
// Site pass 3: the extra sections for a page (pages/pass3*.js) go in just before its FAQ, so every page still ends on questions and one next step.
const withExtra = (p) => { const add = ADD[p.addFrom ?? p.path]; if (!add?.length) return p.blocks; const i = p.blocks.findLastIndex((b) => b.t === "faq"); return i < 0 ? [...p.blocks, ...add] : [...p.blocks.slice(0, i), ...add, ...p.blocks.slice(i)]; };
const resolve = (p) => ({ ...p, hero: p.hero ? fill(p.hero) : p.hero, blocks: withExtra(p).map(fill) });
export const ALL = GROUPS.flat().map(resolve).map(deep);
export const byPath = (path) => ALL.find((p) => p.path === path);
export const under = (prefix) => ALL.filter((p) => p.path.startsWith(prefix + "/")).map((p) => p.path.slice(prefix.length + 1));
