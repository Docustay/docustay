// Follow-the-conversation scrolling. Adapted from the stick-to-bottom context of Svelte AI Elements (MIT, Copyright (c) 2026 Sikandar Bhide, github.com/SikandarJODD/ai-elements);
// rewritten in plain JS without its `runed` dependency, with the rules this product needs: follow new text ONLY while the reader is within 100px of the bottom, never move a reader who scrolled up,
// bring the person's own message into view when they send, smooth scrolling unless the person asks for reduced motion.
import { calm } from "$lib/fx/index.js";

const NEAR = 100;
export class StickToBottom {
  atBottom = $state(true);
  overflowing = $state(false);
  #el = null; #ro = null; #mo = null; #raf = 0; #follow = true; #lock = 0;

  attach(el) {
    this.detach(); this.#el = el; if (!el) return;
    el.addEventListener("scroll", this.#onScroll, { passive: true });
    for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) el.addEventListener(ev, this.#onUser, { passive: true });
    this.#ro = new ResizeObserver(() => this.#settle());
    this.#ro.observe(el);
    this.#mo = new MutationObserver(() => { cancelAnimationFrame(this.#raf); this.#raf = requestAnimationFrame(() => this.#settle()); });
    this.#mo.observe(el, { childList: true, subtree: true, characterData: true });
    this.#measure();
  }
  detach() { this.#el?.removeEventListener("scroll", this.#onScroll); for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) this.#el?.removeEventListener(ev, this.#onUser); this.#ro?.disconnect(); this.#mo?.disconnect(); cancelAnimationFrame(this.#raf); this.#el = null; this.#ro = this.#mo = null; }

  #gap() { const e = this.#el; return e ? e.scrollHeight - e.scrollTop - e.clientHeight : 0; }
  #measure() { const e = this.#el; if (!e) return; this.overflowing = e.scrollHeight > e.clientHeight + 4; this.atBottom = this.#gap() <= NEAR; }
  // scroll events our own smooth scrolling causes must not read as the reader leaving the bottom; a wheel, touch, key or press clears that
  #onUser = () => { this.#lock = 0; };
  #onScroll = () => { this.#measure(); if (performance.now() > this.#lock) this.#follow = this.atBottom; };
  // new content arrived: if the reader was following, stay at the bottom; if they scrolled up, leave them where they are
  #settle() { const was = this.#follow; if (was) this.#jump("auto"); this.#measure(); }
  #jump(behavior) { const e = this.#el; if (!e) return; this.#lock = performance.now() + (behavior === "smooth" ? 900 : 120); e.scrollTo({ top: e.scrollHeight, behavior: calm() ? "auto" : behavior }); }

  /** the "Jump to latest" button */
  toLatest() { this.#follow = true; this.#jump("smooth"); }
  /** the person just sent: bring their message to the top-ish of the view and follow from there */
  bringIntoView(node) { const e = this.#el; if (!e || !node) return; this.#follow = true; this.#lock = performance.now() + 900; e.scrollTo({ top: Math.max(0, node.offsetTop - 8), behavior: calm() ? "auto" : "smooth" }); }
}
