<script>
  // THE PERSON PAGE (Run 9 board "Person page"): one person — everything they were sent, opened, signed, filled in and paid, newest first, with tabs; counts of signed and waiting;
  // the key dates from their signed contracts; "Ask Scribe about them"; and Send a document (the person fills the first seat of the next send). Free. The rows come from
  // /api/documents/people/:id/timeline (the island's own rows, RLS); every word is worded here.
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { live } from "$lib/live.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import { chat } from "$lib/chat/chat.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import { tilt } from "$lib/fx/three-d.js";
  let data = $state(null), problem = $state(null), tab = $state("all"), dates = $state([]);
  const id = $derived(page.params.id);
  const TABS = () => [["all", t("All activity")], ["document", t("Documents")], ["form", t("Forms")], ["payment", t("Payments")]];
  const shownItems = $derived((data?.items ?? []).filter((x) => tab === "all" || x.kind === tab));
  const name = $derived(data ? [data.person.firstName, data.person.lastName].filter(Boolean).join(" ") || data.person.email : "");
  const initials = $derived(name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase());
  const day = (iso) => new Date(iso).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  const longDay = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString(i18n.lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });   // a calendar day: never moved by the reader's zone
  const clock = (iso) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return today ? t("Today, {time}", { time: d.toLocaleTimeString(i18n.lang, { hour: "2-digit", minute: "2-digit" }) }) : day(iso); };
  const money = (minor, cur) => { try { return new Intl.NumberFormat(i18n.lang, { style: "currency", currency: String(cur || "usd").toUpperCase() }).format(minor / 100); } catch { return String(minor / 100); } };
  function line(x) {
    switch (x.what) {
      case "signed": return { head: t("Signed “{title}”", { title: x.title }), sub: x.sealed ? t("sealed and stored") : t("waiting for the others"), act: "view" };
      case "filled": return { head: t("Filled in the “{title}” form", { title: x.title }), sub: x.sealed ? t("signed response") : "", act: "view" };
      case "sent": return { head: t("Was sent “{title}”", { title: x.title }), sub: x.done ? "" : x.opened ? t("opened, not signed yet") : t("not opened yet"), act: x.canRemind ? "remind" : "view" };
      case "opened": return { head: t("Opened “{title}”", { title: x.title }), sub: t("not signed yet"), act: "view" };
      case "declined": return { head: t("Declined “{title}”", { title: x.title }), sub: x.reason ? t("“{why}”", { why: x.reason }) : "", act: "view" };
      case "paid": return { head: x.status === "refunded" ? t("Paid {amount} (refunded)", { amount: money(x.amountMinor, x.currency) }) : t("Paid {amount}", { amount: money(x.amountMinor, x.currency) }), sub: t("for “{title}”", { title: x.title }), act: "view" };
      default: return { head: x.title, sub: "" };
    }
  }
  async function load() {
    const r = await api(`/api/documents/people/${encodeURIComponent(id)}/timeline`);
    if (r.ok) { data = r.json?.data ?? r.json; problem = null; } else problem = r.status === 404 ? t("That person was not found. They may have been removed from People.") : (r.error ?? t("This person could not be loaded."));
    const k = await api(`/api/documents/key-dates?person=${encodeURIComponent(id)}`); dates = k.ok ? ((k.json?.data ?? k.json).dates ?? []) : [];
  }
  async function remind(x) { const r = await api("/api/documents/pdf/remind", { method: "POST", body: { instanceId: x.documentId, partyId: x.partyId } }); if (r.ok) toast(t("Reminder sent to {name}.", { name }), "ok"); else toast(r.error ?? t("The reminder was not sent."), "bad"); }
  function send() { try { sessionStorage.setItem("ds-send-to", JSON.stringify({ email: data.person.email, name, id: data.person.id, ts: Date.now() })); } catch {} goto("/create?mode=document"); }
  async function ask(q) { await chat.show(); await chat.send(q, `/people/${id}`); }
  const DATE_KIND = () => ({ end: t("Ends"), notice: t("Renewal notice"), renewal: t("Renews"), start: t("Starts") });
  onMount(() => { load(); return live(["documents", "people"], load); });
