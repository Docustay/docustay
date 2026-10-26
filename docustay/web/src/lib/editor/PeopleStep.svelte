<script>
  import Page from "$lib/ui/Page.svelte";
  // WHO SIGNS (step 2 of every flow, before anything is written or placed). The first row is YOU, locked: you fill in the parts marked "Sender first" before sending. Then one row per person:
  // colour dot, name, email, a role PICKER, "on this device", and (when people go one after another) a step PICKER. No dummy people: a fresh document starts with You and one empty row.
  // Works on a stored document (`doc.parties`, saved by the host) and, with `mode="flow"`, on the in-browser draft of the written flow. `mode="template"` is the roles version (a role name, and who plays it).
  import { tick } from "svelte";
  import { api } from "$lib/api.js";
  import { SEAT_COLOURS } from "./fields.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import { ACTION_ROLES, SIGNING_ORDERS, SENDER_ROW } from "$lib/flow/flowDefinition.js";
  import Pick from "$lib/ui/Pick.svelte";
  import FlowIcon from "$lib/flow/FlowIcon.svelte";
  import ProLock from "$lib/pro/ProLock.svelte";
  import { entitled, loadPlan } from "$lib/pro/plan.svelte.js";
  import { onMount } from "svelte";
  let { doc, onChange, mode = "document", attempted = false } = $props();
  const EMAIL_OK = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
  let left = $state({});   // seats whose email box has been left: only then may a half-typed address be called incomplete
  const emailBad = (p) => Boolean(p.email) && !EMAIL_OK.test(p.email) && (left[p.role] || attempted);
  function typeEmail(i, v) { const x = v.trim(); if (!x || EMAIL_OK.test(x)) patch(i, { email: x || null }); }   // nothing is saved while the address is half-typed
  function leaveEmail(i, role, v) { left[role] = true; const x = v.trim(); if ((x || null) !== (people[i]?.email ?? null)) patch(i, { email: x || null }); }
  const isTpl = $derived(mode === "template");
  const people = $derived(doc.parties ?? []), order = $derived(doc.sendOptions?.order ?? "parallel"), inPerson = $derived(new Set(doc.sendOptions?.in_person ?? []));
  const plays = $derived(doc.sendOptions?.plays ?? {});   // template roles: who plays each by default: you | at_send | fixed
  let orderNote = $state(null);   // R13-D035: said when adding an assistant switches the order to one after another (an assistant only works in order)
  let q = $state(""), found = $state([]), pastOpen = $state(false), timer, draft = $state({ name: "", email: "" });
  const strip = (p) => ({ role: p.role, name: p.name ?? "", email: p.email ?? null, phone: p.phone ?? null, action_role: p.action_role ?? "signer", external_ref: p.external_ref ?? null, expires_at: p.expires_at ?? null, reminder_days: p.reminder_days ?? null, assists_role: (p.action_role ?? "signer") === "assistant" ? p.assists_role ?? null : null, step: p.step ?? null,
    ...((p.action_role ?? "signer") === "signer" && p.group_label ? { group_label: p.group_label } : {}), ...((p.action_role ?? "signer") === "signer" && p.witness_required ? { witness_required: true } : {}) });
  const nextSeat = () => { for (let i = 1; i < 999; i += 1) if (!people.some((p) => p.role === `signer_${i}`)) return `signer_${i}`; return "signer_999"; };
  const send = (parties, sendOptions = doc.sendOptions) => onChange({ parties: parties.map(strip), sendOptions });
  const add = (p) => send([...people, { role: nextSeat(), action_role: "signer", ...p }]);
  const patch = (i, c) => send(people.map((p, k) => (k === i ? { ...p, ...c } : p)));
  // Run 8 J6: a past signer fills the first seat nobody has filled yet (a starter's own "Subject" seat), and is added as a new person only when every seat is taken
  const pickPast = (c) => { const i = people.findIndex((p) => !String(p.name ?? "").trim() && !p.email); if (i >= 0) patch(i, { name: c.name, email: c.email, external_ref: c.id }); else add({ name: c.name, email: c.email, external_ref: c.id }); };
  // Run 9 (the person page's "Send a document"): the person it was pressed for fills the first empty seat, once — handed over in this tab only, for 30 minutes
  let handed = false;
  $effect(() => { if (handed || isTpl) return; handed = true; let to = null; try { to = JSON.parse(sessionStorage.getItem("ds-send-to") ?? "null"); sessionStorage.removeItem("ds-send-to"); } catch {}
    if (to?.email && Date.now() - (to.ts ?? 0) < 1800000 && !people.some((p) => (p.email ?? "").toLowerCase() === to.email.toLowerCase())) pickPast({ name: to.name ?? "", email: to.email, id: to.id ?? null }); });
  const remove = (i) => send(people.filter((_, k) => k !== i));
  // Run 9 — a SIGNING GROUP (Pro): more people in the same seat; the first of them to sign fills it. A WITNESS (Free): someone signs straight after this person, on their device.
  // 21 Oct 2026: sending to teammates. The team (read from the workspace) lets a row say "Team" and lets "Add myself" fill in who you are; a teammate is linked by the member's id in external_ref
  let mates = $state([]), matesFailed = $state(null), pastFailed = $state(null);
  async function loadMates() { const r = await api("/api/documents/teammates"); matesFailed = r.ok ? null : (r.error ?? t("Your team could not be loaded.")); mates = r.ok ? ((r.json?.data ?? r.json)?.teammates ?? []) : []; }   // R13-D448: a failed read is not "no teammates"
  onMount(() => { if (!isTpl) loadMates(); });
  const me = $derived(mates.find((m) => m.you) ?? null);
  const isMate = (p) => p.internal === true || (Boolean(p.external_ref) && mates.some((m) => m.id === p.external_ref));
  const iAmIn = $derived(Boolean(me) && people.some((p) => p.external_ref === me.id || (p.email ?? "").toLowerCase() === me.email.toLowerCase()));
  const addMyself = () => { if (me) pickPast({ id: me.id, name: me.name, email: me.email }); };
  onMount(() => { if (!isTpl) loadPlan(); });
  let moreFor = $state(null);
  const inSeat = (role) => people.filter((p) => p.role === role);
  const firstOfSeat = (i) => people.findIndex((p) => p.role === people[i].role) === i;
  const startGroup = (i) => { const p = people[i]; const label = p.group_label || t("{name}'s group", { name: p.name || t("Signer") }); send(people.map((q) => (q.role === p.role ? { ...q, group_label: label } : q))); };
  const addMember = (i) => { const p = people[i]; send([...people.slice(0, i + 1), { role: p.role, action_role: "signer", name: "", email: null, group_label: p.group_label, ...(p.witness_required ? { witness_required: true } : {}), step: p.step ?? null }, ...people.slice(i + 1)]); focusRow(i + 1); };
  const renameGroup = (role, label) => send(people.map((q) => (q.role === role ? { ...q, group_label: label.trim() || q.group_label } : q)));
  const endGroup = (role) => { const keep = people.findIndex((p) => p.role === role); send(people.filter((p, k) => p.role !== role || k === keep).map((q) => (q.role === role ? { ...q, group_label: null } : q))); };
  const toggleInPerson = (role) => { const s = new Set(inPerson); s.has(role) ? s.delete(role) : s.add(role); onChange({ sendOptions: { ...doc.sendOptions, in_person: [...s] } }); };
  const setPlays = (role, v) => onChange({ sendOptions: { ...doc.sendOptions, plays: { ...plays, [role]: v } } });
  const roleOptions = ACTION_ROLES.map((r) => ({ value: r.id, label: tl(r.label) }));
  const orderOptions = SIGNING_ORDERS.map((o) => ({ value: o.id === "all" ? "parallel" : o.id, label: tl(o.label) }));
  const stepOptions = $derived(people.map((_, i) => ({ value: String(i + 1), label: String(i + 1) })));
  const roleLabel = (p) => (mode === "use" ? (doc.body?.roles ?? []).find((r) => r.key === p.role)?.label : mode === "flow" && p.roleWord && p.roleWord !== (p.name ?? "").trim() ? p.roleWord : null);
  const signers = $derived(people.filter((p) => (p.action_role ?? "signer") === "signer"));
  const colour = (i) => SEAT_COLOURS[i % SEAT_COLOURS.length];
  const initials = (p, i) => (p.name || "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || String(i + 1);
  const turns = $derived.by(() => {   // the circles: who goes when
    const acting = people.map((p, i) => ({ p, i })).filter(({ p }) => ["signer", "approver"].includes(p.action_role ?? "signer"));
    if (order !== "sequential") return [acting];
    const by = new Map(); for (const x of acting) { const k = x.p.step ?? x.i + 1; by.set(k, [...(by.get(k) ?? []), x]); }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  });
  async function startDraft() {
    const name = draft.name.trim(), email = draft.email.trim(); if (!name && !email) return;
    add({ name, email: email || null }); draft = { name: "", email: "" };
    await focusRow(0);
  }
  async function focusRow(i) { await tick(); const el = document.querySelectorAll("[data-testid=person-name]")[i]; if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); } }
  async function addBlank() { add({ name: "" }); await focusRow(people.length); }
  async function loadPast() { pastOpen = true; const r = await api(`/api/documents/pdf/recipients?q=${encodeURIComponent(q)}`); pastFailed = r.ok ? null : (r.error ?? t("Contacts and your team could not be loaded.")); found = r.ok ? (r.json ?? []).slice(0, 12) : []; }   // R13-D448: a failed read is not "Nobody to show yet."
  $effect(() => { if (!pastOpen) return; clearTimeout(timer); timer = setTimeout(loadPast, 250); void q; });
