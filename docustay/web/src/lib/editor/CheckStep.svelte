<script>
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { loadPdf } from "$lib/pdf.js";
  import PdfPage from "$lib/PdfPage.svelte";
  import { seatColour } from "./fields.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Pick from "$lib/ui/Pick.svelte";
  import { previewHtml } from "$lib/flow/flowPreview.js";
  import { signedCopyEmail } from "$lib/flow/afterSigning.js";
  import { checkText } from "./checkStrings.js";
  let { doc, fileUrl, attempted = false, onRefresh = null, onfix = null } = $props();
  // Run 9 — THE CHECK BEFORE SENDING (board "ScribeAct"): four rows from the server (src/documents/sendCheck.mjs), each green or the problems with "Fix" (the step, and the box) and "Show me" (the place on the page)
  let pre = $state(null), spot = $state(null);
  async function loadPre() { const r = await api(`/api/documents/pdf/${doc.id}/send-check`); pre = r.ok ? (r.json?.data ?? r.json) : null; }
  $effect(() => { void doc.updatedAt; void doc.sendOptions; loadPre(); });
  function showMe(sh) { view = "signing"; spot = sh; setTimeout(() => document.querySelector(`[data-testid="check-page"][data-page="${sh.page}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60); }
  const SAMPLE = { signature: "Jane Sample", initials: "JS", date_signed: "October 3, 2026", text: "Sample text", checkbox: "✕", dropdown: "Option", image: "▣" };
  let viewer = $state(doc.senderView ? "sender" : (doc.parties?.find((p) => p.action_role === "signer")?.role ?? "sender"));
  const senderOnly = $derived(doc.senderView?.sectionsHidden ?? 0);
  const viewerOpts = $derived([{ value: "sender", label: t("Sender") }, ...(doc.parties ?? []).map((p) => ({ value: p.role, label: p.name || doc.body?.roles?.find((r) => r.key === p.role)?.label || t("Person") }))]);
  const senderSrc = $derived(doc.senderView ? previewHtml(doc.senderView.html ?? "", { view: "see_it", roles: (doc.parties ?? []).map((p) => p.name), title: doc.title }) : "");
  const certSrc = $derived(previewHtml("", { view: "after_signing", roles: signers.map((x) => x.name), title: doc.title, hash: doc.originalSha256 ?? "" }));
  const copy = $derived(signedCopyEmail({ title: doc.title, practiceName: doc.senderView?.practiceName ?? "", recipientName: signers[0]?.name ?? "" }));
  let view = $state("signing"), pdf = $state(null), msg = $state(null), busy = $state(false);
  const signers = $derived((doc.parties ?? []).filter((p) => p.action_role === "signer"));
  let seat = $state(doc.parties?.find((p) => p.action_role === "signer")?.role ?? "signer_1");
  const items = $derived(doc.checklist?.items ?? []);
  const w = Math.min(560, typeof window === "undefined" ? 560 : innerWidth - 48);
  onMount(async () => { try { const r = await fetch(fileUrl, { credentials: "same-origin" }); if (r.ok) pdf = await loadPdf(await r.arrayBuffer()); } catch { /* shown below */ } });
  // What Send will refuse for the workspace rather than the document: Stripe not connected for a payment box, and a repeating payment on the Free plan. The server collects them at Send; these are shown before it.
  let pay = $state(null), plan = $state(null);
  onMount(async () => { const [a, b] = await Promise.all([api("/api/product/docustay/payments"), api("/api/product/docustay/status")]); pay = a.ok ? a.json : null; plan = b.ok ? (b.json?.data ?? b.json) : null; });
  const payFields = $derived((doc.body?.fields ?? []).filter((f) => f.type === "payment"));
  const wsProblems = $derived([
    ...(payFields.length && pay?.stripeAvailable && pay.state !== "connected" ? [pay.state === "needs_attention" ? t("This document has a payment box, and Stripe is connected but needs information from you. Finish it in Settings, Payments, or keep the payment terms as text.") : t("This document has a payment box, but Stripe is not connected for this workspace. Connect Stripe in Settings, Payments, or keep the payment terms as text.")] : []),
    ...(payFields.some((f) => f.plan) && plan?.billing?.canUpgrade === true ? [t("Installments and subscriptions are part of Docustay Pro. Upgrade in Billing, or use a one-time payment, a deposit or an amount the signer chooses.")] : []),
  ]);
  let reviewBusy = $state(false);
  async function markRead() { reviewBusy = true; const r = await api("/api/documents/chat/review", { method: "POST", body: { documentId: doc.id } }); reviewBusy = false; if (r.ok) onRefresh?.(); else msg = r.error ?? t("That did not work."); }
  async function sendTest() { busy = true; msg = null; const r = await api("/api/documents/pdf/test", { method: "POST", body: { instanceId: doc.id, seat } }); busy = false; msg = r.ok ? t("A test email is on its way to you.") : (r.error ?? t("The test could not be sent.")); }
</script>
<div class="grid gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]" data-testid="check-step">
  <section aria-label={t("Checklist")} class="space-y-3">
    {#if pre?.rows?.length}
      <div class="pre" data-testid="send-check" data-ok={pre.ok ? "true" : "false"}>
        <div class="font-mono text-[.7rem] uppercase tracking-wider text-brand">{t("Check before sending")}</div>
        <ul class="grid gap-2">{#each pre.rows as r, i (i)}
          <li class="flex items-start gap-2 text-sm {r.ok ? '' : 'text-warn'}" data-testid="send-check-row" data-kind={r.kind} data-ok={r.ok ? "true" : "false"}>
            <span class="dot {r.ok ? 'ok' : 'bad'}" aria-hidden="true">{r.ok ? "✓" : "!"}</span>
            <span class="min-w-0">{r.documentTitle ? `${r.documentTitle}: ` : ""}{checkText(r, t)}{#if !r.ok && r.fix && onfix}{" "}<button type="button" class="link" data-testid="send-check-fix" onclick={() => onfix(r.fix)}>{t("Fix")}</button>{/if}{#if !r.ok && r.show}{" "}<button type="button" class="link" data-testid="send-check-show" onclick={() => showMe(r.show)}>{t("Show me")}</button>{/if}</span>
          </li>{/each}</ul>
      </div>
    {/if}
    {#if wsProblems.length}<ul class="space-y-1.5" data-testid="check-workspace-problems">{#each wsProblems as w}<li class="flex gap-2 text-sm text-bad" data-ok="false"><span aria-hidden="true">✗</span><span>{w}</span></li>{/each}</ul>{/if}
    <ul class="space-y-1.5" data-testid="check-list">{#if senderOnly}<li class="flex gap-2 text-sm" data-ok="true" data-testid="check-sender-only"><span aria-hidden="true">✓</span><span>{t("{n} Sender only blocks are not in what signers see, sign or receive.", { n: senderOnly })}</span></li>{/if}{#each items as it}<li class="flex gap-2 text-sm {it.ok ? '' : it.severity === 'warning' || !attempted ? 'text-warn' : 'text-bad'}" data-ok={it.ok} data-testid="check-item"><span aria-hidden="true">{it.ok ? "✓" : it.severity === "warning" || !attempted ? "!" : "✕"}</span><span>{checkText(it, t)}{#if !it.ok && it.fix && onfix}{" "}<button type="button" class="link" data-testid="check-item-fix" onclick={() => onfix(it.fix)}>{t("Fix")}</button>{/if}{#if it.upgrade}{" "}<a class="font-medium underline" href="/billing" data-testid="check-upgrade">{t("Upgrade in Billing")}</a>{/if}{#if it.code === "ai_review"} <button type="button" class="btn !py-1 !text-sm ml-1" disabled={reviewBusy} onclick={markRead} data-testid="check-ai-read">{t("I have read it")}</button>{/if}</span></li>{/each}</ul>
    <div class="space-y-2">
      <div class="flex gap-2"><button class="btn !py-1.5 !text-sm {view === 'signing' ? 'primary' : ''}" onclick={() => (view = "signing")}>{t("As they will see it")}</button><button class="btn !py-1.5 !text-sm {view === 'signed' ? 'primary' : ''}" onclick={() => (view = "signed")}>{t("As signed")}</button><button class="btn !py-1.5 !text-sm {view === 'after' ? 'primary' : ''}" onclick={() => (view = "after")} data-testid="check-view-after">{t("After signing")}</button></div>
      <Pick options={viewerOpts} value={viewer} onchange={(v) => { viewer = v; if (v !== "sender") seat = v; }} label={t("View as")} testid="check-viewas" />
      
      <button class="btn !text-sm" disabled={busy} onclick={sendTest} data-testid="check-test">{t("Send me a test email")}</button>{#if msg}<p class="text-xs text-mute" role="status">{msg}</p>{/if}</div>
  </section>
  <section class="max-h-[560px] space-y-3 overflow-auto rounded-xl border border-line bg-tint p-3" data-testid="preview-{view}">
    {#if view === "after"}
      <div class="rounded bg-white p-3 text-sm text-black" data-testid="check-after-email">
        <p class="text-xs text-neutral-500">{t("When the last person signs, everyone gets the sealed PDF by email:")}</p>
        <p class="mt-1"><b>{t("To")}:</b> {[...signers.map((x) => x.name || x.email), t("you")].join(", ")}</p>
        <p><b>{t("Subject")}:</b> <span data-testid="check-after-subject">{copy.subject}</span></p>
        <pre class="mt-2 whitespace-pre-wrap font-sans">{copy.body}</pre>
        <p class="mt-2 inline-flex items-center gap-1.5 rounded border border-neutral-300 px-2 py-1" data-testid="check-after-attachment">📎 {copy.attachment}</p>
        <p class="mt-2 text-xs text-neutral-500">{t("Standard wording. You can change it under Settings, Email.")}</p>
      </div>
      <p class="text-xs text-mute">{t("The sealed PDF ends with this certificate of completion:")}</p>
      <iframe title={t("After signing")} class="h-[500px] w-full rounded bg-white" sandbox="" srcdoc={certSrc} data-testid="check-cert-frame"></iframe>
    {:else if viewer === "sender" && doc.senderView}<p class="text-xs text-mute" data-testid="check-sender-note">{t("This is your view. Signers do not see the Sender only parts.")}</p><iframe title={t("Sender view")} class="h-[500px] w-full rounded bg-white" sandbox="" srcdoc={senderSrc} data-testid="check-sender-frame"></iframe>
    {:else if !pdf}<p class="p-6 text-center text-mute">{t("Loading pages…")}</p>{:else}
      {#each Array.from({ length: doc.body.file.page_count }, (_, i) => i + 1) as n}
        <div data-testid="check-page" data-page={n}><PdfPage {pdf} pageNumber={n} width={w}>
          {#if spot?.page === n && view === "signing"}<div class="spot" data-testid="check-spot" style="left:{spot.x * 100}%;top:{spot.y * 100}%;width:{Math.max(spot.w, 0.04) * 100}%;height:{Math.max(spot.h, 0.02) * 100}%"></div>{/if}
          {#each doc.body.fields.filter((f) => f.page === n) as f (f.id)}
            <div class="absolute flex items-center overflow-hidden whitespace-nowrap px-1 text-xs" data-testid="check-box" title={f.role === seat ? (f.label || f.type) : undefined} style="left:{f.x * 100}%;top:{f.y * 100}%;width:{f.w * 100}%;height:{f.h * 100}%;{view === 'signed' ? `color:#1e1b4b;font-family:${f.type === 'signature' ? 'cursive' : 'inherit'}` : f.role === seat ? `background:${seatColour(f.role)}22;border:1.5px solid ${seatColour(f.role)};color:${seatColour(f.role)}` : 'border:1px dashed #ccc'}"><span class="truncate">{view === "signed" ? SAMPLE[f.type] ?? "" : f.role === seat ? `${f.label || f.type}${f.required ? " *" : ""}` : ""}</span></div>
          {/each}
        </PdfPage></div>
      {/each}{/if}
  </section>
</div>
<style>
  .pre { display: grid; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
  .dot { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; font-size: 11px; font-weight: 700; color: #fff; margin-top: 1px; } .dot.ok { background: var(--brand); } .dot.bad { background: var(--warn); }
  .link { color: var(--brand); text-decoration: underline; font-weight: 500; }
  .spot { position: absolute; z-index: 2; border: 2px solid var(--warn); border-radius: 4px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--warn) 25%, transparent); pointer-events: none; animation: spot 900ms ease-out 2; }
  @keyframes spot { 50% { box-shadow: 0 0 0 9px color-mix(in srgb, var(--warn) 10%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .spot { animation: none; } }
</style>
