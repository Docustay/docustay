<script>
  import Building from "$lib/fx/Building.svelte";
  import { onMount, onDestroy } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import GuidedForm from "./GuidedForm.svelte";
  import Pick from "$lib/ui/Pick.svelte";
  import StripeGate from "./StripeGate.svelte";
  import JobSteps from "./JobSteps.svelte";
  import AiUsageBar from "./AiUsageBar.svelte";
  import PromptBox from "$lib/ui/PromptBox.svelte";
  import { handleRefusal } from "$lib/pro/planPrompt.svelte.js";
  import { aiUsage } from "./usage.svelte.js";
  let stage = $state("queued");
  import { WIZARD_UNIVERSAL, WIZARD_TYPES, WIZARD_FINAL_QUESTION, WIZARD_PAYMENT, PAYMENT_CURRENCIES, AGENT_KINDS, AGENT_DEFAULT_NAME } from "$lib/flow/flowDefinition.js";

  // `questions` shows the questionnaire (a kind of document, who writes it, the questions); otherwise the Scribe prompt box: say what you need in your own words (the server takes a plain `prompt`)
  let { mode = "template", onopen, onguided = null, seed = $bindable(null), questions: askQuestions = false, onattach = null, ontemplate = null } = $props();
  // R13-D391: the questions form returns a finished source, not a job id, so it opens through its own handler (onopen takes a job id: given a source it built "job=[object Object]")
  let promptText = $state("");
  // an example link on New document fills the form (a kind of document and a first answer); nothing is sent until the person presses the button
  $effect(() => { if (seed) { if (seed.type) typeId = seed.type; if (seed.answers) answers = { ...answers, ...seed.answers }; if (seed.answers?.purpose) promptText = seed.answers.purpose; if (seed.final) final = seed.final; seed = null; } });

  const BASE = "/api/documents/engine";
  let status = $state(null);
  let typeId = $state(""), kindId = $state("plain"), answers = $state({}), final = $state("");
  let payOn = $state(false), pay = $state({ amount: "", currency: "usd", payer_role: "", description: "", schedule_note: "" });
  const payMissing = $derived(payOn && (!/^\d{1,8}(\.\d{1,2})?$/.test(pay.amount.trim().replace(/^[$€£]/, "").replace(/,/g, "")) || !pay.description.trim()));
  // not connected → keep the typed terms as plain text in the money answer, and collect nothing in the document
  function textOnly() { const line = `${pay.amount} ${pay.currency.toUpperCase()}, ${pay.description}${pay.schedule_note ? `. ${pay.schedule_note}` : ""}`; answers = { ...answers, money: [answers.money, line].filter(Boolean).join("\n") }; payOn = false; }
  let phase = $state("idle"); // idle | running | done | failed
  let job = $state(null);
  let jobId = $state("");
  let error = $state("");
  let showGuided = $state(false);
  const flagged = $derived(job?.patches?.validator?.problems ?? []);
  let timer = null;
  let alive = true;


  onMount(async () => {
    const r = await api(`${BASE}/ai/status`);
    status = r.ok ? (r.json?.data ?? r.json) : { enabled: false };
  });
  onDestroy(() => { alive = false; if (timer) clearTimeout(timer); });

  const type = $derived(WIZARD_TYPES.find((x) => x.id === typeId) ?? null);
  const questions = $derived(type ? [...WIZARD_UNIVERSAL, ...type.pack].filter((q) => q.key !== "language") : []);   // Docustay v1: English only, so the shared flow definition's language question is not asked
  const agent = $derived(status?.agentName || AGENT_DEFAULT_NAME);
  const missingAll = $derived(questions.filter((q) => q.required && !(answers[q.key] ?? q.default ?? "").toString().trim()));   // D-017: every missing answer is named, not one at a time
  const missing = $derived(missingAll[0]);
  const ready = $derived(Boolean(type) && !missing && !payMissing && final.trim().length >= 10);
  const title = $derived(job?.patches?.title || t("Draft"));
  const notes = $derived(job?.patches?.notes ?? []);
  const assumed = $derived(job?.patches?.assumptions ?? []), openQ = $derived(job?.patches?.open_questions ?? []), careful = $derived(job?.patches?.careful ?? []);

  function textOf(n) {
    if (!n) return "";
    if (n.type === "text") return n.text ?? "";
    if (n.type === "hardBreak") return " ";
    if (n.type === "variableChip") return `[${n.attrs?.label || n.attrs?.name || ""}]`;
    if (n.type === "fieldTag") return `[${n.attrs?.label || n.attrs?.name || ""}]`;
    return (n.content ?? []).map(textOf).join("");
  }
  const preview = $derived.by(() => {
    const lines = [];
    for (const b of job?.source?.content ?? []) {
      if (b.type === "heading" || b.type === "paragraph") {
        const s = textOf(b).trim();
        if (s) lines.push({ h: b.type === "heading", s });
      }
      if (lines.length >= 40) break;
    }
    return lines;
  });

  function poll(started) {
    timer = setTimeout(async () => {
      if (!alive || phase !== "running" || !jobId) return;
      if (Date.now() - started > 420000) { phase = "failed"; job = { message: t("This is taking too long. Try again, or build it with questions instead.") }; return; }
      const r = await api(`${BASE}/ai/jobs/${jobId}`);
      if (phase !== "running") return;   // cancelled while the answer was on its way
      if (!alive) return;
      if (!r.ok) { phase = "failed"; job = { message: r.error ?? "" }; return; }
      const j = r.json?.data ?? r.json;
      stage = j.stage ?? stage;
      if (j.state === "done") { job = j; phase = "done"; refreshStatus(); return; }
      if (j.state === "failed") { job = j; phase = "failed"; return; }
      if (j.state === "cancelled") { phase = "idle"; return; }
      poll(started);
    }, 1500);
  }
  async function refreshStatus() {
    const r = await api(`${BASE}/ai/status`);
    if (r.ok) status = r.json?.data ?? r.json;
  }

  async function write() {
    error = ""; job = null;
    const r = await api(`${BASE}/ai/jobs`, { method: "POST", body: { brief: { type: typeId, kind: kindId, answers: Object.fromEntries(questions.map((q) => [q.key, (answers[q.key] ?? q.default ?? "").toString()])), final: final.trim(), ...(payOn ? { payment: { collect: true, ...pay } } : {}) }, mode, vocabulary: "docustay", kind: "draft" } });
    if (!r.ok) { phase = "idle"; if (await handleRefusal(r, { action: "ai_draft" })) return; error = r.error ?? ""; return; }
    jobId = (r.json?.data ?? r.json).jobId;
    phase = "running"; stage = "queued";
    poll(Date.now());
  }
  async function writePrompt(text) {
    error = ""; job = null;
    const r = await api(`${BASE}/ai/jobs`, { method: "POST", body: { prompt: text, mode, vocabulary: "docustay", kind: "draft" } });
    if (!r.ok) { phase = "idle"; if (await handleRefusal(r, { action: "ai_draft" })) return; error = r.error ?? ""; return; }
    jobId = (r.json?.data ?? r.json).jobId;
    phase = "running"; stage = "queued";
    poll(Date.now());
  }
  async function cancel() {   // P10-D-8: the screen stops at once; the server is told after (a late poll answer is ignored because the phase is idle)
    if (timer) clearTimeout(timer);
    const id = jobId; phase = "idle"; jobId = null;
    api(`${BASE}/ai/jobs/cancel`, { method: "POST", body: { jobId: id } }).catch(() => {});
  }
  function again() { phase = "idle"; job = null; error = ""; }
  // what the person did with the draft goes to the AI activity log (counts only, never the text)
  const logDraft = (accepted, rejected) => { if (jobId) api(`${BASE}/ai/outcome`, { method: "POST", body: { jobId, accepted, rejected } }); };
  const kinds = $derived(AGENT_KINDS.filter((k) => !status?.agentKinds?.length || status.agentKinds.includes(k.id)));
  $effect(() => { if (kinds.length && !kinds.some((k) => k.id === kindId)) kindId = kinds[0].id; });
