// The Billing page's numbers, in one place. EVERY figure here is read from the status payload (`GET /api/product/docustay/status`: `plans[]`, `upgrade.plan`, `usage`, `seats`, `budget`), which in
// turn reads the one price list (src/product/docustayPrices.mjs). Nothing is typed in a component and nothing is computed from a plan's name. Pure: no state, no network.
import { money } from "$lib/api.js";
import { t } from "$lib/i18n/index.svelte.js";

/** The order the plans are shown in. Keys only, no numbers. */
export const ORDER = Object.freeze(["docustay_free", "docustay_payg", "docustay_pro", "docustay_lifetime"]);
export const SHORT = Object.freeze({ docustay_free: "free", docustay_payg: "payg", docustay_pro: "pro", docustay_lifetime: "lifetime" });
export const NAME_OF = (key) => ({ free: "Free", payg: "Pay as you go", pro: "Pro", lifetime: "Lifetime" })[SHORT[key]] ?? key;


/** One column of the comparison per plan: the words in each row. `current` marks the plan this workspace is on. */
export function columns(st) {
  const by = new Map((st?.plans ?? []).map((p) => [p.key, p]));
  const pro = st?.upgrade?.plan ?? null;
  return ORDER.filter((k) => by.has(k)).map((key) => {
    const p = by.get(key), short = SHORT[key];
    const price = short === "free" ? { main: money(p.priceMinor ?? 0), sub: t("always") }
      : short === "payg" ? { main: money(p.priceMinor ?? 0), sub: t("per team member a month") }
      : short === "pro" ? (pro?.priceMinor != null ? { main: money(pro.priceMinor), sub: t("a month"), note: pro.founders ? t("Founders price, kept for as long as you stay.") : "" } : { main: "—", sub: "" })
      : { main: money(p.priceMinor ?? 0), sub: t("once"), note: p.firstWorkspaces ? t("First {n} workspaces", { n: p.firstWorkspaces }) : "" };
    const cell = (k) => (st?.words?.compare ?? []).find((r) => r.key === k)?.cells?.[short] ?? "";
    return {
      key, short, name: p.name, current: st?.plan?.key === key, price,
      team: cell("team"), signers: cell("signers"), docs: cell("documents"), drafts: cell("ai"), templates: cell("templates"), fee: cell("fee"), plays: cell("plays") === "Yes",
      raw: p,
    };
  });
}

/** The rows of the table: [label, field, hint]. The words come from the status payload (`words.compare`), the one list the website and the docs read as well. */
export const ROWS = (st) => {
  const w = new Map((st?.words?.compare ?? []).map((r) => [r.key, r]));
  const L = (key, fallback) => w.get(key)?.label ?? fallback;
  return [
    [L("price", t("Price")), "price", null], [L("team", t("Team members")), "team", w.get("team")?.hint ?? null], [L("signers", t("Signers")), "signers", w.get("signers")?.hint ?? null],
    [L("documents", t("Documents sent each month")), "docs", null], [L("ai", t("AI drafts each month")), "drafts", null], [L("templates", t("New templates each month")), "templates", null],
    [L("fee", t("Docustay fee")), "fee", null], [L("plays", t("Your own plays and playbooks")), "plays", null],
  ];
};

/** What a plan switches on, as short lines (the Welcome state and the switch dialogs). */
export function bullets(col) {
  if (!col) return [];
  const raw = col.raw;
  const lines = [col.docs === t("Unlimited") ? t("Unlimited documents") : t("{n} documents each billing month: {rest}", { n: raw.docsPerMonth, rest: col.docs }),
    t("AI drafts: {rest}", { rest: col.drafts })];
  if (col.short === "payg") lines.push(t("{n} new templates each month", { n: raw.templatesPerMonth ?? 25 }), t("Unlimited signers, free"), t("Team members are {price} each a month", { price: money(raw.priceMinor ?? 0) }), t("You set a budget for each billing month; sending pauses at 100% of it"));
  else lines.push(t("{fee} fee on payments", { fee: col.fee }), t("Unlimited templates, signers and team members"), ...(col.plays ? [t("Your own plays and playbooks")] : []));
  return lines;
}

/** A card as the page writes it: •••• 4242 · 08/27. */
export const cardText = (c) => (c ? `•••• ${c.last4 ?? ""} · ${String(c.expMonth ?? "").padStart(2, "0")}/${String(c.expYear ?? "").slice(-2)}` : "");
export const brandName = (b) => ({ visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay", cartes_bancaires: "Cartes Bancaires" })[String(b ?? "").toLowerCase()] ?? (b ? String(b).replace(/_/g, " ") : "");
/** true only when the card is really past its date. */
export function cardExpired(c, now = new Date()) {
  if (!c?.expYear || !c?.expMonth) return false;
  const y = Number(c.expYear) < 100 ? 2000 + Number(c.expYear) : Number(c.expYear);
  return y < now.getUTCFullYear() || (y === now.getUTCFullYear() && Number(c.expMonth) < now.getUTCMonth() + 1);
}
/** Where the notches sit on the budget bar: the alert percents of the price list (through the budget state), without the last one (100 is the end of the bar). */
export const notchesOf = (budget) => (budget?.alertPercents ?? []).filter((p) => p < 100);

/** Who is charged, and when, in plain sentences (one source for the Billing page and the Team page). `short` is free | payg | pro | lifetime; `unitMinor` is the Pay as you go price of one person, from the price list in the status payload. */
export function chargeWords(short, unitMinor = null) {
  const out = [];
  if (short === "payg") {
    out.push(t("Pay as you go charges {price} a month for each team member (Owner, Admin or Member) who has joined.", { price: money(unitMinor ?? 0) }));
    out.push(t("An invitation that has not been accepted is not charged."));
    out.push(t("Your team member count is sent to billing once a day, after an invitation is accepted. Removing someone lowers it at the next update."));
  } else if (short === "selfhost") {   // R13-D363: a self-hosted install has no plans; it said "Free is for one team member" and then let a second invite through
    out.push(t("This install has no plans: invite as many team members as you need."));
    out.push(t("Anyone you send a document to is a signer."));
    return out;
  } else if (short === "free") {
    out.push(t("Free is for one team member. An invitation that has not been accepted yet counts as that team member."));
  }
  out.push(t("Anyone you send a document to is a signer. Signers never cost anything."));
  out.push(t("Documents you send to your own team count toward your monthly documents like any other."));
  return out;
}
