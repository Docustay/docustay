// D-103 (found on the localhost stack, 9 Oct 2026): a teammate invited to a Docustay workspace got a link to <slug>.example.com/invite and the Docustay app had no /invite page, so nobody could accept. Now the link is the Docustay app's own and the page exists.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the invite email builds a Docustay link for a Docustay workspace", () => {
  const s = read("src/routes/writes.mjs");
  assert.match(s, /prod\[0\]\?\.product === "docustay"/);
  assert.match(s, /KEYSTONE_DOCUSTAY_APP_URL \?\? process\.env\.KEYSTONE_PUBLIC_URL/);
  assert.match(s, /\}\/invite\?token=\$\{encodeURIComponent\(presented\)\}/);
});
test("the Docustay app has an /invite page that previews, then accepts, and a dead link says so", () => {
  const page = read("docustay/web/src/routes/(auth)/invite/+page.svelte");
  assert.match(page, /previewInviteToken\(token\)/);
  assert.match(page, /acceptInviteWithPassword\(\{ token, email: info\.email, password \}\)/);
  assert.match(page, /data-testid="invite-gone"/);
  const auth = read("docustay/web/src/lib/auth.js");
  assert.match(auth, /\/api\/auth\/invite\/accept/);
  assert.match(auth, /\/api\/auth\/invite\/\$\{encodeURIComponent\(token\)\}/);
});
test("D-105: the Member choice sends the rank the server accepts (it sent 'coach' and every Member invitation was refused), and a new invitation defaults to the lower rank", () => {
  const s = read("docustay/web/src/lib/TeamPanel.svelte");
  assert.match(s, /<option value="member">/);
  assert.doesNotMatch(s, /value="coach"/);
  assert.match(s, /rank = \$state\("member"\)/);
  assert.match(s, /<option value="admin">/);   // positive control: the other rank is still offered
});
test("D-106: a rank refusal is shown as a sentence, not as 'section refused: requires_admin'", () => {
  const s = read("docustay/web/src/lib/api.js");
  assert.match(s, /RANK_REFUSAL = \/\^\(section \)\?refused: requires\//);
  assert.match(s, /You do not have permission to do that\. Ask an owner or an admin\./);
  assert.ok(/^(section )?refused: requires/.test("section refused: requires_admin") && /^(section )?refused: requires/.test("refused: requires edit on setting") && !/^(section )?refused: requires/.test("Pro is required"));
});
