// src/documents/settings.mjs — THE ISLAND'S OWN SETTINGS (QUEUE §23.2.2, the maintainer 3 Oct 2026). One file holds every Documents setting: its key, type, default, label and help text.
// Storage is `keystone.document_setting` (migration 0595), NOT the host's `tenant_setting` — a lifted-out Docustay has no host settings table.
//
// ★ Every key has a default, so nothing breaks when a practice has never opened the screen. `null` as a default means "unset" (retention: indefinite; re-sign: never).
// ★ Reads go through `getDocumentSettings(tx)` (all keys, defaults filled in) or `getDocumentSetting(tx, key)`. Writes go through `setDocumentSetting`, which validates, upserts,
//   and announces the change on the event log. Setting a key to `null` removes the row (back to the default).
// ★ This module imports nothing from the host except the event outbox (the same plumbing every island writer uses).

import { ports } from "./ports.mjs";
import { AGENT_KINDS } from "./flowDefinition.mjs";
import { identitySettings, isIdentitySettingKey, setIdentitySetting } from "../mail/index.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid } from "../http/errors.mjs";
import { uploadCapMb } from "./uploadLimit.mjs";
import { fakeAllowed } from "./engine/ai/gateway.mjs";
import { SETTING_CHOICES, MODEL_CHOICES, modelChoicesFor, settingWidget, SETTING_GROUPS, DOCUMENT_SETTINGS, SETTING_KEYS, validateDocumentSetting, settingDefaults } from "./settingsSchema.mjs";

export { SETTING_GROUPS, DOCUMENT_SETTINGS, SETTING_KEYS, validateDocumentSetting } from "./settingsSchema.mjs";



// Docustay v1 settings trim (TESTING-BLUEPRINT 5.3): 25 keys are not offered in Docustay. A read returns the default, a write is refused, the screen omits them. the platform's list is untouched (settingsSchema.mjs is shared).
// brand.hide_footer is hidden on the hosted service only (a self-hoster may hide it).
export const DOCUSTAY_CUT_KEYS = Object.freeze(new Set([
  "signed_copy.header_text", "signed_copy.page_numbers", "signed_copy.font", "signed_copy.signature_style", "signed_copy.show_signer_email", "signed_copy.show_signer_ip", "signed_copy.closing_line",
  "download.link_days", "retention_years", "resign_months", "ai.review", "ai.allow_edit", "ai.read_files", "ai.require_review", "ai.chat_retention_days",
  "upload.expiry_days", "upload.template_approval", "teams.restrict_visibility", "signing.allow_resubmit",
  "forms.verify_email", "forms.fill_again", "forms.notify_owner", "forms.confirm_respondent", "forms.copy_to", "forms.embed_sites"]));
export const DOCUSTAY_HOSTED_CUT_KEYS = Object.freeze(["ai.provider", "ai.model", "email.provider", "email.from_address", "email.smtp_host", "email.smtp_port", "email.smtp_user", "email.smtp_security"]);
const docustayOf = new WeakMap();
async function docustayCut(tx) {
  if (!docustayOf.has(tx)) docustayOf.set(tx, (async () => { try { return !!(await (await ports()).brand?.isDocustay?.(tx)); } catch { return false; } })());
  if (!(await docustayOf.get(tx))) return null;
  const cut = new Set(DOCUSTAY_CUT_KEYS);
  // the hosted service only: no footer switch (item 12) and no own sending domain, SMTP server or mailbox (item 9), and no AI provider or model picker (item 18: one model, Sonnet 5.5). A self-hoster keeps all of them. From name and Reply-to stay on both.
  if (process.env.KEYSTONE_SELF_HOST !== "1") for (const k of ["brand.hide_footer", ...DOCUSTAY_HOSTED_CUT_KEYS]) cut.add(k);
  return cut;
}

/** All settings for the caller's practice, defaults filled in. `tx` is a tenant transaction. */
export async function getDocumentSettings(tx) {
  const { rows } = await tx.query(`SELECT key, value FROM keystone.document_setting`);
  const out = settingDefaults();
  const cut = await docustayCut(tx);
  for (const r of rows) if (r.key in out && !cut?.has(r.key)) out[r.key] = r.value;
  // ★ the email.* values live in the mail module (one sending identity per organisation), not in this island's table
  Object.assign(out, await identitySettings(tx));
  if (cut) for (const k of cut) if (k in out) out[k] = structuredClone(DOCUMENT_SETTINGS[k].default);
  return out;
}

