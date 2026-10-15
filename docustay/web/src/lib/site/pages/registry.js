// The page registry: every marketing page is data here, drawn by PageView. A route asks for a page by path; the build asks for the list.
import { SEND, SEND_NAME, CURL_SEND } from "./snippets.js";
import { PRODUCT_PAGES } from "./product.js";
import { USECASE_PAGES } from "./usecases.js";
import { DEV_PAGES } from "./developers.js";
import { TRUST_PAGES } from "./trust.js";
import { COMPANY_PAGES } from "./company.js";
import { AI_PLAN } from "./aiPlan.js";
import { ADD } from "./pass3.js";
import { dollars, DEFAULT_PLANS, SELFHOST_PRO_YEARLY_MINOR, COMMERCIAL_FROM_MINOR } from "../plans.js";

const ORDER = ["javascript", "typescript", "python"];
export const sendTabs = () => ORDER.filter((k) => SEND[k]).map((k) => ({ label: SEND_NAME[k] ?? k, code: SEND[k] }));

const GROUPS = [PRODUCT_PAGES, USECASE_PAGES, DEV_PAGES, TRUST_PAGES, COMPANY_PAGES];
const hubTabs = () => [{ label: "curl", code: CURL_SEND }, { label: "JavaScript", code: SEND.javascript }, { label: "Python", code: SEND.python }];
const fill = (b) => (b.tabs === "__SEND_TABS__" ? { ...b, tabs: sendTabs() } : b.tabs === "__HUB_TABS__" ? { ...b, tabs: hubTabs() } : b.t === "tree" ? { ...b, selfPro: `${dollars(SELFHOST_PRO_YEARLY_MINOR)} a year per install`, commercial: `from about ${dollars(COMMERCIAL_FROM_MINOR)} a year` } : b);
const aiFill = (v) => (typeof v === "string" ? v.replace("__FREE_CREDITS__", AI_PLAN.freeCredits).replace("__PRO_CREDITS__", AI_PLAN.proCredits).replace("__FREE_DOCS__", DEFAULT_PLANS.free.docsPerMonth).replace("__PRO_PRICE__", dollars(DEFAULT_PLANS.pro.monthlyMinor)).replace("__SELFHOST_PRICE__", dollars(SELFHOST_PRO_YEARLY_MINOR)) : v);
const deep = (o) => (Array.isArray(o) ? o.map(deep) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : aiFill(o));
// Site pass 3: the extra sections for a page (pages/pass3*.js) go in just before its FAQ, so every page still ends on questions and one next step.
const withExtra = (p) => { const add = ADD[p.path]; if (!add?.length) return p.blocks; const i = p.blocks.findLastIndex((b) => b.t === "faq"); return i < 0 ? [...p.blocks, ...add] : [...p.blocks.slice(0, i), ...add, ...p.blocks.slice(i)]; };
const resolve = (p) => ({ ...p, hero: p.hero ? fill(p.hero) : p.hero, blocks: withExtra(p).map(fill) });
export const ALL = GROUPS.flat().map(resolve).map(deep);
export const byPath = (path) => ALL.find((p) => p.path === path);
export const under = (prefix) => ALL.filter((p) => p.path.startsWith(prefix + "/")).map((p) => p.path.slice(prefix.length + 1));
