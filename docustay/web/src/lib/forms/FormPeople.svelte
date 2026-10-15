<script>
  // A FORM's "Who fills it" step (Run 7): exactly one person fills it in (a visitor, named only when they open the link), and — optionally — one person on the team counter-signs
  // after them. `people` is the same shape the template flow uses (one row per role); `counter` is { on, userId }.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Toggle from "$lib/ui/Toggle.svelte";
  let { people = $bindable([]), counter = $bindable({ on: false, userId: null }), onchange = () => {} } = $props();
  let team = $state([]);
  onMount(async () => { const r = await api("/api/list/people/team"); if (r.ok) team = r.json.rows ?? []; });
  const row = (i, word) => ({ role: `signer_${i + 1}`, name: "", email: null, phone: null, action_role: "signer", external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: i + 1, roleWord: word });
  $effect.pre(() => { if (!people.length) people = [row(0, t("Visitor"))]; });
  function setCounter(on) {
    counter = { ...counter, on };
    people = on ? [people[0], people[1] ?? row(1, t("Staff"))] : [people[0]];
    onchange();
  }
</script>
<div class="grid max-w-[860px] gap-4" data-testid="form-people">
  <div class="rounded-xl border border-line p-5">
    <p class="text-sm font-medium">{t("The person who fills it in")}</p>
    <p class="mt-1 text-xs text-mute">{t("Anyone with the link. They type their name and email when they open it; you do not name them here.")}</p>
    <label class="mt-3 grid max-w-sm gap-1"><span class="text-sm">{t("What to call them in the form")}</span><input class="field" value={people[0]?.roleWord ?? ""} oninput={(e) => { people[0] = { ...people[0], roleWord: e.currentTarget.value }; onchange(); }} data-testid="fp-visitor-word" /></label>
  </div>
  <div class="rounded-xl border border-line p-5">
    <Toggle checked={!!counter.on} onchange={setCounter} label={t("A team member counter-signs after them")} hint={t("Each response then waits for this person's signature before it is complete.")} testid="fp-counter" />
    {#if counter.on}
      <label class="mt-3 grid max-w-sm gap-1"><span class="text-sm">{t("Who counter-signs")}</span>
        <select class="field" value={counter.userId ?? ""} onchange={(e) => { counter = { ...counter, userId: e.currentTarget.value || null }; onchange(); }} data-testid="fp-counter-who"><option value="">{t("Choose someone on your team")}</option>{#each team as m (m.id)}<option value={m.id}>{m.display_name} · {m.email}</option>{/each}</select></label>
      <label class="mt-3 grid max-w-sm gap-1"><span class="text-sm">{t("What to call them in the form")}</span><input class="field" value={people[1]?.roleWord ?? ""} oninput={(e) => { people[1] = { ...people[1], roleWord: e.currentTarget.value }; onchange(); }} data-testid="fp-counter-word" /></label>
    {/if}
  </div>
</div>