</script>

<div class="grid gap-3" data-testid="describe-panel">
  {#if status && (!status.enabled || status.allowDraft === false)}   <!-- D-084: say so up front instead of after the form is filled in -->
    <div class="notice warn" data-testid="ai-off">
      {!status.enabled ? t("AI drafting is switched off for this workspace") : t("Writing a new document with AI is switched off for this workspace")}.
      <a href="/settings?tab=ai" class="underline">{t("Open the AI settings")}</a>
    </div>
    <GuidedForm onopen={onguided} />
  {:else if !askQuestions && phase === "idle"}
    <div class="grid gap-3" data-testid="describe-prompt">
      <PromptBox bind:value={promptText} hint={t("Usually under a minute")} onsubmit={writePrompt} {onattach} {ontemplate} testid="ai-prompt" />
      <div class="grid gap-2" data-testid="ai-meter"><AiUsageBar compact preClick /></div>
      {#if error}<div class="notice warn" role="alert" data-testid="ai-error">{error}</div>{/if}
    </div>
  {:else}
    <div class="rounded-[10px] border border-line-strong p-4 grid gap-3" data-testid="describe-card">
      {#if askQuestions}<div class="text-[13px] text-mute">{t("Answer a few questions and {name} writes a draft", { name: agent })}</div>{/if}
      {#if (phase === "idle" || phase === "failed") && askQuestions}
        <div class="grid gap-3 sm:grid-cols-2">
          <Pick options={WIZARD_TYPES.map((x) => ({ value: x.id, label: tl(x.label) }))} value={typeId} onchange={(v) => (typeId = v)} label={t("What kind of document is it?")} placeholder={t("Choose one")} testid="ai-type" />
          <Pick options={kinds.map((k) => ({ value: k.id, label: tl(k.label), hint: tl(k.hint) }))} value={kindId} onchange={(v) => (kindId = v)} label={t("Who should write it?")} testid="ai-kind" />
        </div>
        {#if type}
          <div class="grid gap-3" data-testid="ai-questions">
            {#each questions as q (q.key)}
              <label class="grid gap-1 text-sm">
                <span class="font-medium">{tl(q.label)}{#if q.required} <span class="text-mute">*</span>{/if}</span>
                {#if q.hint}<span class="text-mute">{tl(q.hint)}</span>{/if}
                {#if q.type === "choice"}
                  <Pick options={q.options.map((o) => ({ value: o.value, label: tl(o.label) }))} value={answers[q.key] ?? q.default ?? ""} onchange={(v) => (answers[q.key] = v)} placeholder={t("Choose one")} testid={`ai-q-${q.key}`} />
                {:else if q.type === "longtext"}
                  <textarea class="field" rows="3" maxlength="1200" placeholder={q.placeholder ? tl(q.placeholder) : ""} bind:value={answers[q.key]} data-testid={`ai-q-${q.key}`}></textarea>
                {:else}
                  <input class="field" maxlength="1200" bind:value={answers[q.key]} data-testid={`ai-q-${q.key}`} />
                {/if}
              </label>
            {/each}
            <div class="grid gap-3 rounded-xl border border-line p-3" data-testid="ai-payment">
              <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" bind:checked={payOn} data-testid="ai-pay-on" /> {t("Collect a payment when this is signed")}</label>
              {#if payOn}
                {#each WIZARD_PAYMENT as q (q.key)}
                  <label class="grid gap-1 text-sm"><span class="font-medium">{tl(q.label)}{#if q.required} <span class="text-mute">*</span>{/if}</span>
                    {#if q.type === "currency"}<Pick options={PAYMENT_CURRENCIES.map((c) => ({ value: c, label: c.toUpperCase() }))} value={pay.currency} onchange={(v) => (pay.currency = v)} label="" testid="ai-pay-currency" />
                    {:else if q.type === "longtext"}<textarea class="field" rows="2" maxlength="300" bind:value={pay[q.key]} data-testid={`ai-pay-${q.key}`}></textarea>
                    {:else}<input class="field" maxlength="200" placeholder={q.placeholder ? tl(q.placeholder) : ""} bind:value={pay[q.key]} data-testid={`ai-pay-${q.key}`} />{/if}
                  </label>
                {/each}
                <StripeGate ontextonly={textOnly} testid="ai-pay-gate" />
              {/if}
            </div>
            <label class="grid gap-1 text-sm">
              <span class="font-medium">{tl(WIZARD_FINAL_QUESTION.label)} <span class="text-mute">*</span></span>
              <textarea class="field" rows="4" maxlength="2000" bind:value={final} data-testid="ai-final"></textarea>
            </label>
          </div>
        {/if}
        <div class="grid gap-2" data-testid="ai-meter"><AiUsageBar compact preClick /></div>
        <div class="flex items-center gap-3 flex-wrap">
          <button class="btn primary final" data-testid="ai-go" disabled={!ready} onclick={write}>{t("Draft it")}</button>
          {#if type && !ready}<span class="text-mute" data-testid="ai-need">{missing ? t("Still needed: {list}", { list: missingAll.map((q) => tl(q.label)).join(", ") }) : t("Answer the last question to go on.")}</span>{/if}
          {#if status?.limitPerDay}<span class="text-mute">{t("{used} of {max} drafts used today", { used: status.usedToday ?? 0, max: status.limitPerDay })}</span>{/if}
          {#if status?.limitPerMonth}<span class="text-mute">{t("{used} of {max} drafts used this month", { used: status.usedThisMonth ?? 0, max: status.limitPerMonth })}</span>{/if}
        </div>
        {#if error}
          <div class="notice warn" role="alert" data-testid="ai-error">{error}
            {#if !showGuided}<button class="underline" onclick={() => (showGuided = true)}>{t("Build it with questions instead")}</button>{/if}
          </div>
        {/if}
      {/if}

      {#if phase === "running"}
        <div class="grid gap-2" data-testid="ai-progress"><Building kind={mode === "form" ? "form" : "document"} label={t("{name} is writing your draft… this usually takes under a minute", { name: agent })} /><JobSteps {stage} testid="ai-steps" /></div>
        <div><button class="btn" style="min-height:40px" data-testid="ai-cancel" onclick={cancel}>{t("Cancel")}</button></div>
      {/if}

      {#if phase === "failed"}
        <div class="notice warn text-bad" role="alert" data-testid="ai-failed">{job?.message}</div>
        <div class="flex gap-3 items-center flex-wrap">
          <button class="btn" style="min-height:40px" data-testid="ai-retry" onclick={again}>{t("Try again")}</button>
          {#if !showGuided}<button class="underline" onclick={() => (showGuided = true)}>{t("Build it with questions instead")}</button>{/if}
        </div>
      {/if}

      {#if phase === "done" && job}
        <div class="grid gap-3" data-testid="ai-result">
          <div class="font-semibold" data-testid="ai-title">{title}</div>
          <div class="notice info" data-testid="ai-finished">{mode === "form" ? t("{name} finished your form. Review it, AI can make mistakes.", { name: job.patches?.agent?.name || agent }) : t("{name} finished your document. Review it, AI can make mistakes.", { name: job.patches?.agent?.name || agent })}</div>
          {#if flagged.length}<div class="notice warn grid gap-2" role="alert" data-testid="ai-flagged"><div class="font-medium">{t("{name} could not fix {n, plural, one {# problem} other {# problems}} in this draft. Fix them by hand, or try again.", { name: job.patches?.agent?.name || agent, n: flagged.length })}</div><ul class="list-disc pl-5" data-testid="ai-flagged-list">{#each flagged as f}<li>{f}</li>{/each}</ul></div>{/if}
          {#if assumed.length}<div><div class="font-medium">{t("What {name} assumed", { name: job.patches?.agent?.name || agent })}</div><ul class="list-disc pl-5" data-testid="ai-assumed">{#each assumed as n}<li>{n}</li>{/each}</ul></div>{/if}
          {#if openQ.length}<div><div class="font-medium">{t("Questions to settle")}</div><ul class="list-disc pl-5" data-testid="ai-open-questions">{#each openQ as n}<li>{n}</li>{/each}</ul></div>{/if}
          {#if careful.length}<div><div class="font-medium">{t("Check these carefully")}</div><ul class="list-disc pl-5" data-testid="ai-careful">{#each careful as n}<li>{n}</li>{/each}</ul></div>{/if}
          <div class="border border-line bg-tint rounded p-3 grid gap-2" style="max-height:320px;overflow:auto" data-testid="ai-preview">
            {#each preview as l}
              {#if l.h}<div class="font-semibold">{l.s}</div>{:else}<div>{l.s}</div>{/if}
            {/each}
          </div>
          <div class="flex gap-3 flex-wrap">
            <button class="btn primary" style="min-height:40px" data-testid="ai-open" onclick={() => { logDraft(1, 0); onopen?.(job.id, title); }}>{t("Open the draft to check it")}</button>
            <button class="btn quiet" style="min-height:40px" onclick={() => { logDraft(0, 1); again(); }}>{t("Start over")}</button>
          </div>
        </div>
      {/if}
    </div>
    {#if showGuided}<GuidedForm onopen={onguided} />{/if}
  {/if}
</div>
