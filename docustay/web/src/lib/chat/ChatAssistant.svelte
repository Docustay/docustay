<script>
  // THE ASSISTANT (Scribe): mounted ONCE in the signed-in layout (never on the signing pages or the public site), opened from the Ask bar, ⌘/Ctrl+I, the Plays page or `ds:open-assistant`.
  // Run 8 (the maintainer) — FOUR LAYOUTS, one conversation, a switcher at the top left of every one; the choice is kept in this panel's memory only, so it always opens in A:
  //   A · quiet column — 400px docked on the right; at 1024px and wider it pushes the page, whose card grids fold to two across (main[data-fold]); narrower, it lies over the page.
  //   B · floating sheet — 400×640 bottom-right, the page keeps its width; Shrink turns it into a dark pill that says what Scribe is doing.
  //   C · live build — a 360px column of steps; while Scribe is making a document or a form, the PAGE shows the work (LiveBuild). Otherwise it behaves like A.
  //   D · command bar — a 680px card over the middle of the page with the page dimmed (never blocking a click), one question with number keys, and a dark input bar.
  // A phone (640px and under) gets ONE full-screen sheet and no switcher. Changing layout reshapes the panel (FLIP, transform only); reduced motion: it changes at once.
  // Parts: ui/ (scrolling, shimmer, collapsible, steps, message box), Response.svelte (streamed markdown), DiffCard / ActionCard / QuestionCard (the cards), chat.svelte.js (state).
  import { onMount, tick, untrack } from "svelte";
  import { page } from "$app/state";
  import Icon from "$lib/ui/Icon.svelte";
  import { t, whenText } from "$lib/i18n/index.svelte.js";
  import { AGENT_DEFAULT_NAME } from "$lib/flow/flowDefinition.js";
  import { calm } from "$lib/fx/index.js";
  import { chat } from "./chat.svelte.js";
  import Response from "./Response.svelte";
  import DiffCard from "./DiffCard.svelte";
  import ActionCard from "./ActionCard.svelte";
  import QuestionCard from "./QuestionCard.svelte";
  import LayoutSwitch from "./LayoutSwitch.svelte";
  import LiveBuild from "./LiveBuild.svelte";
  import { stepLabel } from "./stepLabels.js";
  import StepsBlock from "./ui/StepsBlock.svelte";
  import PromptInput from "./ui/PromptInput.svelte";
  import AiUsageBar from "$lib/ai/AiUsageBar.svelte";
  import ThinkHarder from "$lib/ai/ThinkHarder.svelte";
  import { StickToBottom } from "./ui/stickToBottom.svelte.js";
  import { proSheet } from "$lib/pro/proSheet.svelte.js";
  import { botText } from "./cardWords.js";

  let input = $state(""), box = $state(null), log = $state(null), panel = $state(null), inner = $state(null), phone = $state(false), wide = $state(false), from = null, historyOpen = $state(false), copiedId = $state("");
  let layout = $state("A");                    // A | B | C | D — never stored (Ruling R1)
  let mainBox = $state({ left: 0, width: 0 }), live = $state(null), liveTimer = null;
  const stick = new StickToBottom();
  const name = $derived(chat.status?.agentName || AGENT_DEFAULT_NAME);
  const screen = $derived(`${page.url.pathname}${page.url.search}`.slice(0, 200));
  const usable = $derived(chat.status?.allowed !== false);
  const prompts = $derived.by(() => {
    const p = page.url.pathname, step = page.url.searchParams.get("step");
    if (/\/documents\/[^/]+\/edit/.test(p) && step === "check") return [t("Why can't I send this yet?"), t("Run the checks"), t("Show me the send card"), t("What can you do?")];
    if (/\/documents\/[^/]+\/edit/.test(p) || p.startsWith("/create/flow")) return [t("Make the wording friendlier"), t("Why can't I send this yet?"), t("Add a second signer"), t("What can you do?")];
    if (/^\/documents\/[^/]+$/.test(p)) return [t("Who has not signed yet?"), t("Remind the people who are waiting"), t("Summarise this document"), t("What can you do?")];
    if (p.startsWith("/templates")) return [t("Make me a test document from a template"), t("Make a template for a services agreement"), t("How do I use a template?"), t("What can you do?")];
    if (p.startsWith("/forms")) return [t("Make me a job application form"), t("Who has filled in my form?"), t("How do I share a form?"), t("What can you do?")];
    if (p.startsWith("/settings") || p.startsWith("/billing")) return [t("How do I connect Stripe?"), t("How do I send from my own domain?"), t("Where do I change my logo?"), t("What can you do?")];
    if (p.startsWith("/reports")) return [t("What is waiting on someone?"), t("What did I send last week?"), t("How much AI have I used?"), t("What can you do?")];
    return [t("Can you create a test document with signers ready to send?"), t("What is waiting on someone?"), t("How do I connect Stripe?"), t("What can you do?")];
  });
  // the shape this layout takes at this width
  const shape = $derived(phone ? "sheet" : layout === "B" ? "float" : layout === "D" ? "command" : "dock");
  const dockW = $derived(layout === "C" ? 360 : 400);
  // Run 10 (R10-21): with the assistant off for this workspace nothing is drawn, so nothing may be made room for (⌘I used to leave a 400 px blank column and a squeezed page)
  const present = $derived(chat.status === null || chat.status.enabled);
  const pushes = $derived(present && chat.open && shape === "dock" && wide);
  const shrunk = $derived(shape === "float" && chat.collapsed);
  const last = $derived(chat.messages.at(-1));
  const running = $derived(last?.streaming ? (last.steps.find((s) => s.state === "running") ?? null) : null);
  const statusText = $derived(!usable ? t("Unavailable") : running ? stepLabel(running.label) : chat.busy ? t("Working") : t("Ready"));
  const building = $derived(layout === "C" && !phone && live !== null);
  const lastQuestion = $derived(chat.messages.flatMap((m) => m.proposals ?? []).filter((p) => p.kind === "questions" && p.state === "proposed").at(-1) ?? null);
  const ARIA_BUSY = $derived(chat.busy ? "true" : "false");

  // the page gives a docked column room (A, C at 1024px and wider) and folds its card grids while it is narrow
  $effect(() => { document.documentElement.style.setProperty("--chat-dock", pushes ? `${dockW}px` : "0px"); });
  $effect(() => { const m = document.querySelector("main"); if (!m) return; if (pushes && mainBox.width && mainBox.width < 1040) m.setAttribute("data-fold", ""); else m.removeAttribute("data-fold"); });
  $effect(() => { if (log) { stick.attach(log); return () => stick.detach(); } });
  $effect(() => { if (chat.open && !shrunk) tick().then(() => box?.focus()); });
  // C's live build follows the step that is making something; it stays a moment after the step ends so the tick can be seen
  $effect(() => {
    const s = last?.steps?.find((x) => x.build) ?? null, st = s?.state, cur = untrack(() => live);
    if (s && st === "running") { if (!cur || cur.id !== s.id || cur.state !== "running") { clearTimeout(liveTimer); live = { build: s.build, state: "running", id: s.id }; } }
    else if (cur && s && s.id === cur.id && cur.state === "running") { live = { ...cur, state: st }; clearTimeout(liveTimer); liveTimer = setTimeout(() => { live = null; }, 2200); }
    else if (cur && !s && cur.state === "running") live = null;
  });
  async function open() { from = document.activeElement; layout = "A"; await chat.show(); }
  // Ruling (Run 8, the maintainer): the layout is never kept — EVERY opening starts in A, whoever opens it (the Ask bar and Plays call chat.show() directly, so open() alone did not cover them; Run 8 verify J4)
  let wasOpen = false;
  $effect(() => { const o = chat.open; if (o && !wasOpen) layout = "A"; wasOpen = o; });
  function close() { chat.close(); tick().then(() => { (from && document.contains(from) ? from : document.querySelector('[data-testid="chat-launcher"]'))?.focus?.(); }); }
  function toggle() { chat.open ? close() : open(); }
  // the panel reshapes: measure, change, play the difference back (transform only, so nothing on the page moves because of it)
  async function setLayout(k) {
    if (k === layout) return; const a = panel?.getBoundingClientRect(); chat.collapsed = false; layout = k; await tick(); const b = panel?.getBoundingClientRect();
    if (!a || !b || !b.width || !b.height || calm() || document.documentElement.hasAttribute("data-lite")) return;
    const ease = "cubic-bezier(.2,.8,.2,1)";
    panel.animate([{ transformOrigin: "0 0", transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` }, { transformOrigin: "0 0", transform: "none" }], { duration: 340, easing: ease });
    inner?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 120, easing: ease, fill: "backwards" });
  }
  async function send(text = input, { answer = false } = {}) {
    const v = String(text).trim(); if (!v) return; input = ""; historyOpen = false;
    const p = chat.send(v, screen, { answer }); await tick();
    const users = log?.querySelectorAll('[data-testid="chat-msg-user"]'); stick.bringIntoView(users?.[users.length - 1] ?? null); await p;
  }
  function global(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "/" || e.key.toLowerCase() === "i")) { e.preventDefault(); if (present) toggle(); }
    else if (e.key === "Escape" && chat.open && !e.defaultPrevented && !proSheet.open) { e.preventDefault(); if (historyOpen) historyOpen = false; else close(); }   // Escape on the Explore Pro sheet closes only the sheet
  }
  // the clickable questions come back as the person's next message
  async function answer(p, picks) { await chat.decide(p, "accept"); const text = (p.card?.questions ?? []).map((q, i) => `${q.question} → ${Array.isArray(picks[i]) ? picks[i].join(", ") : picks[i]}`).join("\n"); await send(text, { answer: true }); }
  async function copy(m) { try { await navigator.clipboard.writeText(botText(m)); copiedId = m.id; setTimeout(() => { if (copiedId === m.id) copiedId = ""; }, 1600); } catch { /* the text can still be selected */ } }
  async function showHistory() { historyOpen = !historyOpen; if (historyOpen) await chat.listConversations(); }
  async function pick(id) { historyOpen = false; await chat.resume(id); await tick(); stick.toLatest(); }
  async function attach(f) { const id = await chat.attach(f); if (id) await send(t("I attached a file called {name}. Make a document from it.", { name: f.name })); }
  const dateOf = (d) => { try { return whenText(d, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const leave = () => { if (phone) close(); };
  onMount(() => {
    const mq = matchMedia("(max-width: 640px)"), mw = matchMedia("(min-width: 1024px)"); const set = () => { phone = mq.matches; wide = mw.matches; }; set(); mq.addEventListener("change", set); mw.addEventListener("change", set);
    chat.loadStatus(); const askEvt = () => open(); window.addEventListener("ds:open-assistant", askEvt);
    // where the page is: C's live build covers exactly it, D centres over it, and the fold reads its width
    let ro = null; const watch = () => { const m = document.querySelector("main"); if (!m) return; const r = m.getBoundingClientRect(); mainBox = { left: r.left, width: r.width }; };
    const m = document.querySelector("main"); if (m && typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(watch); ro.observe(m); } watch(); addEventListener("resize", watch);
    return () => { mq.removeEventListener("change", set); mw.removeEventListener("change", set); window.removeEventListener("ds:open-assistant", askEvt); removeEventListener("resize", watch); ro?.disconnect(); clearTimeout(liveTimer); document.documentElement.style.removeProperty("--chat-dock"); document.querySelector("main")?.removeAttribute("data-fold"); };
  });
</script>
<svelte:window onkeydown={global} />
{#if chat.status === null || chat.status.enabled}
  {#if chat.open}
    {#if shape === "command"}<div class="dim" style="left:{mainBox.left}px;width:{mainBox.width}px" aria-hidden="true" data-testid="chat-dim"></div>{/if}
    {#if building}<LiveBuild build={live.build} phase={live.state} rect={{ left: mainBox.left, top: 0, width: mainBox.width, height: typeof innerHeight === "number" ? innerHeight : 800 }} onstop={() => chat.abort()} />{/if}
    {#if shrunk}
      <button bind:this={panel} type="button" class="pill-shrunk" data-testid="chat-panel" data-layout={layout} data-shape="shrunk" aria-label={t("Open {name}", { name })} onclick={() => (chat.collapsed = false)}>
        <span class="bdot" class:on={chat.busy} aria-hidden="true"></span><span class="truncate">{chat.busy ? t("Shrunk: {what}", { what: statusText }) : name}</span><Icon name="chevron" size={14} />
      </button>
    {:else}
    <div bind:this={panel} class="chat-panel {shape}" class:pushes class:lay-c={layout === "C"} style={shape === "dock" ? `width:${dockW}px` : shape === "command" ? `--cx:${mainBox.left + mainBox.width / 2}px;--cw:${Math.max(320, Math.min(680, (mainBox.width || 720) - 32))}px` : ""} role="dialog" aria-modal={phone ? "true" : "false"} aria-label={name} data-testid="chat-panel" data-layout={phone ? "phone" : layout} data-shape={shape} data-dock={shape === "dock" ? "docked" : "floating"}>
      <div class="inner" bind:this={inner}>
      <div class="card-top">
      <div class="chat-head">
        {#if !phone}<LayoutSwitch value={layout} onchange={setLayout} />{/if}
        {#if building}
          <div class="grow min-w-0"><div class="font-semibold leading-tight truncate" data-testid="chat-name">{t("Building")}</div><div class="status"><span class="bdot on" aria-hidden="true"></span><span class="truncate">{t("You can keep working")}</span></div></div>
          <button class="btn hstop" type="button" data-testid="chat-build-stop" onclick={() => chat.abort()}>{t("Stop")}</button>
        {:else}
          {#if (shape === "dock" && layout === "A") || shape === "sheet"}<span class="tile" aria-hidden="true"><Icon name="sparkle" size={14} /></span>{/if}
          <div class="grow min-w-0">
            {#if shape === "command"}<div class="mono-lab" data-testid="chat-name">{name}</div>
            {:else}<div class="nm truncate" data-testid="chat-name">{name}</div><div class="status" data-testid="chat-status"><span class="bdot" class:on={chat.busy} class:off={!usable} aria-hidden="true"></span><span class="truncate">{statusText}</span></div>{/if}
          </div>
        {/if}
        <div class="flex gap-0.5">
          {#if !building}<button class="btn quiet hbtn" type="button" aria-label={t("New chat")} data-testid="chat-new" onclick={() => { historyOpen = false; chat.newConversation(); }}><Icon name="plus" size={17} /></button>
          <button class="btn quiet hbtn" type="button" aria-label={t("Earlier chats")} aria-expanded={historyOpen} data-testid="chat-history" onclick={showHistory}><Icon name="clock" size={17} /></button>{/if}
          {#if shape === "float"}<button class="btn quiet hbtn soft" type="button" aria-label={t("Shrink")} data-testid="chat-collapse" onclick={() => (chat.collapsed = true)}><Icon name="minus" size={17} /></button>{/if}
          <button class="btn quiet hbtn" class:soft={shape === "float"} type="button" aria-label={t("Close")} data-testid="chat-close" onclick={close}><Icon name="close" size={17} /></button>
        </div>
      </div>
      {#if historyOpen}
        <div class="history" data-testid="chat-history-list" role="list">
          {#if chat.conversations === null}<p class="text-mute p-3">{t("Loading…")}</p>
          {:else if !chat.conversations.length}<p class="text-mute p-3">{t("No earlier chats yet.")}</p>
          {:else}{#each chat.conversations as c (c.id)}
            <div class="hrow" role="listitem"><button type="button" class="hpick" data-testid="chat-history-item" onclick={() => pick(c.id)}><span class="truncate font-medium">{c.title || t("Untitled chat")}</span><span class="text-xs text-mute">{dateOf(c.lastAt)}</span></button><button type="button" class="btn quiet hbtn" aria-label={t("Delete this chat")} onclick={() => chat.remove(c.id)}><Icon name="close" size={16} /></button></div>
          {/each}{/if}
        </div>
      {:else}
        <div class="relative min-h-0 grow body">
          <div class="chat-log" bind:this={log} role="log" aria-live="polite" aria-busy={ARIA_BUSY} aria-label={t("Conversation")} data-testid="chat-log">
            {#if !usable}
              <div class="notice warn" data-testid="chat-unavailable">{chat.status?.reason === "who" ? t("Only some people in this workspace may use the assistant.") : chat.status?.reason === "provider" ? t("The assistant is not available with this workspace's AI provider.") : chat.status?.reason === "key" ? t("The assistant needs an AI key before it can answer. An owner or admin can add this workspace's own key in the AI settings.") : t("The assistant is switched off for this workspace.")} <a href="/settings?tab=ai" class="underline">{t("Open the AI settings")}</a></div>
            {:else if !chat.messages.length}
              <div class="empty" data-testid="chat-empty">
                <p class="hi">{t("Hi, I'm {name}.", { name })}</p><p class="text-mute">{t("I can make a document or a form with its signers, change one, check it, tell you what is waiting, and show a card to send it. You press the button; I never send by myself.")}</p>
                <div class="sugs" data-testid="chat-suggestions">{#each prompts as p, i}<button type="button" class="sug" style="--i:{i}" data-testid="chat-suggest" onclick={() => send(p)}>{p}</button>{/each}</div>
              </div>
            {/if}
            {#each chat.messages as m (m.id)}
              {#if m.role === "user" && m.answer}
                <span class="sr-only" data-testid="chat-msg-user">{m.text}</span>
              {:else if m.role === "user"}
                <div class="chat-user" class:dark={shape === "float"} class:quote={building && m === chat.messages.at(-2)} data-testid="chat-msg-user">{m.text}</div>
              {:else}
                <div class="chat-bot" data-testid="chat-msg-bot" data-streaming={m.streaming ? "true" : "false"}>
                  <StepsBlock steps={m.steps} streaming={m.streaming} hasText={Boolean(m.text)} checklist={layout === "C" && m.streaming && m.steps.length > 0} />
                  {#if m.text}<Response text={botText(m)} streaming={m.streaming} onnavigate={leave} />{/if}
                  {#if m.error}<div class="notice warn" role="alert" data-testid="chat-error">{m.error}</div>{/if}
                  {#each m.proposals as p (p.id)}{#if p.kind === "questions"}<QuestionCard proposal={p} onanswer={answer} variant={shape === "float" ? "pills" : shape === "command" ? "bar" : "rows"} active={p === lastQuestion} />{:else if p.kind === "changes" || p.kind === "values"}<DiffCard proposal={p} onaccept={(x) => chat.accept(x)} onreject={(x) => chat.reject(x)} />{:else}<ActionCard proposal={p} onnavigate={leave} onprompt={(x) => send(x)} />{/if}{/each}
                  {#if m.proposals.filter((p) => p.state === "proposed" && p.kind !== "confirm" && p.kind !== "questions" && p.kind !== "pro").length > 1}<button class="btn" type="button" data-testid="chat-accept-all" onclick={() => chat.acceptAll(m)}>{t("Accept all")}</button>{/if}
                  {#if !m.streaming && (m.text || m.error)}
                    <div class="acts" data-testid="chat-actions">
                      <button class="btn quiet abtn" type="button" aria-label={t("Copy the answer")} data-testid="chat-copy" onclick={() => copy(m)}>{#if copiedId === m.id}<span class="text-xs">{t("Copied")}</span>{:else}<Icon name="copy" size={15} />{/if}</button>
                      {#if m === last}<button class="btn quiet abtn" type="button" aria-label={t("Answer again")} data-testid="chat-regenerate" disabled={chat.busy} onclick={() => chat.regenerate(screen)}><Icon name="refresh" size={15} /></button>{/if}
                      <button class="btn quiet abtn" type="button" aria-label={t("Good answer")} aria-pressed={m.rating === 1} data-testid="chat-thumb-up" class:on={m.rating === 1} onclick={() => chat.rate(m, 1)}><Icon name="thumbup" size={15} /></button>
                      <button class="btn quiet abtn" type="button" aria-label={t("Not a good answer")} aria-pressed={m.rating === -1} data-testid="chat-thumb-down" class:on={m.rating === -1} onclick={() => chat.rate(m, -1)}><Icon name="thumbdown" size={15} /></button>
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
            {#if chat.error}<div class="notice warn" role="alert" data-testid="chat-problem">{chat.error}</div>{/if}
          </div>
          {#if usable && stick.overflowing && !stick.atBottom}
            <button type="button" class="jump btn" data-testid="chat-jump" onclick={() => stick.toLatest()}><Icon name="arrowdown" size={14} />{t("Jump to latest")}</button>
          {/if}
        </div>
      {/if}
      {#if chat.undoToast}
        <div class="chat-toast" role="status" data-testid="chat-undo-toast"><span>{t("Change applied.")}</span>
          <button class="btn quiet !min-h-0 !py-1" type="button" data-testid="chat-undo" onclick={() => { const p = chat.messages.flatMap((m) => m.proposals).find((x) => x.id === chat.undoToast.proposalId); if (p) chat.undo(p); }}>{t("Undo")}</button></div>
      {/if}
      </div>
      {#snippet think()}<ThinkHarder bind:checked={chat.thinkHarder} testid="chat-think" compact />{/snippet}
      {#if shape === "command"}
        <PromptInput variant="dark" bind:value={input} bind:box busy={chat.busy} disabled={!usable} {name} attached={chat.attached} placeholder={t("Ask {name}… (⌘I)", { name })} foot={null} extra={usable ? think : null} onsend={send} onstop={() => chat.abort()} onrecall={(i) => chat.recall(i)} onattach={usable ? attach : null} />
      {:else if shape === "float"}
        <PromptInput variant="soft" bind:value={input} bind:box busy={chat.busy} disabled={!usable} {name} attached={chat.attached} placeholder={building ? t("Change something…") : ""} foot={t("{name} drafts; nothing is sent until you do.", { name })} extra={usable ? think : null} onsend={send} onstop={() => chat.abort()} onrecall={(i) => chat.recall(i)} onattach={usable ? attach : null} />
      {:else}
        <PromptInput bind:value={input} bind:box busy={chat.busy} disabled={!usable} {name} attached={chat.attached} placeholder={building ? t("Change something…") : ""} foot={null} onsend={send} onstop={() => chat.abort()} onrecall={(i) => chat.recall(i)} onattach={usable ? attach : null} />
        {#if usable}<div class="usage" data-testid="chat-usage">{@render think()}<AiUsageBar compact /></div>{/if}
      {/if}
      </div>
    </div>
    {/if}
  {/if}
{/if}
<style>
  .chat-panel { position: fixed; z-index: 60; display: flex; flex-direction: column; color: var(--ink); max-width: calc(100vw - 24px); font-size: 14px; }
  .inner { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .card-top { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  /* A and C: the docked column. 1024px and wider it pushes the page (z under dialogs); narrower it lies over the page with a shadow. */
  .dock { top: 0; right: 0; bottom: 0; background: var(--paper); border-left: 1px solid var(--line); box-shadow: -18px 0 40px rgb(20 15 50 / .10); animation: dock-in 320ms cubic-bezier(.2,.8,.2,1); }
  .dock.pushes { z-index: 40; box-shadow: none; }
  /* B: the floating sheet */
  .float { right: 16px; bottom: 16px; width: 400px; height: min(640px, calc(100vh - 32px)); background: var(--paper); border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 30px 70px rgb(20 15 50 / .22), 0 4px 12px rgb(20 15 50 / .08); overflow: hidden; animation: rise 320ms cubic-bezier(.2,.8,.2,1); }
  .pill-shrunk { position: fixed; right: 16px; bottom: 16px; z-index: 60; display: inline-flex; align-items: center; gap: 10px; max-width: min(360px, calc(100vw - 32px)); height: 44px; padding: 0 16px; border: 0; border-radius: 999px; background: #16161d; color: #fff; font: inherit; font-size: 13.5px; cursor: pointer; box-shadow: 0 16px 36px rgb(10 10 30 / .3); animation: rise 260ms cubic-bezier(.2,.8,.2,1); }
  /* D: the command card over the middle of the page, the dark bar under it */
  .command { left: calc(var(--cx) - var(--cw) / 2); width: var(--cw); bottom: 20px; gap: 10px; max-height: calc(100vh - 40px); animation: rise 360ms cubic-bezier(.2,.8,.2,1); }
  .command .card-top { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 30px 70px rgb(20 15 50 / .22); overflow: hidden; max-height: 62vh; }
  .command .inner { gap: 10px; }
  .dim { position: fixed; top: 0; bottom: 0; z-index: 34; pointer-events: none; background: color-mix(in srgb, var(--paper) 45%, transparent); animation: fade 260ms ease-out; }
  /* phone: one full-screen sheet */
  .sheet { inset: 0; width: 100%; max-width: 100%; height: 100vh; height: 100dvh; background: var(--paper); padding-bottom: env(safe-area-inset-bottom, 0px); animation: rise 300ms cubic-bezier(.2,.8,.2,1); }
  .chat-head { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--line); }
  .command .chat-head { border-bottom: 0; padding-bottom: 4px; }
  .tile { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--brand); color: var(--brand-ink, #fff); flex: none; }
  .nm { font-weight: 600; font-size: 14px; line-height: 1.2; }
  .mono-lab { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); }
  .status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mute); min-width: 0; }
  .bdot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none; }
  .bdot.on { background: var(--brand); animation: breathe 1.6s ease-in-out infinite; }
  .bdot.off { background: var(--line-strong); }
  .pill-shrunk .bdot { background: #8585fd; }
  .hbtn { min-height: 40px !important; min-width: 40px; padding: 0 !important; display: inline-grid; place-items: center; border-radius: 10px; }
  .float .hbtn { min-height: 34px !important; min-width: 34px; }
  .chat-panel :global([data-testid="chat-think-row"] [data-part="label"]) { white-space: nowrap; font-size: 12.5px; }
  .hbtn.soft { background: #f4f4f7; } :global(:root[data-theme="dark"]) .hbtn.soft { background: var(--tint); }
  .hstop { min-height: 32px !important; padding: 0 12px !important; font-size: 13px; }
  .body { display: flex; flex-direction: column; }
  .chat-log { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 16px; display: grid; gap: 16px; align-content: start; }
  .command .chat-log { padding: 8px 20px 18px; }
  .empty { display: grid; gap: 8px; padding-top: 4px; }
  .hi { font-size: 15px; font-weight: 600; }
  .sugs { display: grid; margin-top: 6px; }
  .sug { text-align: left; background: none; border: 0; border-top: 1px solid var(--line); color: var(--ink); padding: 10px 2px; min-height: 44px; font: inherit; font-size: 14px; cursor: pointer; animation: msg-in 320ms cubic-bezier(.2,.8,.2,1) calc(var(--i) * 50ms) both; }
  .sug:last-child { border-bottom: 1px solid var(--line); }
  .sug:hover { color: var(--brand); }
  .float .sugs, .command .sugs { display: flex; flex-wrap: wrap; gap: 8px; }
  .float .sug, .command .sug { border: 1px solid var(--line-strong); border-radius: 999px; padding: 7px 14px; min-height: 36px; font-size: 13.5px; }
  .chat-user { justify-self: end; max-width: 88%; background: #f1efff; color: var(--ink); padding: 9px 13px; border-radius: 14px 14px 4px 14px; white-space: pre-wrap; overflow-wrap: anywhere; animation: msg-in 280ms cubic-bezier(.2,.8,.2,1); }
  :global(:root[data-theme="dark"]) .chat-user { background: color-mix(in srgb, var(--brand) 26%, var(--paper)); }
  .chat-user.dark { background: #16161d; color: #fff; }
  .chat-user.quote { justify-self: stretch; max-width: none; background: none; border-left: 2px solid var(--brand); border-radius: 0; padding: 2px 0 2px 12px; color: var(--mute); }
  .chat-bot { justify-self: start; width: 100%; display: grid; gap: 10px; overflow-wrap: anywhere; animation: msg-in 280ms cubic-bezier(.2,.8,.2,1); }
  .acts { display: flex; gap: .1rem; margin-top: -.3rem; }
  .abtn { min-height: 36px !important; min-width: 36px; padding: 0 !important; display: inline-grid; place-items: center; color: var(--mute); }
  .abtn.on { color: var(--brand); }
  .jump { position: absolute; left: 50%; bottom: .6rem; transform: translateX(-50%); display: inline-flex; gap: .3rem; align-items: center; min-height: 36px; border-radius: 9999px; box-shadow: var(--sh-2); }
  .history { flex: 1; overflow-y: auto; }
  .hrow { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
  .hpick { flex: 1; display: grid; text-align: left; gap: .1rem; padding: .6rem .75rem; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; min-width: 0; min-height: 44px; }
  .hpick:hover { background: var(--tint); }
  .chat-toast { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .35rem .75rem; background: var(--brand-soft); border-top: 1px solid var(--line); }
  .usage { display: grid; gap: 8px; padding: 2px 12px 10px; background: var(--card); font-size: 12px; }
  @keyframes dock-in { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes rise { from { transform: translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes breathe { 50% { opacity: .35; transform: scale(.8); } }
  @keyframes msg-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .chat-panel, .pill-shrunk, .dim, .sug, .chat-user, .chat-bot, .bdot { animation: none !important; } }
  :global(html[data-lite]) .chat-user, :global(html[data-lite]) .chat-bot, :global(html[data-lite]) .sug { animation: none; }
</style>
