#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { Docustay, verifyWebhook } from "../../js/src/index.js";
import { parseArgs, list, parseParty } from "../src/args.mjs";
import { readConfig, writeConfig, isTestKey, mask, configPath, DEFAULT_URL } from "../src/config.mjs";
import { listen } from "../src/listen.mjs";

// a plan limit, in plain words: what is used, when it opens again, and where Pro is (the API's 403 with detail.code)
const planLimit = (e) => {
  if (e?.code !== "plan_template_limit" && e?.code !== "plan_document_limit") return null;
  const d = e.detail ?? {}, when = d.resetsAt ? new Date(d.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "the first of next month";
  const what = e.code === "plan_template_limit" ? "new templates" : "documents";
  return `your plan's ${what} for this month are used (${d.used ?? "?"} of ${d.limit ?? "?"}). Everything you have still works. More open on ${when}, or see Pro: https://docustay.app/pricing#pro`;
};
const VERSION = "0.1.2";
const HELP = `docustay ${VERSION} — the Docustay command line

  docustay login [--key dsk_…] [--url https://…]     save your API key (kept in ${configPath()}, readable only by you)
  docustay whoami                                    check the saved key
  docustay detect <file.pdf> [--json]                find the fields on a PDF (nothing is stored)
  docustay ai usage                                  AI credits used, left, and when they reset
  docustay forms [list | templates | show <id> | responses <id>] [--json]
                                                     your forms (one link many people fill in), the form templates, and their responses
  docustay search <words> [--per 6] [--json]          documents, templates, forms and people, best first
  docustay contracts [list [--q …] | date <id> --kind start|end|notice|renewal --date YYYY-MM-DD | --clear] [--json]
                                                     signed contracts and their key dates; correct one by hand (the signed PDF never changes)
  docustay payments [list | refund <id> --reason "…" [--amount-minor 500] --yes] [--json]
                                                     payments taken while signing; a refund goes through Stripe (leave out the amount for the rest)
  docustay templates [library [--kind document|form] | customize <slug> [--name "…"]] [--json]
                                                     the built-in templates; customize one into your own copy (a new template)
  docustay playbooks [list | on <name> | off <name>] [--json]   packs of templates and skills; switch one on or off
  docustay automations [list | on <id> | off <id>] [--json]     what runs on its own when a document is signed (switching one on needs Pro)
  docustay documents [list [--state sent|completed|voided|declined] [--limit 20] | show <id> | remind <id> [--seat signer_1] | void <id> --reason "…" --yes] [--json]
                                                     your documents: the list, one document's people and events, a reminder, or cancel one that is out for signature
  docustay webhooks [list | create --url https://… [--events a,b] [--name "…"] | test <id> [--topic …] | rotate <id> | delete <id> --yes | deliveries <id>] [--json]
                                                     where Docustay posts events; the signing secret is shown once, at creation or rotation
  docustay send --test <templateId> --party seat="Name <email>" [--party …] [--title "…"]
                                                     send a TEST document from a template (nothing is billed; add --live to use a live key)
  docustay listen [--forward-to http://localhost:3000/webhooks] [--events documents.document.executed,…]
                                                     forward Docustay webhooks to your own computer
  docustay trigger [--topic documents.document.executed]   send a test event to the listen webhook
  docustay verify --secret whsec_… --id … --timestamp … --signature "v1,…" [--body file | -]
                                                     check a webhook's signature the way your server should
  docustay logs [--emails] [--webhook <id>] [--json] recent email log, or a webhook's recent deliveries
  docustay help

  Settings: DOCUSTAY_API_KEY and DOCUSTAY_URL override the saved ones.`;

const out = (s = "") => process.stdout.write(s + "\n");
const err = (s) => process.stderr.write(s + "\n");
const fail = (s, code = 1) => { err(`✘ ${s}`); process.exit(code); };
const ask = (q, hidden = false) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) { rl._writeToOutput = (t) => { if (t.includes(q)) rl.output.write(t); }; }
  rl.question(q, (a) => { rl.close(); if (hidden) out(); res(a.trim()); });
});
const client = () => { const c = readConfig(); if (!c.apiKey) fail("no API key. Run  docustay login  (or set DOCUSTAY_API_KEY)."); return { docustay: new Docustay(c.apiKey, { baseUrl: c.baseUrl }), config: c }; };
const show = (flags, data, human) => (flags.json ? out(JSON.stringify(data, null, 2)) : human());