</script>
<svelte:head><title>{name || t("Person")} · Docustay</title></svelte:head>
{#if problem}<p class="notice warn" role="alert" data-testid="person-problem">{problem}</p><p class="mt-3"><a href="/people">{t("Back to People")}</a></p>
{:else if !data}<PageSkel kind="detail" testid="person-skel" />
{:else}
<div class="person" data-testid="person-page">
  <div class="main">
    <header class="head">
      <span class="av" aria-hidden="true">{initials}</span>
      <div class="who"><h1 data-testid="person-name">{name}</h1><p class="meta">{data.person.email} · {t("added {when}", { when: day(data.person.createdAt) })}</p></div>
      <button class="btn primary ml-auto" onclick={send} data-testid="person-send">{t("Send a document")}</button>
    </header>
    <div class="tabs" role="tablist" aria-label={t("Show")}>{#each TABS() as [v, label]}<button role="tab" aria-selected={tab === v} class:on={tab === v} onclick={() => (tab = v)} data-testid={`person-tab-${v}`}>{label}</button>{/each}</div>
    {#if !shownItems.length}<p class="empty" data-testid="person-empty">{tab === "payment" ? t("No payments from {name} yet.", { name }) : tab === "form" ? t("{name} has not filled in a form yet.", { name }) : t("Nothing yet. When you send {name} a document it shows here.", { name })}</p>
    {:else}<ol class="tl" data-testid="person-timeline">{#each shownItems as x, i (i + x.what + x.documentId + x.at)}{@const w = line(x)}<li class="it {x.what}" data-testid={`person-item-${x.what}`}>
      <span class="pin" aria-hidden="true"></span>
      <div><p class="ih">{w.head}{#if x.test}<span class="chip warn ml-2">{t("Test")}</span>{/if}</p>
        <p class="is">{[clock(x.at), w.sub].filter(Boolean).join(" · ")}{#if w.act === "view"}{" · "}<a href={`/documents/${x.documentId}`}>{t("View")}</a>{:else if w.act === "remind"}{" · "}<button class="lnk" onclick={() => remind(x)} data-testid="person-remind">{t("Remind")}</button>{/if}</p></div>
    </li>{/each}</ol>{/if}
  </div>
  <aside class="side">
    <div class="counts"><div class="ct" {@attach tilt(4)}><b data-testid="person-signed">{data.counts.signed}</b><span>{t("Signed")}</span></div><div class="ct" {@attach tilt(4)}><b data-testid="person-waiting">{data.counts.waiting}</b><span>{t("Waiting")}</span></div></div>
    <h2 class="eyebrow">{t("Key dates")}</h2>
    {#if dates.length}<dl class="dates" data-testid="person-dates">{#each dates as d}<div><dt>{DATE_KIND()[d.kind] ?? d.label} <span class="dt-doc">· {d.title}</span></dt><dd>{longDay(d.date)}</dd></div>{/each}</dl>
    {:else}<p class="side-note" data-testid="person-no-dates">{t("Dates from signed contracts (an end date, a renewal notice) show here once there are some.")}</p>{/if}
    {#if chat.status === null || chat.status.enabled}<div class="askcard" data-testid="person-ask"><p class="ah">{t("Ask Scribe about {name}", { name: data.person.firstName || name })}</p>
      <p class="aq"><button class="lnk" onclick={() => ask(t("What has {name} still not signed?", { name }))}>“{t("What has {name} still not signed?", { name: data.person.firstName || name })}”</button>{" · "}<button class="lnk" onclick={() => ask(t("When do {name}'s contracts end?", { name }))}>“{t("When do {name}'s contracts end?", { name: data.person.firstName || name })}”</button></p></div>{/if}
  </aside>
</div>
{/if}
<style>
  .person { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 48px; }
  @media (max-width: 1100px) { .person { grid-template-columns: 1fr; gap: 28px; } }
  .head { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .av { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; font: 600 20px/1 var(--font-sans); color: #fff; background: linear-gradient(140deg, #8f8af8, #5a3ac1); box-shadow: 0 14px 30px rgb(90 58 193 / .3); }
  h1 { margin: 0; font-size: var(--t-title); font-weight: 600; letter-spacing: -.01em; }
  .meta { margin: 4px 0 0; font-size: 14px; color: var(--mute); }
  .tabs { display: flex; gap: 28px; margin-top: 26px; border-bottom: 1px solid var(--hair); }
  .tabs button { padding: 0 0 12px; font-size: 14px; color: var(--mute); background: none; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tabs button.on { color: var(--violet); font-weight: 600; border-color: var(--violet); }
  .tl { list-style: none; margin: 26px 0 0; padding: 0; position: relative; }
  .tl::before { content: ""; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: color-mix(in srgb, var(--violet) 22%, transparent); }
  .it { position: relative; display: flex; gap: 16px; padding-bottom: 22px; }
  .pin { flex: none; position: relative; width: 14px; height: 14px; margin-top: 4px; border-radius: 50%; background: var(--card); box-shadow: inset 0 0 0 2px #8f8af8; z-index: 1; }
  .it.signed .pin, .it.paid .pin, .it.filled .pin { background: var(--violet); box-shadow: none; }
  .it.sent .pin { box-shadow: inset 0 0 0 2px var(--line-strong); }
  .ih { margin: 0; font-size: var(--t-body); font-weight: 600; color: var(--ink); }
  .is { margin: 3px 0 0; font-size: var(--t-meta); color: var(--mute); }
  .is a, .lnk { color: var(--violet); text-decoration: underline; text-underline-offset: 2px; background: none; font-size: inherit; }
  .empty { margin-top: 26px; color: var(--mute); }
  .counts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ct { border-radius: var(--rad-m); background: var(--lilac-soft); padding: 16px; display: grid; gap: 4px; }
  :global([data-theme="dark"]) .ct { background: var(--brand-soft); }
  .ct b { font-size: 24px; font-weight: 600; } .ct span { font-size: var(--t-meta); color: var(--text-2); }
  .eyebrow { margin: 26px 0 10px; font: 500 11px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--mute); }
  .dates { margin: 0; display: grid; gap: 10px; } .dates div { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; } .dates dd { margin: 0; color: var(--text-2); white-space: nowrap; } .dt-doc { color: var(--mute); }
  .side-note { font-size: var(--t-meta); color: var(--mute); margin: 0; }
  .askcard { margin-top: 24px; border-radius: var(--rad-m); background: var(--card); box-shadow: var(--surface-shadow); padding: 16px; }
  .ah { margin: 0; font-size: 14px; font-weight: 600; } .aq { margin: 8px 0 0; font-size: 13.5px; line-height: 1.5; }
</style>