/** "the document" starts a sentence in lower case when it replaces a title: capitalise it at the start of the text and after a full stop or a blank line. One helper, so every sentence is right. */
export function sentenceCase(text) {
  return typeof text === "string" ? text.replace(/(^|\n\n|[.!?]\s+)the document\b/g, (_m, lead) => `${lead}The document`) : text;
}
export async function getDocumentSetting(tx, key) {
  if (!(key in DOCUMENT_SETTINGS)) throw invalid(`"${key}" is not a document setting`);
  if ((await docustayCut(tx))?.has(key)) return structuredClone(DOCUMENT_SETTINGS[key].default);
  if (isIdentitySettingKey(key)) return (await identitySettings(tx))[key];
  const { rows } = await tx.query(`SELECT value FROM keystone.document_setting WHERE key = $1`, [key]);
  const v = rows.length ? rows[0].value : structuredClone(DOCUMENT_SETTINGS[key].default);
  return v;
}

/** Validate, upsert, announce. `value: null` resets the key to its default (the default is written; settings rows are never deleted). Returns {key, value, changed}. */
// Run 8 (plans matrix): "Reminder days" is the control for AUTOMATIC reminders, a Pro item (the worker never sends them on Free — dueFacts.mjs). It saves on any plan (the schedule is kept
// for the day they upgrade; only `true` switches are refused below), and now READS as Pro-locked on Free, so the screen stops presenting it as a working control.
const PLAN_ITEM_OF_SETTING = Object.freeze({ "brand.hide_footer": "hide_footer", "teams.restrict_visibility": "team_roles", reminder_days: "auto_reminders" });
export async function setDocumentSetting(tx, { tenantId, key, value, updatedBy = null }) {
  const problem = validateDocumentSetting(key, value);
  if (problem) throw invalid(`${DOCUMENT_SETTINGS[key]?.label ?? key}: ${problem}`, { field: key });
  if ((await docustayCut(tx))?.has(key)) throw invalid(`${DOCUMENT_SETTINGS[key]?.label ?? key} is not a setting in Docustay`, { field: key });
  if (!tenantId) throw invalid("setDocumentSetting needs a tenantId — call it inside withTenant()");
  // a list of skill or pack names must name skills or packs that exist (the settings sweep saved "not-a-thing" and kept it; the Plays and Playbooks switches refuse an unknown name already)
  if (key === "plays.off" || key === "packs.enabled") {
    const known = new Set();
    if (key === "plays.off") {
      const { builtinPlay } = await import("./plays/builtin.mjs");
      for (const n of value ?? []) if (builtinPlay(n)) known.add(n);
      const rest = (value ?? []).filter((n) => !known.has(n));
      if (rest.length) for (const r of (await tx.query(`SELECT name FROM keystone.document_play WHERE name = ANY($1::text[])`, [rest])).rows) known.add(r.name);
    } else {
      const { BUILTIN_PACKS } = await import("./plays/packs.mjs");
      for (const b of BUILTIN_PACKS) known.add(b.name);
    }
    const unknown = (value ?? []).filter((n) => !known.has(n));
    if (unknown.length) throw invalid(`${DOCUMENT_SETTINGS[key].label}: "${unknown[0]}" is not ${key === "plays.off" ? "a skill" : "a built-in pack"} in this workspace`, { field: key });
  }
  // ★ Part 29: a setting that belongs to a paid plan item is refused by the host's plan, in the host's plain words (a host with no plans, or an organisation on none, is never limited)
  if (value === true && PLAN_ITEM_OF_SETTING[key]) await (await ports()).entitlements?.assertEntitled?.(tx, { tenantId, item: PLAN_ITEM_OF_SETTING[key] });
  if (value === null) value = structuredClone(DOCUMENT_SETTINGS[key].default);
  if (isIdentitySettingKey(key)) {   // the mail module owns the sending identity
    const r = await setIdentitySetting(tx, { tenantId, key, value, updatedBy });
    if (r.changed) await emit(tx, { tenantId, topic: "documents.setting.changed", emittedBy: "documents", actor: userActor(updatedBy), payload: { key } });
    return r;
  }
  const { rows } = await tx.query(
    `WITH old AS (SELECT value FROM keystone.document_setting WHERE tenant_id = $1 AND key = $2),
          up AS (INSERT INTO keystone.document_setting (tenant_id, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
                 ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
                 RETURNING value)
     SELECT (SELECT value FROM old) IS DISTINCT FROM up.value AS changed FROM up`,
    [tenantId, key, JSON.stringify(value), updatedBy]);
  if (rows.length === 0) throw invalid(`"${key}" was not saved — the row was refused by row-level security`);
  const changed = rows[0].changed;
  if (changed) {
    // key only, never the value: free-text settings (a footer, an address) must not travel through the event log
    await emit(tx, { tenantId, topic: "documents.setting.changed", emittedBy: "documents", actor: userActor(updatedBy), payload: { key } });
  }
  return { key, value, changed };
}

