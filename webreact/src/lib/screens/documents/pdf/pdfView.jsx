// pdfView.jsx — draw the pages of a PDF in the browser (pdf.js, loaded on demand) with an overlay slot per page for field boxes.
// ★ Positions everywhere else are fractions of the page; this is the one place they meet pixels: a page is drawn `width` px wide and its overlay is exactly that box.
import { useEffect, useRef, useState } from "react";

let libPromise = null;
async function loadPdfjs() {
  libPromise ??= (async () => {
    const lib = await import("pdfjs-dist");
    lib.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    return lib;
  })();
  return libPromise;
}

/** Load a PDF from bytes (ArrayBuffer). → { pdf, error } — `pdf` is a pdf.js document or null while loading. */
export function usePdf(loadBytes, key) {
  const [state, setState] = useState({ pdf: null, error: null });
  useEffect(() => {
    let live = true, doc = null;
    setState({ pdf: null, error: null });
    (async () => {
      try {
        const lib = await loadPdfjs();
        const bytes = await loadBytes();
        doc = await lib.getDocument({ data: new Uint8Array(bytes).slice() }).promise; // a COPY: pdf.js transfers the buffer it is given, and a second load of the same bytes would find it empty (F898)
        if (live) setState({ pdf: doc, error: null });
      } catch (e) { if (live) setState({ pdf: null, error: e }); }
    })();
    return () => { live = false; try { doc?.destroy(); } catch { /* nothing to release */ } };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** One page on a canvas, `width` px wide; children are drawn on top in an absolutely positioned overlay of the same size. Renders only when scrolled near (lazy). */
export function PdfPage({ pdf, pageNumber, width, children, className = "", onSize }) {
  const wrap = useRef(null), canvas = useRef(null);
  const [near, setNear] = useState(pageNumber <= 2);
  const [height, setHeight] = useState(Math.round(width * 1.294));
  useEffect(() => {
    if (near || !wrap.current || typeof IntersectionObserver === "undefined") { setNear(true); return undefined; }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "600px" });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!pdf || !near) return undefined;
    let cancelled = false, task = null;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvas.current; if (!c || cancelled) return;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      setHeight(Math.round(base.height * scale)); onSize?.({ w: width, h: Math.round(base.height * scale) });
      task = page.render({ canvasContext: c.getContext("2d"), viewport: vp });
      try { await task.promise; } catch { /* a cancelled render */ }
    })();
    return () => { cancelled = true; try { task?.cancel(); } catch { /* done */ } };
  }, [pdf, pageNumber, width, near]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={wrap} className={`relative bg-white shadow-sm ring-1 ring-line ${className}`} style={{ width, height }} data-testid={`pdf-page-${pageNumber}`} data-page={pageNumber}>
      <canvas ref={canvas} style={{ width, height }} className="block" aria-label={`Page ${pageNumber}`} />
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}
