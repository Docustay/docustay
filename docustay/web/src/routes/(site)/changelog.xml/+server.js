// The changelog as an Atom feed, so "Subscribe" is a real subscription. Built from the same list the page shows.
import { CHANGES } from "$lib/site/changelog.js";
export const prerender = true;
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const iso = (d) => { const m = /^(\w+) (\d{4})$/.exec(d); return m ? new Date(`${m[1]} 1, ${m[2]} 12:00 UTC`).toISOString() : new Date(d).toISOString(); };
export function GET() {
  const upd = CHANGES.length ? iso(CHANGES[0].date) : new Date().toISOString();
  const body = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>Docustay changelog</title><link href="https://docustay.app/changelog"/><link rel="self" href="https://docustay.app/changelog.xml"/><id>https://docustay.app/changelog</id><updated>${upd}</updated>${CHANGES.map((c, i) => `<entry><title>${esc(c.title)}</title><id>https://docustay.app/changelog#${i}</id><updated>${iso(c.date)}</updated><link href="https://docustay.app/changelog"/><content type="html">${esc(`<ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`)}</content></entry>`).join("")}</feed>`;
  return new Response(body, { headers: { "content-type": "application/atom+xml; charset=utf-8" } });
}
