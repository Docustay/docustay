// <docustay-sign url="…"> — a signing form inside your own page. No dependencies, no build step.
// `url` is the link from POST /api/v1/documents/{id}/embed-session (one hour; made on YOUR server with your API key — never put the key in a browser).
// The form sends events to this page, and only this page: the session link names your website, Docustay checks it against the list in Settings → Developers → Embedding,
// and this element accepts a message only from that form's own origin and only from its own frame.

export const EVENTS = Object.freeze(["ready", "waiting", "completed", "declined", "error", "resize"]);

// If nothing at all arrives from the frame within WATCH_MS the link was refused, has expired, or this website is not on the allowed list: the browser then blocks the frame silently (frame-ancestors), so the page tells the host itself.
const WATCH_MS = 15000, NOT_LOADED = "The form did not load: the link was refused, has expired, or this website is not on the allowed list.";

const STYLE = ":host{display:block;position:relative}iframe{display:block;border:0;width:100%;height:100%;min-height:var(--docustay-min-height,480px)}";

/* R11: importing this on a server (Next.js, Nuxt, Angular Universal) has no HTMLElement; the class is then an empty shell and nothing is defined, so the import never throws */
const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};
export class DocustaySign extends Base {
  static observedAttributes = ["url", "height", "auto-height", "title"];
  #frame = null; #onMessage = null; #watch = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = STYLE;
    this.#frame = document.createElement("iframe");
    this.#frame.setAttribute("referrerpolicy", "no-referrer");
    this.#frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    this.#frame.setAttribute("allow", "clipboard-write");
    root.append(style, this.#frame);
  }

  get url() { return this.getAttribute("url") ?? ""; }
  set url(v) { if (v == null || v === "") this.removeAttribute("url"); else this.setAttribute("url", String(v)); }

  connectedCallback() {
    this.#apply();
    this.#onMessage = (e) => this.#receive(e);
    window.addEventListener("message", this.#onMessage);
  }
  disconnectedCallback() { clearTimeout(this.#watch); if (this.#onMessage) window.removeEventListener("message", this.#onMessage); this.#onMessage = null; }
  attributeChangedCallback() { if (this.isConnected) this.#apply(); }

  #apply() {
    const url = this.url;
    this.#frame.setAttribute("title", this.getAttribute("title") || "Sign this document");
    if (url) { let ok = false; try { const u = new URL(url); ok = u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)); } catch { /* not a url */ } if (!ok) { this.#frame.removeAttribute("src"); return; } if (this.#frame.getAttribute("src") !== url) this.#frame.setAttribute("src", url); }
    else this.#frame.removeAttribute("src");
    const h = this.getAttribute("height");
    this.style.height = this.hasAttribute("auto-height") ? "" : (h ? (/^\d+$/.test(h) ? `${h}px` : h) : "720px");
    this.#arm();
  }

  #arm() { clearTimeout(this.#watch); if (!this.#frame.getAttribute("src")) return; this.#watch = setTimeout(() => { const detail = { message: NOT_LOADED }; this.dispatchEvent(new CustomEvent("error", { detail })); this.dispatchEvent(new CustomEvent("docustay", { detail: { type: "error", ...detail } })); }, WATCH_MS); }

  #receive(e) {
    const frame = this.#frame;
    let origin; try { origin = new URL(this.url).origin; } catch { return; }
    if (e.source !== frame.contentWindow || e.origin !== origin) return;      // only this frame, only the form's own origin
    const d = e.data;
    if (!d || d.source !== "docustay" || d.version !== 1 || !EVENTS.includes(d.type)) return;
    clearTimeout(this.#watch);   // the frame is alive and talking
    const { source, version, type, ...detail } = d;
    if (type === "resize" && this.hasAttribute("auto-height") && Number.isFinite(detail.height)) this.style.height = `${Math.min(Math.max(Math.ceil(detail.height), 320), 20000)}px`;
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent("docustay", { detail: { type, ...detail } }));
  }
}

/** Register the element (once). Safe to call again. */
export function defineDocustaySign(name = "docustay-sign") {
  if (typeof customElements !== "undefined" && !customElements.get(name)) customElements.define(name, DocustaySign);
}
defineDocustaySign();

export { DocustayBuilder, defineDocustayBuilder, BUILDER_EVENTS } from "./builder.js";
export { DocustayScribe, defineDocustayScribe, SCRIBE_EVENTS } from "./scribe.js";
