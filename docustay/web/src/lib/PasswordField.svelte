<script>
  // A password input with a show/hide button, the rule written before the person submits, and a light strength hint. The hint is a small in-house check (length, mix, a short list of the commonest passwords), not a library: the usual strength libraries ship hundreds of kilobytes of word lists, which is too heavy for a sign-up page.
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = $bindable(""), id = "p", min = 6, label = "", autocomplete = "new-password", hint = true } = $props();
  let shown = $state(false);
  const COMMON = ["password", "passw0rd", "qwerty", "letmein", "welcome", "admin", "iloveyou", "monkey", "dragon", "abc123", "123456", "111111", "docustay"];
  const level = $derived.by(() => {
    const v = value; if (!v) return -1;
    const low = v.toLowerCase(); if (COMMON.some((c) => low.includes(c)) && v.length < 14) return 0;
    if (/^(.)\\1+$/.test(v) || /^(0123|1234|2345|abcd)/i.test(v)) return 0;
    let n = 0; if (v.length >= min) n++; if (v.length >= 10) n++; if (v.length >= 14) n++; if (/[a-z]/.test(v) && /[A-Z]/.test(v) || /\\d/.test(v) && /[a-z]/i.test(v)) n++; if (/[^A-Za-z0-9]/.test(v)) n++;
    return v.length < min ? 0 : Math.min(3, Math.max(1, n - 1));
  });
  const words = $derived(["", t("Weak"), t("Fair"), t("Good"), t("Strong")]);
  const text = $derived(level < 0 ? "" : level === 0 ? t("Too short or too common") : [t("Weak"), t("Fair"), t("Good"), t("Strong")][Math.max(0, level - 1)] ?? "");
  void words;
</script>
<div class="pf">
  {#if label}<label class="label" for={id}>{label}</label>{/if}
  <div class="pfrow"><input {id} class="field" type={shown ? "text" : "password"} {autocomplete} bind:value required aria-describedby={`${id}-rule`} /><button type="button" class="pfbtn" onclick={() => (shown = !shown)} aria-pressed={shown} aria-label={shown ? t("Hide password") : t("Show password")}>{shown ? t("Hide") : t("Show")}</button></div>
  <p id={`${id}-rule`} class="pfrule">{t("Use at least {n} characters. A longer phrase is stronger.", { n: min })}{#if hint && text} <span class="pfs" data-level={level} data-testid="password-strength">{text}</span>{/if}</p>
</div>
<style>
  .pfrow { position: relative; } .pfrow :global(.field) { padding-right: 4.2rem; }
  .pfbtn { position: absolute; right: .35rem; top: 50%; transform: translateY(-50%); background: none; border: 0; padding: .35rem .55rem; font-size: .8125rem; cursor: pointer; text-decoration: underline; color: var(--brand, inherit); }
  .pfrule { margin: .35rem 0 0; font-size: .8125rem; color: var(--mute, #667085); } .pfs { font-weight: 600; margin-left: .35rem; }
  .pfs[data-level="0"] { color: #b42318; } .pfs[data-level="1"] { color: #b54708; } .pfs[data-level="2"] { color: #3b6e1f; } .pfs[data-level="3"] { color: #067647; }
</style>