</script>
<Page type="split" asideWidth="22rem" testid="people-step">
  <section aria-label={isTpl ? t("Roles in this template") : t("People on this document")} class="space-y-2">
    <div class="flex flex-wrap items-center gap-3 border-b border-line py-3" data-testid="sender-row">
      <span class="inline-grid size-7 place-items-center rounded-full bg-ink text-xs text-white" aria-hidden="true"><FlowIcon name="lock" size={13} /></span>
      <span class="font-medium">{tl(SENDER_ROW.label)}</span>
      <span class="chip">{tl(SENDER_ROW.role)}</span>
      <span class="text-xs text-mute">{t("The parts you fill in before sending.")}</span>
    </div>
    <ol class="space-y-2" data-testid="people-list">
      {#each people as p, i (`${p.role}#${i}`)}
        <li class="flex flex-wrap items-center gap-2 border-b border-line py-3" data-testid="person-row">
          <span class="inline-block size-3.5 flex-none rounded-full" style="background:{colour(i)}" aria-hidden="true"></span>
          <input class="field min-w-32 flex-1 basis-36 !py-1.5" value={p.name} placeholder={isTpl ? t("Role, such as Client") : (p.roleWord || t("Name"))} oninput={(e) => patch(i, { name: e.currentTarget.value })} aria-label={isTpl ? t("Role {n}", { n: i + 1 }) : t("Name of person {n}", { n: i + 1 })} data-testid="person-name" />
          {#if roleLabel(p)}<span class="chip" data-testid="person-rolelabel">{roleLabel(p)}</span>{/if}
          {#if !isTpl || plays[p.role] === "fixed"}<input class="field min-w-40 flex-[1.4] basis-44 !py-1.5" value={p.email ?? ""} placeholder={inPerson.has(p.role) ? t("Not needed") : t("Email")} oninput={(e) => typeEmail(i, e.currentTarget.value)} onblur={(e) => leaveEmail(i, p.role, e.currentTarget.value)} aria-invalid={emailBad(p)} aria-label={t("Email of person {n}", { n: i + 1 })} data-testid="person-email" />{/if}
          {#if isTpl}<div class="w-52"><Pick options={[{ value: "you", label: t("You") }, { value: "at_send", label: t("Chosen when you send it") }, { value: "fixed", label: t("A fixed person") }]} value={plays[p.role] ?? "at_send"} onchange={(v) => setPlays(p.role, v)} testid="person-plays" /></div>{/if}
          <div class="w-44"><Pick options={roleOptions} value={p.action_role ?? "signer"} label={t("Role for {name}", { name: p.name || t("this person") })} hideLabel onchange={(v) => { const c = { action_role: v, assists_role: v === "assistant" ? (signers.find((s) => s.role !== p.role)?.role ?? null) : null }; if (v === "assistant" && order !== "sequential") { orderNote = t("Signing order is now one after another, because an assistant helps someone before they sign. Choose Everyone at once again once nobody is an assistant."); send(people.map((q, k) => (k === i ? { ...q, ...c } : q)), { ...doc.sendOptions, order: "sequential" }); } else patch(i, c); }} testid="person-role" /></div>
          {#if p.action_role === "assistant"}<div class="w-44"><Pick options={signers.filter((s) => s.role !== p.role).map((s) => ({ value: s.role, label: t("Helps {name}", { name: s.name || t("them") }) }))} value={p.assists_role ?? ""} onchange={(v) => patch(i, { assists_role: v })} placeholder={t("Choose a signer")} testid="person-helps" /></div>{/if}
          {#if order === "sequential"}<div class="w-20"><Pick options={stepOptions} value={String(p.step ?? i + 1)} label={t("Signing step for {name}", { name: p.name || t("this person") })} hideLabel onchange={(v) => patch(i, { step: Number(v) })} testid="person-step" /></div>{/if}
          {#if !isTpl}<label class="flex items-center gap-1 text-xs text-mute"><input type="checkbox" checked={inPerson.has(p.role)} onchange={() => toggleInPerson(p.role)} /> {t("on this device")}</label>{/if}
          {#if p.group_label}<span class="chip" data-testid="person-group">{p.group_label}</span>{/if}
          {#if p.witness_required}<span class="chip" data-testid="person-witness-chip">{t("Has a witness")}</span>{/if}
          {#if !isTpl && (p.action_role ?? "signer") === "signer" && firstOfSeat(i)}<button class="btn quiet !min-h-9 !px-2 text-xs" aria-expanded={moreFor === p.role} onclick={() => (moreFor = moreFor === p.role ? null : p.role)} data-testid="person-more">{t("More")}</button>{/if}
          {#if moreFor === p.role && firstOfSeat(i)}
            <div class="order-last w-full space-y-2 rounded-lg bg-tint p-2 text-sm" data-testid="person-more-panel">
              <label class="flex items-center gap-2"><input type="checkbox" checked={p.witness_required === true} onchange={(e) => send(people.map((q) => (q.role === p.role ? { ...q, witness_required: e.currentTarget.checked || undefined } : q)))} data-testid="person-witness" /> {t("A witness signs straight after them, on the same device")}</label>
              <ProLock item="signing_groups" tip={t("A signing group lets several people share one signing spot: whoever signs first signs for everyone.")} testid="prolock-signing-groups">{#snippet children(locked)}
                {#if !p.group_label}<button class="btn !min-h-9 !py-1 text-xs" disabled={locked} onclick={() => startGroup(i)} data-testid="person-group-start">{t("Let anyone in a group sign this")}</button>
                {:else}<div class="flex flex-wrap items-center gap-2"><input class="field !w-48 !py-1 text-xs" value={p.group_label} maxlength="80" onchange={(e) => renameGroup(p.role, e.currentTarget.value)} aria-label={t("Group name")} data-testid="person-group-name" /><button class="btn !min-h-9 !py-1 text-xs" disabled={locked} onclick={() => addMember(i + inSeat(p.role).length - 1)} data-testid="person-group-add">{t("Add someone to the group")}</button><button class="btn quiet !min-h-9 !py-1 text-xs" onclick={() => endGroup(p.role)} data-testid="person-group-end">{t("Stop using a group")}</button></div>
                  <p class="text-xs text-mute">{t("Each person in the group gets their own link. The first to sign fills the signing spot and the others' links stop working.")}</p>{/if}
              {/snippet}</ProLock>
            </div>
          {/if}
          {#if emailBad(p)}<p class="order-last w-full text-sm text-bad" data-testid="person-email-error">{t("This email looks incomplete")}</p>{/if}
          {#if !isTpl && isMate(p)}<span class="chip" data-testid="person-team-tag" title={t("A teammate. They get the same signing email, and a notice in the app.")}>{t("Team")}</span>{/if}
          <button class="btn !min-h-10 ml-auto" onclick={() => remove(i)} aria-label={t("Remove {name}", { name: p.name || t("this person") })} data-testid="person-remove"><FlowIcon name="x" size={16} /></button>
        </li>
      {/each}
      {#if people.length === 0}
        <li class="flex flex-wrap items-center gap-2 border-b border-dashed border-line py-3" data-testid="person-draft">
          <span class="inline-block size-3.5 flex-none rounded-full" style="background:{colour(0)}" aria-hidden="true"></span>
          <input class="field !w-40 !py-1.5" bind:value={draft.name} placeholder={isTpl ? t("Role, such as Client") : t("Name")} oninput={startDraft} aria-label={t("Name of the first person")} data-testid="draft-name" />
        </li>
      {/if}
    </ol>
    <div class="flex flex-wrap gap-2 pt-1">
      <button class="btn !min-h-10" onclick={addBlank} data-testid="person-add-button"><FlowIcon name="user-plus" size={16} /> {isTpl ? t("Add a role") : t("Add person")}</button>
      {#if !isTpl}<button class="btn !min-h-10" onclick={loadPast} data-testid="past-signers">{t("Add from Contacts and your team")}</button>{#if me}<button class="btn !min-h-10" onclick={addMyself} disabled={iAmIn} data-testid="add-myself">{t("Add myself")}</button>{/if}{/if}
    </div>
    {#if matesFailed && !isTpl}<p class="text-sm" role="alert" data-testid="teammates-failed">{matesFailed} <button class="btn quiet" onclick={loadMates}>{t("Try again")}</button></p>{/if}
    {#if pastOpen && !isTpl}
      <div class="border-y border-line py-3" data-testid="past-panel">
        <input class="field !py-1.5" bind:value={q} placeholder={t("Search by name or email")} aria-label={t("Search Contacts and your team")} data-testid="past-search" />
        <ul class="mt-2 space-y-1">{#each found as c}<li><button type="button" class="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-tint" onclick={() => { pickPast(c); pastOpen = false; q = ""; }} data-testid="past-pick">{c.name} <span class="text-xs text-mute">{c.email}</span>{#if c.team} <span class="chip" data-testid="past-team-tag">{t("Team")}</span>{/if}</button></li>{/each}
          {#if pastFailed}<li class="text-sm" role="alert" data-testid="past-failed">{pastFailed} <button class="btn quiet" onclick={loadPast}>{t("Try again")}</button></li>
          {:else if !found.length}<li class="text-sm text-mute">{t("Nobody to show yet.")}</li>{/if}</ul>
      </div>
    {/if}
  </section>
  {#snippet aside()}<div class="space-y-4">
    <div>
      <p class="mb-1 text-sm font-medium">{t("Signing order")}</p>
      <div class="flex gap-1" role="group" aria-label={t("Signing order")}>
        {#each orderOptions as o}<button class="btn !min-h-10 !px-3 {order === o.value ? 'primary' : ''}" aria-pressed={order === o.value} onclick={() => { orderNote = null; onChange({ sendOptions: { ...doc.sendOptions, order: o.value }, parties: people.map(strip) }); }} data-testid={`order-${o.value}`}>{o.label}</button>{/each}
      </div>
      {#if orderNote && order === "sequential" && people.some((p) => p.action_role === "assistant")}<p class="mt-2 text-xs text-warn" role="status" data-testid="order-note">{orderNote}</p>{/if}
      <div class="mt-3 flex items-center gap-1.5" data-testid="order-diagram" aria-hidden="true">
        {#each turns as turn, ti}
          {#if ti > 0}<span class="text-mute">→</span>{/if}
          <span class="inline-flex flex-col gap-1">{#each turn as x}<span class="inline-grid size-8 place-items-center rounded-full text-xs font-semibold text-white" style="background:{colour(x.i)}">{initials(x.p, x.i)}</span>{/each}</span>
        {/each}
        {#if !turns.flat().length}<span class="text-xs text-mute">{t("Add people to see the order.")}</span>{/if}
      </div>
      {#if !people.length || people.some((p) => !inPerson.has(p.role))}<p class="mt-2 text-xs text-mute" data-testid="people-order-line">{order === "sequential" ? t("The next person is emailed when the one before them has signed.") : t("Everyone is emailed straight away.")}</p>{/if}
    </div>
  </div>{/snippet}
</Page>
