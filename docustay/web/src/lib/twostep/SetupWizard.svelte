<script>
  // Set up a way to confirm it's you — four stages: Choose, Set up, Recovery codes, Protected. Used on the Security page (to add any method) and by the "your workspace requires it" page.
  // `askProof(title, run)` is the parent's way of getting the person's current second step first (it just calls run(undefined) when they have none).
  import CodeBoxes from "$lib/entry/CodeBoxes.svelte";
  import CopyButton from "$lib/ui/CopyButton.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import Seal from "$lib/ui/Seal.svelte";
  import RecoveryCodes from "./RecoveryCodes.svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { passkeysSupported, registerPasskey } from "$lib/passkeys.js";
  let { overview = null, askProof = (title, run) => run(undefined), ondone = () => {}, oncancel = null, first = false } = $props();
  const STAGES = $derived([t("Choose"), t("Set up"), t("Recovery codes"), t("Protected")]);
  let stage = $state(0), method = $state(null), problem = $state(null), busy = $state(false);
  let name = $state(""), enrol = $state(null), qr = $state(null), code = $state(""), bad = $state(false), codes = $state(null), skippedCodes = $state(false), boxes = $state(null);
  const canKeys = $derived(overview?.passkeysAvailable === true && passkeysSupported());
  const phone = typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && innerWidth < 768));
  const METHODS = $derived([
    ...(canKeys ? [{ key: "passkey", icon: "fingerprint", title: t("Passkey"), badge: t("Recommended"), body: t("Use Touch ID, Face ID, Windows Hello or your device lock. Nothing to type, and it cannot be phished.") }] : []),
    ...(overview?.authenticatorApp?.on ? [] : [{ key: "totp", icon: "smartphone", title: t("Authenticator app"), body: t("Use an app such as Google Authenticator, 1Password or Authy to get a six-digit code.") }]),
    ...(canKeys ? [{ key: "security_key", icon: "key", title: t("Security key"), body: t("Use a physical key you plug in or tap, such as a YubiKey.") }] : []),
  ]);

  function choose(m) { method = m; problem = null; stage = 1; name = m === "security_key" ? t("Security key") : m === "passkey" ? t("This device") : ""; if (m === "totp") beginAuthenticator(); }
  function back() { problem = null; enrol = null; qr = null; code = ""; stage = 0; method = null; }

  async function beginAuthenticator() {
    busy = true; problem = null;
    const err = await askProof(t("Add an authenticator app"), async (proof) => {
      const r = await api("/api/auth/two-step/start", { method: "POST", body: proof ? { proof } : {} });
      if (!r.ok) return r.error ?? t("Something went wrong. Try again.");
      enrol = r.json;
      if (!phone) qr = await (await import("qrcode")).default.toDataURL(r.json.otpauthUrl, { margin: 1, width: 192 });
      return null;
    });
    busy = false;
    if (err === "cancelled") { back(); return; }
    if (err) { back(); problem = err; return; }
    queueMicrotask(() => boxes?.focus());
  }
  async function confirm(v) {
    if (busy) return;
    busy = true; problem = null; bad = false;
    const r = await api("/api/auth/two-step/confirm", { method: "POST", body: { code: (v ?? code).trim() } });
    busy = false;
    if (!r.ok) { bad = true; code = ""; problem = t("That code did not match. Check the code in your app and try the next one."); queueMicrotask(() => boxes?.focus()); return; }
    finish(r.json?.recoveryCodes ?? null);
  }
  async function createKey() {
    busy = true; problem = null;
    const label = (name.trim() || (method === "security_key" ? t("Security key") : t("My passkey")));
    let out = null;
    const err = await askProof(method === "security_key" ? t("Add a security key") : t("Add a passkey"), async (proof) => {
      try { out = await registerPasskey(label, { kind: method, proof }); return null; } catch (e) { return e.message; }
    });
    busy = false;
    if (err) { problem = err === "cancelled" ? null : err; return; }
    finish(out?.recoveryCodes ?? null);
  }
  function finish(newCodes) { if (newCodes?.length) { codes = newCodes; stage = 2; } else { skippedCodes = true; stage = 3; } }
  const st = (i) => (i < stage || (i === 2 && skippedCodes && stage === 3) ? "done" : i === stage ? "current" : "todo");
