<script>
  // One hand-inked drawing from the library. Decorative by default (aria-hidden); pass `label` when it carries meaning.
  // On scroll the strokes draw themselves once; with reduced motion, or without script, the finished picture is simply there.
  import { DOODLES } from "./library.js";
  import { drawing } from "./engine.js";
  import { shown } from "$lib/fx/index.js";
  import { getContext } from "svelte";
  import Icon from "$lib/ui/Icon.svelte";
  // On the public website (frames: website v2) there are no hand-drawn doodles: the same names show as a small Lucide icon tile, and big decorative ones show nothing.
  const site = getContext("site-surface") === true;
  const ICON = { pen: "pen", pencil: "pen", signature: "signature", stamp: "stamp", seal: "badge-check", "seal-d": "badge-check", "doc-corner": "file-text", "doc-sign": "file-signature", envelope: "mail", letter: "mail", stack: "files", folder: "files", clipboard: "list", "sticky-notes": "file-text", "doc-lines": "file-text", book: "book-open", check: "check", "double-check": "circle-check", "tick-marks": "check", star: "sparkle", stars: "sparkles", burst: "sparkles", sparkle: "sparkle", heart: "thumbs-up", "thumbs-up": "thumbs-up", key: "key", lock: "lock", unlock: "lock", shield: "shield-check", calendar: "calendar", clock: "clock", hourglass: "clock", "map-pin": "globe", globe: "globe", house: "layout-template", handshake: "users", "phone-hands": "message-square", phone: "message-square", laptop: "terminal", "id-card": "user", glasses: "eye", camera: "image", chat: "chat", "mail-at": "mail", coffee: "card", "paper-plane": "send", bulb: "sparkle", rocket: "rocket", cloud: "server", tag: "hash", gear: "settings", inbox: "mail", briefcase: "files", qr: "qr-code", scissors: "wand-sparkles", trophy: "badge-check", medal: "badge-check", flag: "info", bolt: "zap", bell: "bell", magnifier: "search", paperclip: "paperclip", link: "link", plant: "sparkle", "w-signed": "check", "w-sealed": "badge-check", "w-done": "circle-check", "w-send-it": "send", "w-keep-it": "shield-check", "w-yes": "check", "w-ok": "circle-check", "w-paid": "card", "w-agreed": "check", "w-sign-here": "pen" };
  const px = (v) => { const m = /^([\d.]+)(rem|px|em)$/.exec(String(v ?? "")); return m ? Number(m[1]) * (m[2] === "px" ? 1 / 16 : 1) : 3; };
  let { name, size = null, label = null, animate = true, class: cls = "" } = $props();
  const cache = globalThis.__doodleCache ??= new Map();
  const d = $derived(cache.get(name) ?? (cache.set(name, drawing(name, DOODLES[name])), cache.get(name)));
</script>
{#if site}
  {#if ICON[name] && px(size) < 8}<span class="grid shrink-0 place-items-center rounded-[10px] border border-line bg-[var(--accent-soft)] text-[var(--accent)] {cls}" style="width:{Math.min(Math.max(px(size) * 0.7, 2.25), 3.25)}rem;height:{Math.min(Math.max(px(size) * 0.7, 2.25), 3.25)}rem" aria-hidden="true"><Icon name={ICON[name]} size={20} /></span>{/if}
{:else if DOODLES[name]}
  <svg class="doodle {cls}" viewBox="0 0 {d.w} {d.h}" style={size ? `width:${size}` : null} role={label ? "img" : null} aria-label={label} aria-hidden={label ? null : "true"} focusable="false" data-shown={animate ? null : ""} {@attach animate ? shown(0.3) : null}>
    {#each d.paths as p}
      {#if p.cls === "blk"}<path class="blk c-{p.colour}" d={p.d} />{:else if p.cls === "dot"}<path class="dot" d={p.d} style="--k:{p.k}" />{:else}<path class={p.cls} d={p.d} pathLength="1" style="--k:{p.k}" />{/if}
    {/each}
  </svg>
{/if}
