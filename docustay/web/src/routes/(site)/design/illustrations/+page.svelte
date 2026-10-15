<script>
  import Doodle from "$lib/doodle/Doodle.svelte";
  import { NAMES, COUNT } from "$lib/doodle/library.js";
  const groups = [["Things you hold and write with", ["pen", "pencil", "signature", "stamp", "seal", "seal-d"]], ["Paper", ["doc-corner", "doc-sign", "envelope", "letter", "stack", "folder", "clipboard", "sticky-notes", "doc-lines", "book"]], ["Marks and decisions", ["check", "double-check", "tick-marks", "star", "stars", "burst", "sparkle", "heart", "thumbs-up"]], ["Security", ["key", "lock", "unlock", "shield"]], ["Time and place", ["calendar", "clock", "hourglass", "map-pin", "globe", "house"]], ["People and devices", ["handshake", "phone-hands", "phone", "laptop", "id-card", "glasses", "camera", "chat", "mail-at"]], ["Objects", ["coffee", "paper-plane", "bulb", "rocket", "cloud", "tag", "gear", "inbox", "briefcase", "qr", "scissors", "trophy", "medal", "flag", "bolt", "bell", "magnifier", "paperclip", "link", "ruler"]], ["Nature", ["sun", "moon", "plant"]], ["Arrows and squiggles", ["arrow-curl", "arrow-straight", "arrow-loop", "arrow-down", "underline", "zigzag", "spiral", "highlight-ring", "brackets", "dots", "plus"]], ["Hand-lettered words", ["w-signed", "w-sealed", "w-done", "w-send-it", "w-keep-it", "w-yes", "w-ok", "w-paid", "w-agreed", "w-sign-here"]]];
  const listed = new Set(groups.flatMap((g) => g[1])); const rest = NAMES.filter((n) => !listed.has(n));
</script>
<svelte:head><title>Illustration library · Docustay design</title><meta name="robots" content="noindex" /></svelte:head>
<section class="pt-10"><h1 class="text-4xl font-semibold">Illustration library</h1><p class="mt-3 max-w-2xl text-mute">{COUNT} original hand-inked drawings. Each draws itself once as it scrolls into view; with reduced motion it is simply there. Not part of the public site.</p></section>
{#each groups as [title, names]}
  <section class="mt-10"><h2 class="text-xl font-semibold">{title}</h2>
    <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{#each names as n}<figure class="card flex flex-col items-center gap-2 p-4"><Doodle name={n} size={n.startsWith("w-") ? "100%" : "9rem"} /><figcaption class="font-mono text-xs text-mute">{n}</figcaption></figure>{/each}</div>
  </section>
{/each}
{#if rest.length}<section class="mt-10"><h2 class="text-xl font-semibold">Unsorted</h2><div class="mt-4 grid grid-cols-3 gap-3">{#each rest as n}<figure class="card p-4"><Doodle name={n} size="8rem" /><figcaption class="font-mono text-xs text-mute">{n}</figcaption></figure>{/each}</div></section>{/if}
<section class="on-black mt-12 rounded-3xl p-8" style="background: var(--black-section); color: var(--black-ink)"><h2 class="text-xl font-semibold">On a black section</h2><div class="mt-4 flex flex-wrap items-end gap-8"><Doodle name="seal" size="8rem" /><Doodle name="w-done" size="14rem" /><Doodle name="paper-plane" size="8rem" /><Doodle name="key" size="8rem" /></div></section>