</script>
<section data-testid="two-step-wizard" aria-label={t("Set up two-step sign-in")}>
  <ol class="grid grid-cols-4" data-testid="wizard-ribbon" aria-label={t("Steps")}>
    {#each STAGES as s, i (i)}
      <li class="min-w-0" aria-current={st(i) === "current" ? "step" : undefined} data-state={st(i)}>
        <div class="flex items-center">
          <span class="h-[2px] flex-1 {i === 0 ? 'opacity-0' : ''}" style="background: {st(i) !== 'todo' ? 'var(--brand)' : 'var(--stage-off)'}"></span>
          {#if st(i) === "done"}<span class="grid h-[18px] w-[18px] place-items-center rounded-full text-white" style="background: var(--brand)"><Icon name="check" size={11} /></span>
          {:else if st(i) === "current"}<span class="grid h-[18px] w-[18px] place-items-center rounded-full border-2" style="border-color: var(--brand); background: var(--card)"><span class="h-[6px] w-[6px] rounded-full" style="background: var(--brand)"></span></span>
          {:else}<span class="h-[18px] w-[18px] rounded-full border-2 bg-[var(--card)]" style="border-color: var(--line-strong)"></span>{/if}
          <span class="h-[2px] flex-1 {i === 3 ? 'opacity-0' : ''}" style="background: {st(i) === 'done' ? 'var(--brand)' : 'var(--stage-off)'}"></span>
        </div>
        <p class="mt-2 text-center text-[13px] font-medium {st(i) === 'todo' ? 'text-mute' : 'text-ink'}">{s}</p>
      </li>
    {/each}
  </ol>

  <div class="mt-6" aria-live="polite">
    {#if problem && stage !== 1}<p class="notice bad mb-3" role="alert">{problem}</p>{/if}

    {#if stage === 0}
      <h2 class="text-lg font-semibold">{t("How do you want to confirm it's you?")}</h2>
      <p class="mt-1 text-sm text-text-2">{t("After your password or email code, Docustay asks for this. You can add more than one.")}</p>
      <div class="mt-4 grid gap-3" role="radiogroup" aria-label={t("Choose a way")}>
        {#each METHODS as m (m.key)}
          <button type="button" role="radio" aria-checked="false" class="flex items-start gap-3 rounded-xl border border-line bg-card p-4 text-left hover:border-brand" onclick={() => choose(m.key)} data-testid="method-{m.key}">
            <span class="mt-0.5 text-brand"><Icon name={m.icon} size={22} /></span>
            <span class="min-w-0"><span class="flex flex-wrap items-center gap-2 font-semibold">{m.title}{#if m.badge}<span class="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-brand">{m.badge}</span>{/if}</span><span class="mt-0.5 block text-sm text-text-2">{m.body}</span></span>
          </button>
        {/each}
      </div>
      {#if !canKeys}<p class="mt-3 text-xs text-mute" data-testid="no-passkeys-note">{t("Passkeys and security keys are not available in this browser or on this server.")}</p>{/if}
      {#if oncancel}<button type="button" class="btn quiet mt-4" onclick={oncancel}>{t("Cancel")}</button>{/if}

    {:else if stage === 1 && method === "totp"}
      <h2 class="text-lg font-semibold">{t("Add an authenticator app")}</h2>
      {#if enrol}
        <div class="mt-3 grid gap-5 sm:grid-cols-[auto_1fr]">
          {#if qr}<img src={qr} alt={t("QR code to scan with your authenticator app")} class="h-48 w-48 rounded-lg border border-line bg-white p-1" data-testid="totp-qr" />{/if}
          <div class="min-w-0 space-y-3">
            {#if phone}
              <p class="text-sm text-text-2">{t("Open your authenticator app straight from this phone, or copy the key and paste it in.")}</p>
              <a class="btn primary" href={enrol.otpauthUrl} data-testid="totp-open">{t("Open in my authenticator app")}</a>
            {:else}
              <p class="text-sm text-text-2">{t("Scan the picture with your authenticator app. Or type the key in by hand.")}</p>
            {/if}
            <div class="flex min-w-0 items-center gap-1 rounded-lg border border-line-strong bg-card pl-3"><code class="min-w-0 flex-1 break-all py-2 text-[13px] tracking-wider" data-testid="totp-key">{enrol.secret}</code><CopyButton value={enrol.secret} label={t("Copy key")} copiedLabel={t("Copied")} testid="totp-copy" /></div>
          </div>
        </div>
        <div class="mt-5">
          <label class="label" for="enrol-code">{t("Then enter the six-digit code it shows")}</label>
          <CodeBoxes bind:this={boxes} bind:value={code} id="enrol-code" invalid={bad} {busy} oncomplete={confirm} label={t("Six-digit code")} />
          {#if problem}<p class="notice bad mt-3 max-w-md" role="alert" data-testid="totp-problem">{problem}</p>{/if}
        </div>
      {:else if busy}<p class="mt-3 text-sm text-mute">{t("Getting your key ready…")}</p>{/if}
      <button type="button" class="btn quiet mt-5" onclick={back}>{t("Back")}</button>

    {:else if stage === 1}
      <h2 class="text-lg font-semibold">{method === "security_key" ? t("Add a security key") : t("Create a passkey")}</h2>
      <p class="mt-1 text-sm text-text-2">{method === "security_key" ? t("Give it a name, then insert the key and touch it when it blinks.") : t("Give it a name you will recognise. Your device will then ask for your fingerprint, face or device lock.")}</p>
      <form class="mt-4 max-w-sm space-y-3" onsubmit={(e) => { e.preventDefault(); createKey(); }}>
        <div><label class="label" for="key-name">{t("Name")}</label><input id="key-name" class="field" bind:value={name} maxlength="80" data-testid="passkey-name" /></div>
        {#if problem}<p class="notice bad" role="alert" data-testid="key-problem">{problem}</p>{/if}
        <div class="flex gap-2"><button class="btn primary" disabled={busy} data-testid="passkey-create">{method === "security_key" ? t("Add the key") : t("Create passkey")}</button><button type="button" class="btn quiet" onclick={back}>{t("Back")}</button></div>
      </form>

    {:else if stage === 2}
      <h2 class="text-lg font-semibold">{t("Save your recovery codes")}</h2>
      <div class="mt-2"><RecoveryCodes {codes} onsaved={() => (stage = 3)} /></div>

    {:else}
      <div class="grid justify-items-center gap-2 py-4 text-center" data-testid="two-step-protected">
        <Seal size={72} stamp />
        <h2 class="text-xl font-semibold">{t("You're protected")}</h2>
        <p class="max-w-md text-sm text-text-2">{first ? t("From now on, signing in also asks for this. You can add more ways, or change them, any time under Security.") : t("That way is added. You can change or remove ways any time under Security.")}</p>
        <button type="button" class="btn primary mt-2" onclick={ondone} data-testid="wizard-done">{t("Done")}</button>
      </div>
    {/if}
  </div>
</section>
