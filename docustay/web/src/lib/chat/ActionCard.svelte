<script>
  // The cards other than a change to words: a draft the assistant made, a template it made, people and details it suggests (Accept or Reject), and a CONFIRMATION card with a button.
  // Run 8 (the maintainer): at most ONE box — the finished draft card. Suggestions and confirmations sit on hairlines; the Pro card offers what can be done instead (pills) and Explore Pro (the pricing page's Pro section).
  // Only a confirmation card's button sends, voids, reminds, copies or sends to a list: it calls chat.confirm, the route that re-checks the person's permission.
  import { goto } from "$app/navigation";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import Icon from "$lib/ui/Icon.svelte";
  import { chat } from "./chat.svelte.js";
  import InkSheet from "$lib/fx/InkSheet.svelte";
  import FormDrop from "$lib/fx/FormDrop.svelte";
  import { exploreProFrom } from "$lib/pro/proSheet.svelte.js";
  import { relativeTime } from "$lib/ui/relativeTime.js";
  import { confirmWords, doneWords, proWords } from "./cardWords.js";
  let { proposal, onnavigate = () => {}, onprompt = () => {} } = $props();
  let reason = $state(""), includeText = $state(false), read = $state(false);
  // Run 9 — the remind-several card (board "ScribeAct"): a tick per document, the person's own message if they change it, Cancel. Nothing is sent until the button.
  let picked = $state(null), editing = $state(false), note = $state(""), cancelled = $state(false);
  $effect.pre(() => { if (picked === null && proposal.card?.choices) picked = proposal.card.choices.filter((c) => c.checked).map((c) => c.documentId); });
  const nPicked = $derived(picked?.length ?? 0);
  const toggle = (id) => { picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; };
  const STATE_WORD = { draft: () => t("Draft"), sent: () => t("Sent"), partially_signed: () => t("Partly signed"), executed: () => t("Signed"), declined: () => t("Declined"), expired: () => t("Expired"), void: () => t("Cancelled") };
  const day = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  $effect.pre(() => { if (!reason && proposal.card?.reason) reason = proposal.card.reason; });
  const card = $derived(proposal.card ?? {});
  const kind = $derived(proposal.kind);
  // F1012: every card worded here from its facts, in the person's language; an older card without facts keeps the words it was stored with
  const words = $derived(kind === "confirm" ? confirmWords(card) : null);
  const pw = $derived(kind === "pro" ? proWords(card) : null);
  const done = $derived(proposal.state === "confirmed");
  const open = (link) => { onnavigate(link); goto(link); };
  const needsReason = $derived(card.needsReason === true);
  const canPress = $derived(!proposal.pressing && (!needsReason || reason.trim().length >= 3) && (!card.needsRead || read) && (card.kind !== "remind_many" || nPicked > 0));
  const cardTitle = $derived(card.kind === "remind_many" ? t("Send {n, plural, one {# reminder} other {# reminders}}", { n: nPicked }) : card.kind === "make_template" ? t("Make a template from “{title}”", { title: card.docTitle }) : card.kind === "set_reminders" ? t("Reminders for “{title}”", { title: card.docTitle }) : (words?.title ?? card.title));
  const cardSummary = $derived(card.kind === "remind_many" ? t("Uses your normal reminder email. Nothing is sent until you press Send.") : card.kind === "make_template" ? t("Saves its pages, boxes and who fills each one as a template. The people on it are not saved, and nothing is sent.") : card.kind === "set_reminders" ? ((card.days ?? []).length ? t("Each person who has not finished gets a reminder after {days} days.", { days: card.days.join(", ") }) : t("No automatic reminders. You can still remind people yourself.")) : (words?.summary ?? card.summary));
  const cardButton = $derived(card.kind === "remind_many" ? t("Send {n, plural, one {# reminder} other {# reminders}}", { n: nPicked }) : card.kind === "make_template" ? t("Make the template") : card.kind === "set_reminders" ? ((card.days ?? []).length ? t("Set reminders") : t("Turn reminders off")) : (words?.button ?? card.button ?? t("Confirm")));
  const doneText = $derived(card.kind === "remind_many" && proposal.result?.detail ? t("{n, plural, one {# reminder} other {# reminders}} sent.", { n: proposal.result.detail.emailed ?? 0 }) + (proposal.result.detail.reminded > proposal.result.detail.emailed ? " " + t("{n, plural, one {# person was} other {# people were}} not emailed (today's email limit, or email is not set up).", { n: proposal.result.detail.reminded - proposal.result.detail.emailed }) : "") : card.kind === "make_template" ? t("Template made. It is with your templates.") : card.kind === "set_reminders" ? ((card.days ?? []).length ? t("Reminders set: after {days} days.", { days: card.days.join(", ") }) : t("Automatic reminders are off.")) : (doneWords(card, proposal.result) ?? proposal.result?.summary ?? t("Done.")));
