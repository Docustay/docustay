<script>
  import { api } from "$lib/api.js";
  import { uploadFile } from "$lib/docs.js";
  import { LANGUAGES, languageLabel, LANG_META } from "$lib/i18n.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import Pick from "$lib/ui/Pick.svelte";
  import ProLock from "$lib/pro/ProLock.svelte";
  import { EXPIRY_CHOICES, REMINDER_CHOICES } from "$lib/flow/flowDefinition.js";
  let { doc, onChange, onRefresh } = $props();
  const o = $derived(doc.sendOptions ?? {}), d = $derived(doc.defaults ?? {});
  const set = (p) => onChange({ sendOptions: { ...o, ...p } });
  const expiry = $derived(o.expiry_days === undefined ? d.expiryDays : o.expiry_days);
  const remindersOn = $derived(o.reminders?.on !== false);
  const dayList = $derived(o.reminders?.days ?? d.reminderDays ?? [3, 7]);
  // finite choices; a value saved earlier that is not one of them stays selectable so nothing silently changes
  const expiryOptions = $derived([...EXPIRY_CHOICES.map((c) => ({ value: String(c.days), label: tl(c.label) })), ...(EXPIRY_CHOICES.some((c) => c.days === Number(expiry ?? 0)) ? [] : [{ value: String(expiry), label: t("In {n} days", { n: expiry }) }])]);
  const remKey = (arr) => arr.join(",");
  const remOptions = $derived([...REMINDER_CHOICES.filter((c) => c.days.length).map((c) => ({ value: remKey(c.days), label: tl(c.label) })), ...(REMINDER_CHOICES.some((c) => remKey(c.days) === remKey(dayList)) ? [] : [{ value: remKey(dayList), label: t("Your own schedule") }])]);
  // a datetime-local box shows and takes LOCAL time; the stored value is a UTC instant, so it is written back as the viewer's own clock (D-run4-1: it used to show the UTC clock time)
  const localInput = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const scheduled = $derived(Boolean(o.send_at)), local = $derived(o.send_at ? localInput(o.send_at) : "");
  const extras = $derived((doc.files ?? []).filter((f) => f.kind === "attachment" && f.meta?.extra));
  let attachNote = $state(null);
  async function attach(file) { attachNote = t("Adding {name}…", { name: file.name }); try { await uploadFile(file, { attachTo: doc.id }); attachNote = null; await onRefresh?.(); } catch (e) { attachNote = e.message || t("That file could not be added."); } }
