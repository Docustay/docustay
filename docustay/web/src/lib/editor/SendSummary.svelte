<script>
  // SEND (step 6): who does what, in what order, and what happens when the button is pressed. The Send button itself sits in the page footer so it is in the same place on every document.
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import { ACTION_ROLES } from "$lib/flow/flowDefinition.js";
  import { SEAT_COLOURS } from "./fields.js";
  import { sendPlan, nextLine } from "$lib/flow/sendPlan.js";
  import { checkText } from "./checkStrings.js";
  import { edition } from "$lib/edition.svelte.js";
  let { doc } = $props();
  const o = $derived(doc.sendOptions ?? {}), people = $derived(doc.parties ?? []);
  const verb = (id) => tl(ACTION_ROLES.find((r) => r.id === (id ?? "signer"))?.label ?? "Signs");
  const inPerson = $derived(new Set(o.in_person ?? []));
  const plan = $derived(sendPlan(people, o.in_person ?? [], edition.testMode));
  const noMail = $derived((doc.checklist?.items ?? []).some((i) => i.code === "email_not_set_up"));   // R8-46: a self-hosted install with no email set up
  const limitRow = $derived((doc.checklist?.items ?? []).find((i) => i.code === "email_limit_today"));   // R8-62: the day's email limit, said before Send
</script>
<div class="max-w-[760px] space-y-4" data-testid="send-summary">
  <section class="rounded-xl border border-line p-5">
    <h2 class="font-semibold">{doc.title}</h2>
    <ol class="mt-3 space-y-2">{#each people as p, i}<li class="flex items-center gap-2 text-sm"><span class="inline-block size-3 rounded-full" style="background:{SEAT_COLOURS[i % SEAT_COLOURS.length]}"></span><b>{p.name}</b><span class="text-mute">{verb(p.action_role)}{#if inPerson.has(p.role)}{" · "}{t("on this device")}{:else if p.email}{" · "}{p.email}{/if}</span></li>{/each}</ol>
    {#if plan.kind !== "none" && noMail}<p class="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm" role="alert" data-testid="send-no-mail">{t("Email isn't set up yet, so nobody can be emailed a link. Open Settings → Email, choose how mail goes out and send yourself a test, then send.")}</p>{:else if plan.kind !== "none" && limitRow}<p class="mt-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm" role="alert" data-testid="send-email-limit">{checkText(limitRow, t)}</p>{:else if plan.kind !== "none"}<p class="mt-3 text-sm text-mute" data-testid="send-order-line">{o.order === "sequential" ? t("They go one after another: the next person is emailed when the one before has signed.") : plan.emailed === 1 ? t("The email goes out straight away.") : t("They all get the email straight away.")}</p>{/if}
  </section>
  <section class="rounded-xl border border-line p-5 text-sm">
    <h3 class="font-medium">{t("What happens next")}</h3>
    <ul class="mt-2 list-disc space-y-1 pl-5 text-mute"><li data-testid="send-next-email">{nextLine(plan, t)}</li><li>{t("You are told as each person signs.")}</li><li>{t("When everyone has signed, everyone gets the sealed copy and the certificate.")}</li></ul>
  </section>
</div>
