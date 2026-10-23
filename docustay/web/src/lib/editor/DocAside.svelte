<script>
  // The second column of the Details step: the document as it stands (first page, title, how many fields, who signs), so the person sees what they are describing. Everything comes from the draft already loaded.
  import { t } from "$lib/i18n/index.svelte.js";
  import Avatar from "$lib/ui/Avatar.svelte";
  let { doc } = $props();
  const fields = $derived((doc.body?.fields ?? []).length);
  const who = $derived((doc.parties ?? []).filter((p) => p.name));
</script>
<div class="space-y-4" data-testid="doc-aside">
  <div class="rounded-md p-4" style="background: var(--plate)"><div class="mx-auto w-[150px]"><img src="/api/documents/pdf/{doc.id}/thumb.png?w=240" alt={t("First page of {title}", { title: doc.title })} class="block w-full border border-line-strong bg-white" onerror={(e) => (e.currentTarget.style.display = "none")} /></div></div>
  <p class="text-[13px] font-medium">{doc.title}</p>
  <dl class="border-t border-line text-[13px]">
    <div class="flex items-baseline justify-between gap-4 border-b border-line py-2"><dt class="text-mute">{t("Fields")}</dt><dd>{fields || t("None yet")}</dd></div>
    <div class="flex items-baseline justify-between gap-4 border-b border-line py-2"><dt class="text-mute">{t("Who signs")}</dt><dd class="text-right">{who.length || t("Nobody yet")}</dd></div>
  </dl>
  {#if who.length}<ul class="space-y-1.5 text-[13px]">{#each who as p, i (p.id ?? i)}<li class="flex items-center gap-2"><Avatar name={p.name} /><span class="min-w-0 truncate">{p.name}</span></li>{/each}</ul>{/if}
</div>