</script>
{#snippet row(label, help, body)}<div class="grid gap-1 border-t border-line py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_340px] md:gap-6"><div><p class="text-sm font-medium">{label}</p>{#if help}<p class="mt-0.5 text-xs text-mute">{help}</p>{/if}</div><div>{@render body()}</div></div>{/snippet}
<div class="max-w-[860px] rounded-xl border border-line px-5 py-2" data-testid="send-step">
  {#snippet exp()}<div class="w-56"><Pick options={expiryOptions} value={String(expiry ?? 0)} onchange={(v) => set({ expiry_days: Number(v) })} testid="send-expiry" label="" /></div>{/snippet}
  {#snippet lang()}<select class="field !py-1.5" value={o.language ?? "auto"} onchange={(e) => set({ language: e.currentTarget.value })} aria-label={t("Language")} data-testid="send-language"><option value="auto">{t("Match each signer’s own language")}</option>{#each LANGUAGES as l}<option value={l}>{languageLabel(l)}</option>{/each}</select>{#if LANG_META[o.language ?? "en"]?.beta}<p class="mt-1 text-xs text-mute" data-testid="send-language-beta">{t("This translation is a machine-written draft (Beta) that a native speaker has not read yet. Your own message and your organisation's own wording are never translated.")}</p>{/if}{/snippet}
  {@render row(t("Language"), t("The language of the signing page, the email around your message and the certificate. By default each signer sees their own language, taken from their browser; choose one to use it for everyone. Your own message is sent as you wrote it."), lang)}
  {@render row(t("Expires"), t("The deadline is fixed when you send."), exp)}
  {#snippet rem()}<ProLock item="auto_reminders" tip={t("Docustay reminds the people who have not signed, on the days you choose. On your plan you can remind someone by hand from the document's page.")}>{#snippet children(locked)}<div class="flex items-center gap-3"><input type="checkbox" checked={remindersOn && !locked} disabled={locked} onchange={(e) => set({ reminders: { on: e.currentTarget.checked, days: o.reminders?.days ?? d.reminderDays ?? [3, 7] } })} aria-label={t("Reminders on")} data-testid="send-reminders" />
    <div class="w-64"><Pick options={remOptions} value={remKey(dayList)} disabled={!remindersOn || locked} onchange={(v) => set({ reminders: { on: remindersOn, days: v.split(",").map(Number) } })} testid="send-reminder-schedule" /></div></div>{/snippet}</ProLock>{/snippet}
  {@render row(t("Reminders"), t("Days after sending to remind people who have not signed."), rem)}
  {#snippet ver()}<select class="field !py-1.5" value={o.verification ?? "none"} onchange={(e) => set({ verification: e.currentTarget.value })} aria-label={t("Verification")} data-testid="send-verification"><option value="none">{t("No extra check")}</option><option value="email_code">{t("Email code")}</option><option value="access_code">{t("Access code")}</option></select>{/snippet}
  {@render row(t("Check who is signing"), t("An email code or access code is asked for before the document opens."), ver)}
  {#if o.verification === "access_code"}{#snippet ac()}<input class="field !py-1.5" autocomplete="off" placeholder={o.access_code_set ? t("A code is set — type to change") : t("At least 4 characters")} onchange={(e) => { if (e.currentTarget.value) set({ access_code: e.currentTarget.value }); }} aria-label={t("Access code")} />{/snippet}{@render row(t("Access code"), t("Tell people the code another way — by phone or message, not in this email."), ac)}{/if}
  {#snippet files()}<div class="space-y-2">{#if extras.length}<ul class="space-y-1">{#each extras as f}<li class="flex items-center gap-2 text-sm"><span class="truncate">{f.name}</span><button class="btn !px-2 !py-0.5 !text-xs" onclick={async () => { await api("/api/documents/pdf/attachment/remove", { method: "POST", body: { instanceId: doc.id, fileId: f.id } }); await onRefresh?.(); }}>{t("Remove")}</button></li>{/each}</ul>{/if}
    <label class="btn cursor-pointer !py-1.5">{t("Add a file")}<input type="file" class="sr-only" accept=".pdf,application/pdf" onchange={(e) => { const x = e.currentTarget.files?.[0]; if (x) attach(x); e.currentTarget.value = ""; }} /></label>{#if attachNote}<p class="text-xs text-mute" role="status">{attachNote}</p>{/if}</div>{/snippet}
  {@render row(t("Extra files"), t("Files people can read alongside the document — a price list, terms. Up to 25 MB each."), files)}
  {#snippet dr()}<input type="checkbox" checked={o.require_decline_reason === true} onchange={(e) => set({ require_decline_reason: e.currentTarget.checked })} aria-label={t("Require a decline reason")} data-testid="send-decline-reason" />{/snippet}
  {@render row(t("Ask for a reason when someone declines"), null, dr)}
  {#snippet when()}<div class="space-y-2"><select class="field !py-1.5" value={scheduled ? "later" : "now"} onchange={(e) => set({ send_at: e.currentTarget.value === "later" ? new Date(Date.now() + 3600e3).toISOString() : null })} aria-label={t("When to send")} data-testid="send-when"><option value="now">{t("Send now")}</option><option value="later">{t("Send later")}</option></select>
    {#if scheduled}<input class="field !py-1.5" type="datetime-local" value={local} onchange={(e) => { const at = new Date(e.currentTarget.value); if (!Number.isNaN(at.getTime())) set({ send_at: at.toISOString() }); }} aria-label={t("Send at")} data-testid="send-at" />{/if}</div>{/snippet}
  {@render row(t("When"), null, when)}
</div>
