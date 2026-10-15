<script>
  // "Suggest a better translation": a link on every app screen, the signing page and the language menu. It opens a short form; a person at Docustay reads every suggestion before anything changes.
  // The English sentence is found from the text on the screen (the reverse of the catalogue) so the suggestion is stored against the right sentence.
  import Sheet from "$lib/ui/Sheet.svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { i18n, setLang, t } from "./index.svelte.js";
  import { LANG_NAMES } from "$lib/site/l10n-langs.js";
  /** variant: "icon" (the narrow sidebar), "link" (a small text link). surface: where it was opened from. lang: the language being read (the signing page passes its own). */
  let { variant = "link", surface = "app", lang = null, class: cls = "" } = $props();
  const code = $derived(lang ?? i18n.lang);
  // D-107: the signing page keeps its own words, so the app's catalogue for that language was never loaded and this link (written with t()) stayed English; load it as soon as the link is shown
  $effect(() => { if (lang && lang !== "en" && i18n.lang !== lang) setLang(lang, { save: false }); });
  let open = $state(false), openedAt = $state(0), current = $state(""), suggested = $state(""), note = $state(""), email = $state(""), website = $state(""), busy = $state(false), done = $state(false), problem = $state(null);
  async function show() {
    if (i18n.lang !== code) await setLang(code, { save: false });   // the form's own words come in the language being read
    let sel = ""; try { sel = String(globalThis.getSelection?.() ?? "").trim().slice(0, 600); } catch { /* no selection */ }
    current = sel; suggested = ""; note = ""; email = ""; website = ""; done = false; problem = null; openedAt = Date.now(); open = true;
  }
  const reverse = () => { const m = new Map(); for (const [en, tr] of Object.entries(i18n.catalogue)) if (!m.has(tr)) m.set(tr, en); return m; };
  async function send() {
    busy = true; problem = null;
    const en = reverse().get(current.trim());
    try {
      const r = await fetch("/api/public/docustay/translation-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: code, surface: en ? surface : "other", sourceKey: en ?? current.trim(), currentText: current.trim(), suggestedText: suggested, note, email, website, openedAt }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? j?.message ?? t("That could not be sent. Try again."));
      done = true;
    } catch (e) { problem = e.message; } finally { busy = false; }
  }
</script>
{#if code !== "en"}
  {#if variant === "icon"}
    <button class="btn quiet {cls}" onclick={show} data-testid="suggest-translation"><Icon name="translate" /><span class="md:sr-only">{t("Suggest a better translation")}</span></button>
  {:else}
    <button type="button" class="inline-flex min-h-6 items-center text-xs text-mute underline underline-offset-2 hover:text-ink {cls}" onclick={show} data-testid="suggest-translation">{t("Suggest a better translation")}</button>
  {/if}
  <Sheet {open} title={t("Suggest a better translation")} onclose={() => (open = false)}>
    {#if done}
      <p class="notice ok" role="status" data-testid="suggest-done">{t("Thank you. A person will read your suggestion before anything changes.")}</p>
    {:else}
      <form class="grid gap-3" onsubmit={(e) => { e.preventDefault(); send(); }}>
        <p class="text-sm text-mute">{LANG_NAMES[code]}</p>
        <label class="grid gap-1 text-sm"><span class="font-medium">{t("The text you would change")}</span>
          <textarea class="field" rows="2" bind:value={current} data-autofocus placeholder={t("Select the text on the screen before you open this, or paste it here.")} required></textarea></label>
        <label class="grid gap-1 text-sm"><span class="font-medium">{t("Your suggestion")}</span>
          <textarea class="field" rows="3" bind:value={suggested} required></textarea></label>
        <label class="grid gap-1 text-sm"><span class="font-medium">{t("Why is it better? (optional)")}</span>
          <input class="field" bind:value={note} maxlength="1000" /></label>
        <label class="grid gap-1 text-sm"><span class="font-medium">{t("Your email, if you want a reply (optional)")}</span>
          <input class="field" type="email" bind:value={email} autocomplete="email" /></label>
        <div aria-hidden="true" style="position:absolute;left:-9999px;height:0;overflow:hidden"><label>Website<input tabindex="-1" autocomplete="off" bind:value={website} /></label></div>
        {#if problem}<p class="notice bad" role="alert">{problem}</p>{/if}
        <p class="text-xs text-mute">{t("We keep your suggestion and, if you add it, your email. We do not keep your address.")} <a class="underline" href="/privacy" target="_blank" rel="noopener">{t("Privacy")}</a></p>
        <button class="btn" disabled={busy || !suggested.trim() || !current.trim()}>{t("Send suggestion")}</button>
      </form>
    {/if}
  </Sheet>
{/if}
