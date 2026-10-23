<script>
  // SEND (step 6): who does what, in what order, and what happens when the button is pressed. The Send button itself sits in the page footer so it is in the same place on every document.
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import { ACTION_ROLES } from "$lib/flow/flowDefinition.js";
  import { SEAT_COLOURS } from "./fields.js";
  import { sendPlan, nextLine } from "$lib/flow/sendPlan.js";
  import { checkText } from "./checkStrings.js";
  import { edition } from "$lib/edition.svelte.js";
  let { doc, onedit = null } = $props();
  const o = $derived(doc.sendOptions ?? {}), people = $derived(doc.parties ?? []);
  const verb = (id) => tl(ACTION_ROLES.find((r) => r.id === (id ?? "signer"))?.label ?? "Signs");
  const inPerson = $derived(new Set(o.in_person ?? []));
  const plan = $derived(sendPlan(people, o.in_person ?? [], edition.testMode));
  const noMail = $derived((doc.checklist?.items ?? []).some((i) => i.code === "email_not_set_up"));   // R8-46: a self-hosted install with no email set up
  const limitRow = $derived((doc.checklist?.items ?? []).find((i) => i.code === "email_limit_today"));   // R8-62: the day's email limit, said before Send
  const d = $derived(doc.defaults ?? {});
  const expiryDays = $derived(o.expiry_days === undefined ? d.expiryDays : o.expiry_days);
  const remindersOn = $derived(o.reminders?.on !== false);
  const remDays = $derived(o.reminders?.days ?? d.reminderDays ?? []);
  const fieldCount = $derived((doc.body?.fields ?? []).length);
</script>
{#snippet row(label, body, step, testid)}<div class="grid grid-cols-[110px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line py-3 text-[13px]"><dt class="text-mute">{label}</dt><dd class="min-w-0" data-testid={testid}>{@render body()}</dd>{#if onedit && step}<button class="text-link underline" onclick={() => onedit(step)} data-testid="review-edit-{testid}">{t("Edit")}</button>{:else}<span></span>{/if}</div>{/snippet}
<div class="min-w-0" data-testid="send-summary">
  <dl class="border-t border-line">
    {#snippet r1()}<span class="font-medium">{doc.title}</span>{/snippet}{@render row(t("Document"), r1, "details", "review-document")}
    {#snippet r2()}{#if !people.length}<span class="text-mute">{t("Nobody yet")}</span>{/if}<ol class="space-y-1">{#each people as p, i}<li class="flex items-center gap-2"><span class="inline-block size-2.5 shrink-0 rounded-full" style="background:{SEAT_COLOURS[i % SEAT_COLOURS.length]}"></span><b class="font-medium">{p.name}</b><span class="truncate text-mute">{verb(p.action_role)}{#if inPerson.has(p.role)}{" · "}{t("on this device")}{:else if p.email}{" · "}{p.email}{/if}</span></li>{/each}</ol>{/snippet}{@render row(t("Who signs"), r2, "people", "review-people")}
    {#snippet r3()}<span>{fieldCount === 1 ? t("1 field") : t("{n} fields", { n: fieldCount })}</span>{/snippet}{@render row(t("Fields"), r3, "prepare", "review-fields")}
    {#snippet r4()}<span>{remindersOn && remDays.length ? t("After {days} days", { days: remDays.join(", ") }) : t("Off")}</span>{/snippet}{@render row(t("Reminders"), r4, "details", "review-reminders")}
    {#snippet r5()}<span>{expiryDays ? t("{n, plural, one {In # day} other {In # days}}", { n: expiryDays }) : t("Never")}</span>{/snippet}{@render row(t("Expires"), r5, "details", "review-expires")}
    {#snippet r6()}<span class="line-clamp-2 {o.message ? '' : 'text-mute'}">{o.message || t("The standard message")}</span>{/snippet}{@render row(t("Message"), r6, "details", "review-message")}
  </dl>
  {#if plan.kind !== "none" && noMail}<p class="mt-4 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-[13px]" role="alert" data-testid="send-no-mail">{t("Email isn't set up yet, so nobody can be emailed a link. Open Settings → Email, choose how mail goes out and send yourself a test, then send.")}</p>{:else if plan.kind !== "none" && limitRow}<p class="mt-4 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-[13px]" role="alert" data-testid="send-email-limit">{checkText(limitRow, t)}</p>{:else if plan.kind !== "none"}<p class="mt-4 text-[13px] text-mute" data-testid="send-order-line">{o.order === "sequential" ? t("They go one after another: the next person is emailed when the one before has signed.") : plan.emailed === 1 ? t("The email goes out straight away.") : t("They all get the email straight away.")}</p>{/if}
  <h3 class="mt-6 text-[13px] font-semibold">{t("What happens next")}</h3>
  <ul class="mt-1 list-disc space-y-1 pl-5 text-[13px] text-mute"><li data-testid="send-next-email">{nextLine(plan, t)}</li><li>{t("You are told as each person signs.")}</li><li>{t("When everyone has signed, everyone gets the sealed copy and the certificate.")}</li></ul>
</div>