/** The shape the settings screen renders: groups of fields, each with its current value and its default. */
export async function describeDocumentSettings(tx) {
  const values = await getDocumentSettings(tx);
  const cutKeys = await docustayCut(tx);
  // D-079 / D-001: a setting that belongs to a paid plan item is shown as locked on a plan without it (the screen disables it and says so), instead of letting a click be refused after the fact
  const lockedByPlan = new Set();
  let uploadMaxMb = null;   // D-049 / D-066: the real biggest upload (the setting, capped by the plan), so a screen never quotes a number that is not the limit
  try {
    const { rows: [who] } = await tx.query(`SELECT keystone.current_tenant_id() AS t`);
    const P = await ports();
    if (who?.t) uploadMaxMb = await uploadCapMb(tx, { tenantId: who.t });
    if (who?.t && P.entitlements?.isEntitled) for (const [k, item] of Object.entries(PLAN_ITEM_OF_SETTING)) if (!(await P.entitlements.isEntitled(tx, { tenantId: who.t, item }))) lockedByPlan.add(k);
  } catch { /* a host with no plans never locks anything */ }
  // the model picker: a hosted workspace without a key of its own sees only the approved models; a self-host or an own-key workspace sees them all (AI-COST-AND-USAGE-SPEC §3)
  const ownKey = await (async () => { try { const { rows: [w] } = await tx.query(`SELECT keystone.current_tenant_id() AS t`); const { ownKeyState } = await import("./engine/ai/gateway.mjs"); return w?.t ? (await ownKeyState(tx, { tenantId: w.t })).usable : false; } catch { return false; } })();
  const hosted = process.env.KEYSTONE_SELF_HOST !== "1" && !ownKey;
  const fakeOk = fakeAllowed();
  const { rows } = await tx.query(`SELECT key, updated_at FROM keystone.document_setting`);
  const touched = new Map(rows.map((r) => [r.key, r.updated_at]));
  return {
    path: "/documents/settings", title: "Documents", intro: "How signing works, how a signed copy looks, and how long things are kept.",
    groups: SETTING_GROUPS.map((g) => ({
      ...g,
      fields: SETTING_KEYS.filter((k) => DOCUMENT_SETTINGS[k].group === g.key && !DOCUMENT_SETTINGS[k].deprecated && !DOCUMENT_SETTINGS[k].elsewhere && !cutKeys?.has(k)).map((k) => {
        const d = DOCUMENT_SETTINGS[k];
        return { key: k, label: d.label, help: d.help, type: d.type, widget: settingWidget(k, d), choices: SETTING_CHOICES[k] ?? null, modelChoices: k === "ai.model" ? modelChoicesFor({ hosted }) : null, options: d.widget === "styles" ? AGENT_KINDS.map((k) => ({ value: k.id, label: k.label, hint: k.hint })) : (k === "ai.provider" ? (d.options ?? []).filter((o) => fakeOk || (o.value !== "fake" && o.value !== "test_double")) : d.options) ?? null, value: values[k], default: d.default, changedAt: touched.get(k) ?? null, ...(lockedByPlan.has(k) ? { lockedByPlan: true } : {}), ...(PLAN_ITEM_OF_SETTING[k] ? { planItem: PLAN_ITEM_OF_SETTING[k] } : {}) };
      }),
    })),
    writable: true, uploadMaxMb,
  };
}