</script>
{#if kind === "pro"}
  <div class="pro" data-testid="chat-card-pro">
    <div class="pt"><span class="lk" aria-hidden="true"><Icon name="lock" size={13} /></span><span class="font-semibold">{pw.title}</span><span class="tag">Pro</span></div>
    <div class="pb">{pw.body}</div>
    {#if pw.instead.length}<div class="alts" data-testid="chat-pro-instead">{#each pw.instead as a, i (a.label)}<button type="button" class="alt" style="--i:{i}" data-testid="chat-pro-alt" onclick={() => (a.prompt ? onprompt(a.prompt) : open(a.link))}>{a.label}</button>{/each}</div>{/if}
    <div class="flex flex-wrap items-center gap-2">
      {#if card.external !== false && /^https:\/\//.test(card.link ?? "")}<a class="btn primary go" href={card.link} target="_blank" rel="noopener" data-testid="chat-pro-link">{pw.linkLabel}<Icon name="external" size={13} /></a>
      {:else}<button class="btn primary go" type="button" data-testid="chat-pro-link" onclick={() => open(card.link ?? "/billing")}>{pw.linkLabel}</button>{/if}
      <button class="btn quiet go" type="button" data-testid="chat-pro-sheet" onclick={(e) => exploreProFrom(card.item ?? null, e.currentTarget)}>{t("What Pro adds")}</button>
    </div>
  </div>
{:else if kind === "created" || kind === "template"}
  <div class="made" data-testid="chat-card-made">
    <span class="thumb" aria-hidden="true">{#if card.kind === "form"}<FormDrop done />{:else}<InkSheet done />{/if}<span class="tick"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg></span></span>
    <div class="grid min-w-0 gap-1">
      <div class="font-semibold truncate">{card.title}</div>
      <div class="text-sm text-mute">{kind === "template" ? t("Template made. It is saved with your templates. Nothing was sent.") : card.test ? t("A test document with {n} people. Nothing was sent.", { n: card.people }) : t("A draft with {n} people. Nothing was sent.", { n: card.people })}</div>
      {#if card.notes?.length}<ul class="notes" aria-label={t("Worth checking")} data-testid="chat-card-notes">{#each card.notes as n}<li><span class="font-medium">{n.topic}</span> <span aria-hidden="true">→</span> <span class="text-mute">{n.note}</span></li>{/each}</ul>{/if}
      {#if card.link}<div class="pt-1"><button class="btn primary go" type="button" data-testid="chat-open-draft" onclick={() => open(card.link)}>{kind === "template" ? t("Open templates") : t("Open in editor")}</button></div>{/if}
    </div>
  </div>
{:else if kind === "people" || kind === "details" || kind === "pdf_fields"}
  <div class="line" data-testid="chat-card-plan" data-state={proposal.state}>
    <div class="font-semibold">{proposal.summary}</div>
    <ul class="grid gap-1 text-sm" aria-label={t("What would change")}>{#each card.lines ?? [] as l}<li><span class="text-mute">{l.label}:</span> <ins class="bg-brand-soft no-underline px-0.5">{l.value}</ins></li>{/each}</ul>
    {#if proposal.state === "proposed"}
      <div class="flex flex-wrap gap-2"><button class="btn primary" style="min-height:40px" type="button" data-testid="chat-accept" onclick={() => chat.accept(proposal)}>{t("Accept")}</button><button class="btn quiet" style="min-height:40px" type="button" data-testid="chat-reject" onclick={() => chat.reject(proposal)}>{t("Reject")}</button></div>
    {:else}<div class="text-sm text-mute" data-testid="chat-proposal-state">{proposal.state === "accepted" ? t("Accepted") : proposal.state === "rejected" ? t("Rejected") : t("Undone")}</div>{/if}
  </div>
{:else if kind === "results"}
  <div class="line" data-testid="chat-card-results" data-total={card.total}>
    <div class="flex flex-wrap items-baseline gap-2"><span class="font-semibold">{card.question ?? t("Documents found")}</span><span class="text-sm text-mute" data-testid="chat-results-count">{t("{n, plural, =0 {Nothing found} one {# document} other {# documents}}", { n: card.total ?? 0 })}</span></div>
    {#if card.rows?.length}<ul class="grid text-sm">{#each card.rows as r (r.id)}
      <li class="res" data-testid="chat-result-row" data-id={r.id} data-state={r.state}>
        <button type="button" class="truncate text-left font-medium text-ink hover:underline" onclick={() => open(`/documents/${r.id}`)}>{r.title}</button>
        <span class="text-mute">{STATE_WORD[r.state]?.() ?? r.state}{#if r.waitingOn}{" · "}{t("waiting on {who}", { who: r.waitingOn })}{/if}{#if r.ends}{" · "}{t("ends {date}", { date: day(r.ends) })}{/if}{#if r.notice}{" · "}{t("notice by {date}", { date: day(r.notice) })}{/if}</span>
      </li>{/each}</ul>
      {#if (card.total ?? 0) > card.rows.length}<div class="text-xs text-mute">{t("Showing {shown} of {total}.", { shown: card.rows.length, total: card.total })}</div>{/if}{/if}
  </div>
{:else if kind === "explain"}
  <div class="explain" data-testid="chat-card-explain">
    <div class="font-semibold">{t("Explain this clause")}</div>
    <div class="text-sm"><span class="font-medium">“{card.heading}”</span>{#if card.page}{" "}<span class="text-mute">({t("page {n}", { n: card.page })})</span>{/if}</div>
    {#if card.quote}<details class="text-xs text-mute"><summary class="cursor-pointer">{t("The clause's own words")}</summary><p class="mt-1 whitespace-pre-line" data-testid="chat-explain-quote">{card.quote}</p></details>{/if}
    <p class="text-[14px] leading-relaxed" data-testid="chat-explain-text">{card.explanation}</p>
    <p class="text-xs text-mute" data-testid="chat-explain-note">{t("This is a plain-words summary, not legal advice.")}</p>
  </div>
{:else if kind === "confirm"}
  <div class="line {card.danger ? 'danger' : ''}" data-testid="chat-card-confirm" data-action={proposal.action} data-state={proposal.state}>
    <div class="font-semibold">{cardTitle}</div>
    {#if card.test}<span class="chip warn !min-h-0 w-fit" data-testid="chat-card-test"><Icon name="flask" size={13} />{t("TEST: only you receive it")}</span>{/if}
    {#if card.choices?.length}
      <ul class="grid gap-1 text-sm" data-testid="chat-remind-list">{#each card.choices as c (c.documentId)}
        <li><label class="flex items-start gap-2"><input type="checkbox" class="mt-1" checked={picked?.includes(c.documentId)} disabled={done || cancelled} onchange={() => toggle(c.documentId)} data-testid="chat-remind-pick" data-id={c.documentId} />
          <span><span class="font-medium">{c.people.join(", ")}</span> · {c.title} · {#if c.lastRemindedAt}{t("reminded {when}", { when: relativeTime(new Date(c.lastRemindedAt), { locale: i18n.lang }) })}{:else if c.sentAt}{t("sent {when}", { when: relativeTime(new Date(c.sentAt), { locale: i18n.lang }) })}{/if}</span></label></li>{/each}</ul>
    {/if}
    {#if cardSummary}<div class="text-sm {card.choices ? 'text-mute text-xs' : ''}">{cardSummary}</div>{/if}
    {#if card.kind === "make_template"}<ul class="grid gap-0.5 text-sm"><li><span class="text-mute">{t("Name")}:</span> {card.name}</li><li class="text-mute">{t("{n, plural, one {# box} other {# boxes}}", { n: card.boxes })}</li></ul>
    {:else if card.kind === "set_reminders"}<div class="text-sm text-mute">{(card.current ?? []).length ? t("Right now: reminders after {days} days.", { days: card.current.join(", ") }) : t("Right now: no automatic reminders.")}</div>
    {:else if (words?.lines ?? card.lines)?.length}<ul class="grid gap-0.5 text-sm">{#each words?.lines ?? card.lines as l}<li><span class="text-mute">{l.label}:</span> {l.value}</li>{/each}</ul>{/if}
    {#if card.problems?.length}<ul class="text-sm text-bad">{#each card.problems as p}<li>{p}</li>{/each}</ul>{/if}
    {#if cancelled}<div class="text-sm text-mute" role="status" data-testid="chat-card-cancelled">{t("Cancelled. Nothing was sent.")}</div>
    {:else if done}
      <div class="text-sm font-semibold" role="status" data-testid="chat-card-done">{doneText}</div>
      {#if proposal.result?.link}<div><button class="btn" style="min-height:40px" type="button" data-testid="chat-card-open" onclick={() => open(proposal.result.link)}>{t("Open it")}</button></div>{/if}
    {:else}
      {#if needsReason}<label class="grid gap-1 text-sm"><span class="text-mute">{t("Why is it being voided?")}</span><input class="field" maxlength="500" bind:value={reason} data-testid="chat-card-reason" /></label>{/if}
      {#if card.messageEditable && editing}<label class="grid gap-1 text-sm"><span class="text-mute">{t("The reminder's message")}</span><textarea class="field" rows="3" maxlength="2000" bind:value={note} placeholder={t("Leave empty to use the document's own message.")} data-testid="chat-remind-message"></textarea></label>{/if}
      {#if card.offerText}<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={includeText} data-testid="chat-card-include-text" />{t("Include the words of the document I have open")}</label>{/if}
      {#if card.needsRead}<label class="flex items-start gap-2 text-sm"><input type="checkbox" class="mt-1" bind:checked={read} data-testid="chat-card-read" /><span>{t("I have read this document. The assistant wrote part of it.")}</span></label>{/if}
      {#if proposal.problem}<div class="notice warn" role="alert" data-testid="chat-card-problem">{proposal.problem}</div>{/if}
      <div class="flex flex-wrap gap-2">
        <button class="btn {card.danger ? '' : 'primary'}" style="min-height:44px" type="button" disabled={!canPress} data-testid="chat-card-confirm-button" onclick={() => chat.confirm(proposal, { reason: reason.trim() || undefined, includeText: includeText || undefined, read: read || undefined, ...(card.choices ? { selected: picked, message: note.trim() || undefined } : {}) })}>{proposal.pressing ? t("Working…") : cardButton}</button>
        {#if card.messageEditable && !editing}<button class="btn" style="min-height:44px" type="button" data-testid="chat-remind-edit" onclick={() => (editing = true)}>{t("Change the message")}</button>{/if}
        {#if card.choices}<button class="btn quiet" style="min-height:44px" type="button" data-testid="chat-card-cancel" onclick={() => (cancelled = true)}>{t("Cancel")}</button>{/if}
        {#if card.link}<button class="btn quiet" style="min-height:44px" type="button" onclick={() => open(card.link)}>{t("Look first")}</button>{/if}
      </div>
    {/if}
  </div>
{/if}
<style>
  .line { display: grid; gap: .45rem; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: .7rem 0; }
  .line.danger > .font-semibold:first-child { color: var(--bad); }
  .line[data-state="confirmed"] [data-testid="chat-card-done"] { color: var(--ok); }
  .go { min-height: 36px !important; padding: 0 14px !important; font-size: 13.5px; gap: 6px; }
  .pro { display: grid; gap: 10px; padding: 2px 0; }
  .res { display: grid; gap: 1px; padding: 6px 0; border-top: 1px solid var(--line); } .res:first-child { border-top: 0; }
  .explain { display: grid; gap: .45rem; border-radius: 14px; background: var(--card); padding: 14px; box-shadow: 0 10px 24px rgb(40 25 100 / .08); }
  .pt { display: flex; align-items: center; gap: 8px; }
  .lk { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); }
  .tag { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; padding: 1px 7px; border-radius: 999px; background: var(--brand); color: var(--brand-ink, #fff); }
  .pb { font-size: 14px; line-height: 1.5; }
  .alts { display: flex; flex-wrap: wrap; gap: 8px; }
  .alt { border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); border-radius: 999px; padding: 7px 14px; min-height: 36px; font: inherit; font-size: 13.5px; cursor: pointer; animation: alt-in 320ms cubic-bezier(.2,.8,.2,1) calc(var(--i) * 70ms) both; }
  .alt:hover { border-color: var(--brand); color: var(--brand); }
  .made { display: flex; gap: 14px; align-items: flex-start; border: 1px solid var(--line); border-radius: 14px; background: var(--card); padding: 14px; box-shadow: 0 10px 24px rgb(40 25 100 / .08); animation: land 520ms cubic-bezier(.2,.8,.2,1); }
  .thumb { position: relative; display: grid; place-items: center; width: 56px; height: 64px; border-radius: 8px; background: var(--tint); flex: none; }
  .tick { position: absolute; right: -5px; bottom: -5px; width: 20px; height: 20px; border-radius: 50%; background: var(--ok); display: grid; place-items: center; box-shadow: 0 0 0 2px var(--card); }
  .tick svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 16; stroke-dashoffset: 16; animation: draw 380ms cubic-bezier(.2,.8,.2,1) 380ms forwards; }
  .notes { display: grid; gap: 4px; font-size: 13px; } .notes li { border-top: 1px solid var(--line); padding-top: 4px; }
  @keyframes land { from { opacity: 0; transform: translateY(-10px) scale(.98); box-shadow: 0 0 0 rgb(40 25 100 / 0); } to { opacity: 1; transform: none; } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes alt-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .made, .alt { animation: none; } .tick svg { animation: none; stroke-dashoffset: 0; } }
</style>
