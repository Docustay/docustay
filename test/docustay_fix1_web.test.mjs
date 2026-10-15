// Fix pass 1 — the browser side that has no component harness: assertions on the source of the fixed lines, each tied to a defect. The real proof is the click-through retest (FIX-PASS-1.md phase C);
// these stop a later edit from quietly putting the old behaviour back.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const web = (p) => readFileSync(new URL(`../docustay/web/src/${p}`, import.meta.url), "utf8");
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("D-002: the signature pad only offers Type when typed signatures are allowed", () => {
  const s = web("lib/SignaturePad.svelte");
  assert.match(s, /\{#if allowTyped\}[^\n]*onclick=\{\(\) => \(tab = "type"\)\}/);
  assert.match(s, /if \(!allowTyped && tab !== "draw"\) tab = "draw"/);
});
test("D-014: the sidebar workspace name is the organisation, never the email From name", () => {
  const s = web("routes/(app)/+layout.svelte");
  assert.doesNotMatch(s, /email\.from_name/);
  assert.match(s, /if \(st\.json\?\.organisation\) wsName = st\.json\.organisation/);   // D-014: the organisation, never the From name. Run 7 (P10-A-12): no placeholder words while it loads (a skeleton instead), so the name never flips
  assert.doesNotMatch(s, /t\("Your workspace"\)/);
});
test("D-024: a table with rows that carry no id falls back to the row position, and every activity entry has an id", () => {
  assert.match(web("lib/ui/DataTable.svelte"), /rowKey = \(r, i\) => r\.id \?\? i/);
  const route = src("routes/developerActivity.mjs");
  assert.equal((route.match(/id: `/g) ?? []).length, 3, "call, asked and decided entries each get a unique id");
});
test("D-021 / D-022: the webhook notice shows a short plain reply, the empty list mentions the last test, and rotating clears the old test result", () => {
  const s = web("lib/DeveloperPanel.svelte");
  // run the real function from the screen's source on real inputs (a plain reply is kept, a whole web page with its styles is dropped)
  const src0 = s.match(/const brief = \(x\) => \{.*\};/)?.[0];
  assert.ok(src0, "brief() is in the panel source");
  const brief = new Function(`${src0}; return brief;`)();
  assert.equal(brief("Method not allowed"), "Method not allowed");
  assert.equal(brief(null), "");
  const page = "<!doctype html><html><head><title>Example Domain</title><style>body{background:#eee;width:60vw}</style></head><body><h1>Example Domain</h1><p>This domain is for use in illustrative examples.</p></body></html>";
  assert.equal(brief(page), "", "a receiver's whole web page is not shown next to the status");
  assert.equal(brief("Example Domain body{background:#eee;width:60vw;margin:15vh auto;}"), "", "tag-stripped styles are not shown either");
  assert.doesNotMatch(s, /responseExcerpt\.slice\(0, 120\)/);
  assert.match(s, /Test sends are not counted and are not listed here/);
  assert.match(s, /tested = \{ \.\.\.tested, \[e\.id\]: undefined \}/);
});
test("D-020: the API log panel says which calls cannot be listed", () => {
  assert.match(web("lib/ApiLogPanel.svelte"), /Calls made with a wrong, revoked or expired key are not listed/);
});
test("D-048 (Launch step 7): a self-hosted install has no plan, so its Billing row becomes Payments (only the money collected through documents), and the Plan screen still says why when opened anyway", () => {
  const layout = web("routes/(app)/+layout.svelte");
  assert.match(layout, /edition\.selfHost \? t\("Payments"\) : t\("Billing"\), "\/billing"/);
  assert.match(layout, /loadEdition\(\)/);
  assert.match(web("routes/(app)/billing/+page.svelte"), /const tab = \$derived\(edition\.selfHost \? "payments" : want\)/);
  assert.match(web("lib/screens/BillingPlan.svelte"), /nothing to bill/);
});
test("D-055: the signed copy still reaches the sender when nobody on the document has an address (everyone signed on this device)", () => {
  assert.match(src("documents/pdfArchive.mjs"), /copyEnabled = true;/);
  assert.match(src("documents/pdfArchive.mjs"), /signatures, recipients, copyEnabled, leadId/);
  assert.match(src("queue/tasks.mjs"), /if \(sendTo\.length \|\| result\.copyEnabled\)/);
});
test("D-096 / D-097: a rejected template shows Rejected with its reason and no Use; the reason is asked in the app's own dialog, never window.prompt", () => {
  const page = web("routes/(app)/templates/+page.svelte");
  assert.match(page, /tp\.approval_status === "rejected"/);
  assert.match(page, /data-testid="tpl-rejected"/);
  assert.doesNotMatch(page, /[^a-zA-Z.]prompt\(/);
  assert.match(page, /await askText\(/);
  assert.match(src("documents/pdfTemplates.mjs"), /t\.approval_status, t\.approval_note,/);
  assert.doesNotMatch(web("lib/screens/Skills.svelte"), /[^a-zA-Z.]prompt\(/);
  const host = web("lib/ui/ConfirmHost.svelte");
  assert.match(host, /data-testid="confirm-input"/);
});
import { builtinBriefs } from "../src/documents/plays/builtin.mjs";
test("D-063 (Run 9 Part 4R: form plays became built-in Form templates): every built-in form starter is a named, openable form template, and the form flow takes the starter by its slug", async () => {
  const { FORM_STARTERS } = await import("../src/documents/starters/index.mjs");
  assert.ok(FORM_STARTERS.length >= 3, "positive control: there are built-in form templates");
  for (const f of FORM_STARTERS) assert.ok(f.slug && f.title, `a form starter has no slug or title: ${JSON.stringify(Object.keys(f))}`);
  assert.equal(builtinBriefs().filter((p) => p.kind === "form").length, 0, "the plays list no longer carries form plays (they are templates now)");
  assert.match(web("routes/(app)/create/flow/+page.svelte"), /q\.get\("mode"\) === "form"/);
});
test("D-023 / D-025 / D-027: hosted Developers → Usage report shows the keys' own usage, Platform → Data holds the export, the self-host report appears only on self-host, and Platform has no duplicate Billing tab", () => {
  const dev = web("routes/(app)/settings/+page.svelte"), plat = dev;   // Launch step 7: Developers and Workspace are areas of Settings
  assert.match(dev, /tab === "usage"\}<LazyPanel load=\{\(\) => import\("\$lib\/ApiUsagePanel\.svelte"\)\} \/>\{#if edition\.selfHost\}/);   // R10-60: the panel loads when its tab is shown
  assert.match(plat, /tab === "data"\}<LazyPanel load=\{\(\) => import\("\$lib\/DataPanel\.svelte"\)\} \/>/);
  assert.doesNotMatch(plat, /tab === "billing"/);
  assert.doesNotMatch(plat, /\["billing", t\("Billing"\)/);
  assert.match(web("lib/DataPanel.svelte"), /\/api\/documents\/pdf\/export\.zip/);
  assert.match(web("lib/DataPanel.svelte"), /\{#if edition\.selfHost\}/);
  const ed = web("lib/edition.svelte.js");
  assert.match(ed, /api\("\/api\/documents\/settings"\)/);   // the settings answer carries selfHost
  assert.doesNotMatch(ed, /api\("\/api\/setup\/state"\)/);   // the hosted service has no such route: asking logged a 404 on every page
});
test("D-052 / D-088: a limit sentence only when there is a limit; the Documents lead line only on the Documents tab", () => {
  assert.match(web("lib/EmailPanel.svelte"), /st\.limit\.limit \? t\("\{sent\} of \{limit\} emails sent today\./);
  assert.match(web("lib/SettingsForm.svelte"), /data\.intro && !bare && intro/);
  assert.match(web("routes/(app)/settings/+page.svelte"), /<SettingsForm intro only=\{\["sending"/);
});
test("D-001 / D-079 / D-087: a refused setting is redrawn from the saved value, a plan-locked switch is disabled with its reason, a rejected chip is dropped", () => {
  const f = web("lib/SettingsForm.svelte");
  assert.match(f, /if \(!r\.ok\) redraw\(f\.key\)/);
  assert.match(f, /disabled=\{f\.lockedByPlan === true && f\.value !== true\}/);
  assert.match(f, /Up to three days, each a whole number from 1 to 60\./);
  assert.match(src("documents/settings.mjs"), /lockedByPlan/);
});
test("D-049 / D-066: the upload hint quotes the real biggest upload from the server, never a plan table", () => {
  const page = web("routes/(app)/create/+page.svelte");
  assert.doesNotMatch(page, /up to 25 MB on Free/);
  assert.match(page, /r\.json\?\.uploadMaxMb/);
  assert.match(src("documents/settings.mjs"), /uploadMaxMb = await uploadCapMb/);
});
import { readdirSync } from "node:fs";
test("D-008 / D-045: the last signer is told the document is complete (not that 'everyone will get' a copy later), in all 14 languages", () => {
  const dir = new URL("../src/documents/lang/", import.meta.url);
  const langs = readdirSync(dir).filter((f) => /^[a-z]{2}\.mjs$/.test(f));
  assert.ok(langs.length >= 14);
  for (const f of langs) assert.match(readFileSync(new URL(f, dir), "utf8"), /"signedLastBody": "[^"]{10,}"/, `${f} lacks signedLastBody`);
  const page = web("routes/sign/pdf/+page.svelte");
  assert.match(page, /lastOne \? T\.signedLastBody : T\.signedBody/);
  assert.match(page, /const out = res\?\.data \?\? res;[^\n]*\n[^\n]*\n\s*lastOne = out\?\.completed === true/);
});
test("D-077 / D-078: the decline notice names who declined and why, an owner is not greeted by the organisation's name, and the Expired sample does not say 'declined'", () => {
  const tasks = src("queue/tasks.mjs");
  assert.match(tasks, /declined “\$\{shownTitle\}”/);   // names the document in quotes (11 Oct 2026: the Health data switch is gone, so it always names it)
  assert.match(tasks, /target\.display_name !== target\.practice_name \? target\.display_name : "there"/);
  assert.match(src("documents/emailPreview.mjs"), /kind === "expired"\) vars\.summary = "Services agreement \(sent to Alex Sample\)"/);
});
import { CSV_STATUS } from "../src/documents/reports.mjs";
test("D-034 / D-075 / D-091: the CSV and the timeline use the screens' words (Completed, In progress, Cancelled), and a cancelled document's people are Cancelled", () => {
  assert.equal(CSV_STATUS.executed, "Completed"); assert.equal(CSV_STATUS.partially_signed, "In progress"); assert.equal(CSV_STATUS.void, "Cancelled");
  const send = src("documents/pdfSend.mjs");
  assert.match(send, /voided: "Cancelled"/); assert.match(send, /embed_session: "Opened signing inside another website"/);
  assert.match(send, /status === "voided" && !isFinished\(p\) \? "cancelled" : p\.status/);
  assert.match(web("routes/(app)/documents/[id]/+page.svelte"), /so there is no signed copy/);
});
test("D-100: the embedding snippets use the workspace's own address, not a fixed website", () => {
  const s = web("lib/EmbedPanel.svelte");
  assert.doesNotMatch(s, /https:\/\/docustay\.app\/(api|embed)/);
  assert.match(s, /\$\{base\}\/api\/v1\/documents\/DOCUMENT_ID\/embed-session/);
  assert.match(s, /src="\$\{base\}\/embed\/index\.js"/);
});
test("D-016: a chat turn in the AI log is worded by what it did, never as 'wrote a draft'", () => {
  const s = web("lib/ai/AiLogPanel.svelte");
  assert.match(s, /a\.action === "proposed" && a\.kind === "chat"/);
  assert.match(s, /answered a question/);
});
test("D-017 / D-084: the Describe panel names every missing answer, and says up front when writing a new document is switched off", () => {
  const s = web("lib/ai/DescribePanel.svelte");
  assert.match(s, /Still needed: \{list\}/);
  assert.match(s, /status\.allowDraft === false/);
});