const COMMANDS = {
  async login({ flags }) {
    const key = flags.key || process.env.DOCUSTAY_API_KEY || (process.stdin.isTTY ? await ask("API key (from Settings → Developers): ", true) : fail("give --key, or run this in a terminal"));
    const baseUrl = String(flags.url || readConfig().baseUrl || DEFAULT_URL).replace(/\/+$/, "");
    if (!/^(?:gl|dsk)_(?:test|live)_/.test(key)) fail("that does not look like a Docustay API key (it starts dsk_test_ or dsk_live_)");
    const d = new Docustay(key, { baseUrl });
    try { await d.listTemplates(); } catch (e) { fail(`the key was not accepted by ${baseUrl}: ${e.message}`); }
    writeConfig({ apiKey: key, baseUrl });
    out(`✔ signed in to ${baseUrl} with ${mask(key)} (${isTestKey(key) ? "test mode" : "LIVE mode"})`);
  },
  async detect({ flags, positional }) {
    const file = positional[0] || fail("give the file:  docustay detect form.pdf");
    const { docustay } = client();
    let bytes; try { bytes = fs.readFileSync(file); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
    const r = await docustay.detectFields({ file: bytes, fileName: file.split("/").pop(), ...(flags.min ? { minConfidence: Number(flags.min) } : {}) });
    show(flags, r, () => {
      out(`Found ${r.summary.fields} field${r.summary.fields === 1 ? "" : "s"} for ${r.summary.signers} signer${r.summary.signers === 1 ? "" : "s"}${r.summary.uncertain ? `; ${r.summary.uncertain} not sure about` : ""}.`);
      for (const f of r.fields) out(`  p${f.page}  ${f.type.padEnd(11)} ${f.role ?? ""}  ${(f.confidence * 100).toFixed(0)}%  ${f.label ?? ""}${f.uncertain ? "  (not sure)" : ""}`);
      for (const n of r.notes) out(`note: ${n}`);
    });
  },
  async ai({ flags, positional }) {
    if (positional[0] !== "usage") fail("did you mean:  docustay ai usage");
    const { docustay } = client();
    const u = await docustay.aiUsage();
    show(flags, u, () => out(u.mode === "hosted" ? `AI credits: ${u.used} of ${u.allowance} used (${u.percent}%), ${u.remaining} left${u.resetsAt ? `, resets ${u.resetsAt.slice(0, 10)}` : ""}${u.paused ? " — AI is paused" : ""}` : u.mode === "own_key" ? "AI runs on your own provider key: nothing is metered here." : "AI is not metered on this install."));
  },
  async forms({ flags, positional }) {
    const [what = "list", id] = positional; const { docustay } = client();
    if (what === "list") { const r = await docustay.listForms(); return show(flags, r, () => { if (!r.forms.length) out("No forms yet. Make one under Templates → Form templates."); for (const f of r.forms) out(`${f.id}  ${(f.closed ? "closed" : f.open ? "open" : f.slug ? "off" : "not published").padEnd(13)} ${String(f.responses).padStart(5)} responses  ${f.name}${f.slug ? `  /f/…/${f.slug}` : ""}`); }); }
    if (what === "templates") { const r = await docustay.listFormTemplates(); return show(flags, r, () => { for (const t of r.templates) out(`${t.slug.padEnd(34)} ${t.title}${t.counterSign ? "  (counter-signed)" : ""}`); }); }
    if (!["show", "responses"].includes(what)) fail(`"forms ${what}" is not a forms command. Try:  docustay forms list | templates | show <id> | responses <id>`);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(`give the form id:  docustay forms ${what} <id>`);
    if (what === "show") { const f = await docustay.getForm(id); return show(flags, f, () => out(`${f.name}\n${f.link ? `link: ${f.link}` : f.slug ? `link name: ${f.slug}` : "not published"}\n${f.open ? "open" : "closed"} · ${f.responses} responses${f.closed ? ` · closed (${f.closed})` : ""}`)); }
    if (what === "responses") { const r = await docustay.listFormResponses(id, { limit: flags.limit ? Number(flags.limit) : undefined }); return show(flags, r, () => { if (!r.responses.length) out("No responses yet."); for (const x of r.responses) out(`${x.id}  ${String(x.state).padEnd(16)} ${x.name ?? ""} <${x.email ?? ""}>`); }); }
    fail("did you mean:  docustay forms list | templates | show <id> | responses <id>");
  },
  async search({ flags, positional }) {
    const q = positional.join(" ").trim(); if (!q) fail("give some words to look for:  docustay search <words>");
    const { docustay } = client();
    const r = await docustay.search(q, { per: flags.per ? Number(flags.per) : undefined });
    show(flags, r, () => {
      const g = r.groups ?? {}; const n = (g.documents?.length ?? 0) + (g.templates?.length ?? 0) + (g.people?.length ?? 0);
      if (!n) return out(`Nothing found for "${q}".`);
      for (const d of g.documents ?? []) out(`document  ${d.id}  ${String(d.state).padEnd(10)} ${d.title}`);
      for (const t of g.templates ?? []) out(`${t.kind.padEnd(8)}  ${t.id}  ${t.title}`);
      for (const p of g.people ?? []) out(`person    ${p.id}  ${p.name}${p.email && p.email !== p.name ? ` <${p.email}>` : ""}`);
    });
  },
  async contracts({ flags, positional }) {
    const [what = "list", id] = positional; const { docustay } = client();
    if (what === "list") {
      const r = await docustay.listContracts({ q: flags.q && flags.q !== true ? flags.q : undefined, limit: flags.limit ? Number(flags.limit) : undefined });
      return show(flags, r, () => {
        if (!r.contracts.length) return out("No signed contracts yet.");
        for (const c of r.contracts) { const d = c.dates ?? {}; const when = ["end", "renewal", "notice"].map((k) => (d[k]?.date ? `${k} ${d[k].date}` : null)).filter(Boolean).join(" · ");
          out(`${c.id}  ${(c.executedAt ?? "").slice(0, 10)}  ${c.title}${when ? `  (${when})` : ""}`); }
        out(`${r.summary.signed} signed · ${r.summary.renewingIn30Days} renewing or ending in the next 30 days`);
      });
    }
    if (what !== "date") fail(`"contracts ${what}" is not a contracts command. Try:  docustay contracts list | date <id> --kind end --date YYYY-MM-DD`);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail("give the contract id:  docustay contracts date <id> --kind end --date YYYY-MM-DD");
    if (!["start", "end", "notice", "renewal"].includes(flags.kind)) fail("say which date with --kind start | end | notice | renewal");
    const clear = flags.clear === true; const date = flags.date && flags.date !== true ? flags.date : null;
    if (!clear && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) fail("give the date as --date YYYY-MM-DD (or --clear to remove it)");
    const r = await docustay.setContractDate(id, { kind: flags.kind, date: clear ? null : date });
    show(flags, r, () => out(clear ? `✔ the ${flags.kind} date is cleared` : `✔ the ${flags.kind} date is now ${date} (kept as your correction)`));
  },
  async payments({ flags, positional }) {
    const [what = "list", id] = positional; const { docustay, config } = client();
    if (what === "list") {
      const r = await docustay.listPayments({ before: flags.before && flags.before !== true ? flags.before : undefined, limit: flags.limit ? Number(flags.limit) : undefined });
      return show(flags, r, () => {
        if (!r.items.length) out("No payments yet.");
        for (const x of r.items) out(`${x.id}  ${(x.paidAt ?? x.createdAt ?? "").slice(0, 10)}  ${String(x.status).padEnd(18)} ${String(x.label).padStart(10)}  ${x.person}  — ${x.title}${x.refundedLabel ? `  (refunded ${x.refundedLabel})` : ""}`);
        out(`this month: ${r.month.collected} collected · ${r.month.refunded} refunded${r.next ? `\nmore:  docustay payments list --before ${r.next}` : ""}`);
      });
    }
    if (what !== "refund") fail(`"payments ${what}" is not a payments command. Try:  docustay payments list | refund <id> --reason "…" --yes`);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail('give the payment id:  docustay payments refund <id> --reason "…" --yes');
    const reason = flags.reason && flags.reason !== true ? String(flags.reason).trim() : ""; if (!reason) fail('say why with --reason "…" (the payer sees it on their receipt)');
    let amountMinor; if (flags["amount-minor"] !== undefined) { amountMinor = Number(flags["amount-minor"]); if (!Number.isInteger(amountMinor) || amountMinor < 1) fail("--amount-minor is a whole number in the currency's smallest unit (500 is 5.00)"); }
    // a refund moves money: it is never sent without a plain yes (--yes, or typed at the prompt)
    if (flags.yes !== true) {
      if (!process.stdin.isTTY) fail("a refund moves money: add --yes to confirm it.");
      const a = await ask(`Refund ${amountMinor ? `${amountMinor} (smallest unit)` : "the rest of this payment"}${isTestKey(config.apiKey) ? " in test mode" : " — LIVE money"}? Type yes: `);
      if (a.toLowerCase() !== "yes") fail("not refunded.");
    }
    const r = await docustay.refundPayment(id, { amountMinor, reason });
    show(flags, r, () => out(`✔ refunded through Stripe — ${r.refundedLabel} refunded on this payment in all (${r.status.replace("_", " ")})`));
  },
  // Run 9 Part 4R: what runs on its own is an AUTOMATION; a playbook is a pack of templates and skills; the built-in templates are the library
  async automations({ flags, positional }) {
    const [what = "list", id] = positional; const { docustay } = client();
    if (what === "list") { const r = await docustay.listAutomations(); const list = Array.isArray(r) ? r : (r?.automations ?? []); return show(flags, r, () => { if (!list.length) out("No automations yet. Build one under Automations."); for (const p of list) out(`${p.id}  ${(p.enabled ? "on" : "off").padEnd(4)} ran ${p.runCount ?? 0}×  ${p.name ?? p.title}`); }); }
    if (!["on", "off"].includes(what)) fail(`"automations ${what}" is not an automations command. Try:  docustay automations list | on <id> | off <id>`);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(`give the automation id:  docustay automations ${what} <id>`);
    const r = await docustay.setAutomationOn(id, what === "on");
    show(flags, r, () => out(`✔ ${r.automation?.name ?? "the automation"} is ${r.automation?.enabled ? "on" : "off"}`));
  },
  async documents({ flags, positional }) {
    const [what = "list", id] = positional; const { docustay } = client();
    if (what === "list") { const r = await docustay.listDocuments({ ...(flags.state && flags.state !== true ? { state: flags.state } : {}), limit: Number(flags.limit) || 20 }); return show(flags, r, () => { if (!r.documents.length) out("No documents."); for (const d of r.documents) out(`${d.id}  ${String(d.state).padEnd(10)} ${d.test ? "[test] " : ""}${d.title}  (${Array.isArray(d.parties) ? d.parties.map((x) => x.name || x.email).join(", ") : `${d.parties ?? 0} ${d.parties === 1 ? "person" : "people"}`})`); }); }
    if (!id) fail(`give the document's id:  docustay documents ${what} <id>`);
    if (what === "show") { const d = await docustay.getDocument(id); return show(flags, d, () => { out(`${d.title}  —  ${d.state}${d.test ? " (test)" : ""}`); for (const x of d.parties ?? []) out(`  ${x.seat}  ${x.name || ""} <${x.email}>  ${x.status}${x.declineReason ? `  declined: ${x.declineReason}` : ""}`); for (const e of d.events ?? []) out(`  ${e.at}  ${e.text ?? e.kind}`); }); }
    if (what === "remind") { const r = await docustay.remind(id, { seat: flags.seat && flags.seat !== true ? flags.seat : undefined }); return show(flags, r, () => out(`✔ reminder sent for ${id}`)); }
    if (what === "void") { if (!flags.reason || flags.reason === true) fail('say why:  docustay documents void <id> --reason "…" --yes'); if (!flags.yes) fail("cancelling a document cannot be undone: add --yes to confirm"); const r = await docustay.voidDocument(id, flags.reason); return show(flags, r, () => out(`✔ ${id} is cancelled; the people on it were told`)); }
    fail(`"documents ${what}" is not a documents command. Try:  docustay documents list | show <id> | remind <id> | void <id> --reason "…" --yes`);
  },
  async webhooks({ flags, positional }) {
    const [what = "list", id] = positional; const { docustay } = client();
    if (what === "list") { const r = await docustay.listWebhooks(); return show(flags, r, () => { if (!r.webhooks.length) out("No webhooks."); for (const w of r.webhooks) out(`${w.id}  ${String(w.status).padEnd(9)} ${w.name || w.url || "(relay)"}  [${(w.eventTypes ?? []).join(", ") || "all events"}]`); }); }
    if (what === "create") { if (!flags.url || flags.url === true) fail("give the address that should receive events:  docustay webhooks create --url https://example.com/hooks"); const r = await docustay.createWebhook({ url: flags.url, ...(flags.name && flags.name !== true ? { name: flags.name } : {}), ...(flags.events && flags.events !== true ? { eventTypes: String(flags.events).split(",").map((x) => x.trim()).filter(Boolean) } : {}) }); return show(flags, r, () => { out(`✔ webhook ${r.id ?? r.webhook?.id} created`); if (r.secret) out(`  signing secret (shown once): ${r.secret}`); }); }
    if (!id) fail(`give the webhook's id:  docustay webhooks ${what} <id>`);
    if (what === "test") { const r = await docustay.testWebhook(id, flags.topic && flags.topic !== true ? flags.topic : undefined); return show(flags, r, () => out(`✔ test event sent to ${id}`)); }
    if (what === "rotate") { const r = await docustay.rotateWebhookSecret(id); return show(flags, r, () => { out(`✔ secret rotated for ${id}`); if (r.secret) out(`  new signing secret (shown once): ${r.secret}`); }); }
    if (what === "delete") { if (!flags.yes) fail("deleting a webhook stops its events at once: add --yes to confirm"); await docustay.deleteWebhook(id); return show(flags, { deleted: id }, () => out(`✔ ${id} deleted`)); }
    if (what === "deliveries") { const r = await docustay.listWebhookDeliveries(id); return show(flags, r, () => r.deliveries.length ? r.deliveries.forEach((d) => out(`${d.attemptedAt}  ${d.event}  attempt ${d.attempt}  ${d.status}`)) : out("no deliveries yet")); }
    fail(`"webhooks ${what}" is not a webhooks command. Try:  docustay webhooks list | create --url … | test <id> | rotate <id> | delete <id> --yes | deliveries <id>`);
  },
  async playbooks({ flags, positional }) {
    const [what = "list", name] = positional; const { docustay } = client();
    if (what === "list") { const r = await docustay.listPlaybooks(); return show(flags, r, () => { if (!r.playbooks.length) out("No playbooks."); for (const p of r.playbooks) out(`${p.name.padEnd(24)} ${(p.enabled ? "on" : "off").padEnd(4)} ${p.templates.length} templates, ${p.plays.length} skills  ${p.title}${p.builtin ? "" : "  (yours)"}`); }); }
    if (!["on", "off"].includes(what)) fail(`"playbooks ${what}" is not a playbooks command. Try:  docustay playbooks list | on <name> | off <name>`);
    if (!name) fail(`give the playbook's name:  docustay playbooks ${what} <name>`);
    const r = await docustay.setPlaybookOn(name, what === "on");
    show(flags, r, () => out(`✔ ${r.name} is ${r.enabled ? "on" : "off"}`));
  },
  async templates({ flags, positional }) {
    const [what = "library", slug] = positional; const { docustay } = client();
    if (what === "library") { const kind = ["document", "form"].includes(flags.kind) ? flags.kind : undefined; const r = await docustay.listLibraryTemplates({ kind }); return show(flags, r, () => { if (!r.shown) out("This workspace has hidden the built-in templates (Settings → Templates)."); for (const t of r.templates) out(`${t.kind.padEnd(8)} ${t.slug.padEnd(34)} ${t.title}`); }); }
    if (what === "customize") { if (!slug) fail("give the built-in's slug:  docustay templates customize <slug>"); const r = await docustay.customizeLibraryTemplate(slug, { name: flags.name }); return show(flags, r, () => out(`✔ your own copy of ${slug}: template ${r.templateId}`)); }
    fail(`"templates ${what}" is not a templates command. Try:  docustay templates library [--kind document|form] | customize <slug> [--name "…"]`);
  },
  // whoami also says where the plan's monthly numbers stand (documents and, on Free, new templates)
  async whoami({ flags }) {
    const { docustay, config } = client();
    const u = await docustay.usage();
    show(flags, { baseUrl: config.baseUrl, key: mask(config.apiKey), mode: isTestKey(config.apiKey) ? "test" : "live", usage: u }, () => out(`${config.baseUrl}\nkey ${mask(config.apiKey)} (${isTestKey(config.apiKey) ? "test mode" : "LIVE mode"})\nplan ${u.plan ?? "?"}${u.documents ? `\ndocuments this month ${u.documents.used}${u.documents.limit == null ? "" : ` of ${u.documents.limit}`}` : ""}${u.templates ? `\nnew templates this month ${u.templates.used}${u.templates.limit == null ? " (no limit)" : ` of ${u.templates.limit}`}` : ""}`));
  },
  async send({ flags, positional }) {
    const { docustay, config } = client();
    const templateId = flags.test && flags.test !== true ? flags.test : positional[0] || fail("give the template id:  docustay send --test <templateId> --party …");
    if (!isTestKey(config.apiKey) && !flags.live) fail("this is a LIVE key. Use a test key (dsk_test_…), or add --live to really send.");
    if (flags.test && !isTestKey(config.apiKey)) fail("--test needs a test key (dsk_test_…): this one is live.");
    const parties = list(flags.party).map(parseParty); if (!parties.length) fail("add at least one --party seat=\"Name <email>\"");
    const r = await docustay.sendDocument({ templateId, parties, ...(flags.title ? { title: flags.title } : {}) });
    show(flags, r, () => out(`✔ ${r.state} — document ${r.id}${isTestKey(config.apiKey) ? " (test)" : ""}, ${r.emailed} email${r.emailed === 1 ? "" : "s"} sent`));
  },
  async listen({ flags }) {
    const { docustay, config } = client();
    const target = flags["no-forward"] ? null : (flags["forward-to"] || "http://localhost:3000/webhooks");
    if (target && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)|^https?:\/\//.test(target)) fail("--forward-to must be a web address such as http://localhost:3000/webhooks");
    const events = flags.events && flags.events !== true ? String(flags.events).split(",").map((s) => s.trim()).filter(Boolean) : ["documents.document.executed", "documents.document.sent", "documents.document.declined"];
    let id = config.relayWebhookId, secret = null;
    if (id) { const have = (await docustay.listWebhooks()).webhooks.find((w) => w.id === id && w.status === "active" && w.relay); if (!have) id = null; }
    if (!id) {
      const made = await docustay.createWebhook({ relay: true, name: "docustay listen", eventTypes: events });
      id = made.id; secret = made.secret; writeConfig({ relayWebhookId: id });
    }
    out(`✔ listening (webhook ${id})${target ? `, forwarding to ${target}` : ""}`);
    if (secret) out(`  Signing secret (shown once — your local code verifies with it):  ${secret}`);
    else out("  Reusing the webhook from before; its secret was shown the first time. Rotate it with  docustay trigger --rotate  if you lost it.");
    out("  Press Ctrl-C to stop.\n");
    const stop = new AbortController(); process.on("SIGINT", () => { stop.abort(); out("\nstopped"); process.exit(0); });
    await listen({ docustay, webhookId: id, target, signal: stop.signal,
      onEvent: (ev, r) => out(`${new Date(ev.at).toLocaleTimeString()}  ${ev.topic ?? "event"}  ${r ? (r.status ? `→ ${r.status} (${r.ms} ms)` : `→ could not reach ${target} (${r.error})`) : "(not forwarded)"}`),
      onError: (e) => err(`… ${e.message} — retrying`) });
  },
  async trigger({ flags }) {
    const { docustay, config } = client();
    if (!config.relayWebhookId) fail("run  docustay listen  first, so there is a webhook to send to");
    if (flags.rotate) { const r = await docustay.rotateWebhookSecret(config.relayWebhookId); return out(`✔ new signing secret (shown once): ${r.secret}`); }
    const r = await docustay.testWebhook(config.relayWebhookId, flags.topic && flags.topic !== true ? flags.topic : undefined);
    out(r.outcome === "delivered" ? `✔ test event ${r.topic} queued for docustay listen` : `✘ ${r.outcome}: ${r.error ?? ""}`);
  },
  async verify({ flags }) {
    const need = (n) => (flags[n] && flags[n] !== true ? String(flags[n]) : fail(`--${n} is required`));
    const body = flags.body === "-" || flags.body === true ? fs.readFileSync(0, "utf8") : flags.body ? fs.readFileSync(String(flags.body), "utf8") : fail("--body <file> (or - for standard input) is required");
    try {
      await verifyWebhook(need("secret"), { "webhook-id": need("id"), "webhook-timestamp": need("timestamp"), "webhook-signature": need("signature") }, body, { toleranceSeconds: flags.tolerance ? Number(flags.tolerance) : 300 });
      out("✔ the signature is valid");
    } catch (e) { out(`✘ not valid: ${e.message}`); process.exit(2); }
  },
  async logs({ flags }) {
    const { docustay } = client();
    if (flags.webhook && flags.webhook !== true) {
      const r = await docustay.listWebhookDeliveries(flags.webhook);
      return show(flags, r, () => r.deliveries.length ? r.deliveries.forEach((d) => out(`${d.attemptedAt}  ${d.event}  attempt ${d.attempt}  ${d.status}${d.responseStatus ? ` (${d.responseStatus})` : ""}${d.error ? `  ${d.error}` : ""}`)) : out("no deliveries yet"));
    }
    const r = await docustay.listEmails({ limit: 20 });
    show(flags, r, () => (r.emails ?? r.data ?? []).length ? (r.emails ?? r.data).forEach((e) => out(`${e.at ?? e.createdAt}  ${e.kind}  ${e.to ?? e.recipient}  ${e.status}`)) : out("no emails yet"));
  },
  help() { out(HELP); },
};

export async function main(argv) {
  const { flags, positional } = parseArgs(argv);
  if (flags.version) return out(VERSION);
  const name = positional.shift();
  if (!name || flags.help || name === "help" || !COMMANDS[name]) { out(HELP); if (name && name !== "help" && !COMMANDS[name]) process.exitCode = 1; return; }
  try { await COMMANDS[name]({ flags, positional }); }
  catch (e) { fail(e?.status === 401 ? "the API key was not accepted. Run  docustay login  again." : planLimit(e) ?? (e?.message || String(e))); }
}
// Run main when this file IS the program. npm installs the command as a symlink (.bin/docustay -> dist/docustay.mjs), so compare real paths:
// Run 10 (R10-46) the old test of argv[1] ending in "docustay.mjs" was false through the symlink and the installed CLI printed nothing at all.
const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main(process.argv.slice(2));
