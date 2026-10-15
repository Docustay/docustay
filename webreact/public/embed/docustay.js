/* Docustay embed — put a signing form on your own website (QUEUE §23.5.8).
 *   <script src="https://YOUR-PRACTICE.example/embed/docustay.js" async></script>
 *   <docustay-form slug="your-link-name" height="760"></docustay-form>
 * It draws one iframe that shows your public signing link (/s/<slug>) from the SAME address this script came from. The visitor types their name and email and signs inside the frame;
 * nothing here reads or stores anything. `height` (pixels, 300–2000) is optional. No library, no build step. */
(function () {
  if (typeof window === "undefined" || window.customElements.get("docustay-form")) return;
  var origin = "";
  try { origin = new URL(document.currentScript && document.currentScript.src ? document.currentScript.src : "", window.location.href).origin; } catch (e) { origin = ""; }
  class DocustayForm extends HTMLElement {
    connectedCallback() {
      if (this.__drawn) return;
      var slug = (this.getAttribute("slug") || "").toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) || !origin) { this.textContent = "This signing form is not set up correctly."; return; }
      var h = parseInt(this.getAttribute("height") || "760", 10);
      h = isNaN(h) ? 760 : Math.max(300, Math.min(2000, h));
      var f = document.createElement("iframe");
      f.src = origin + "/s/" + encodeURIComponent(slug) + "?embed=1";
      f.title = this.getAttribute("title") || "Sign a document";
      f.loading = "lazy";
      f.style.cssText = "width:100%;border:0;display:block;height:" + h + "px";
      f.setAttribute("allow", "clipboard-write");
      this.style.display = "block";
      this.appendChild(f);
      this.__drawn = true;
    }
  }
  window.customElements.define("docustay-form", DocustayForm);
})();
