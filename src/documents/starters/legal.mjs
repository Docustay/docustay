// How a starter is written (Part 31 follow-up): numbered clauses, cross-references that cannot drift, a title block, a signature page and schedules, all as the HTML + text tags the product prints.
// Pure: imports only helpers.mjs. The look (serif, rules, numbers hanging in the margin) is typeset.mjs's CSS; this file only names classes.
//   doc(...parts)                       joins parts, resolves ⟦key⟧ → the section number and ⟦key.2⟧ → "N.2"; an unknown key throws at build time
//   sections([ [key, heading, ...items] ])   items: "text" = numbered clause N.M · ["a", "b"] = lettered sub-clauses of the clause above · {u:"text"} = unnumbered paragraph · {raw:"<table…>"}
import { sig, signedOn, text } from "./helpers.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

export const titleBlock = (title, sub = "") => `<div class="tb"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>`;
export const p = (...t) => `<p>${t.join(" ")}</p>`;
export const rec = (letter, t) => `<p class="rec"><span class="n">${letter}.</span>${t}</p>`;

/** The numbered body of an agreement. Each section is [key, heading, ...items]; numbers run 1, 2, 3 … in the order given, starting at `from`. */
export function sections(list, { from = 1, breaks = [] } = {}) {
  let out = "";
  list.forEach(([key, heading, ...items], i) => {
    const n = from + i; let m = 0, last = 0;
    out += `<!--sec:${key}:${n}--><h2${breaks.includes(key) ? ' class="pb" style="margin-top:0"' : ""}>${n}.&nbsp; ${heading}</h2>`;
    for (const it of items) {
      if (typeof it === "string" && it.startsWith("<table")) out += it;   // a table written straight into a section is kept as a table, not wrapped in a numbered clause
      else if (typeof it === "string") { m += 1; last = m; out += `<!--cl:${key}.${m}:${n}.${m}--><p class="cl"><span class="n">${n}.${m}</span>${it}</p>`; }
      else if (Array.isArray(it)) it.forEach((s, k) => { out += `<p class="sl"><span class="n">(${String.fromCharCode(97 + k)})</span>${s}</p>`; });
      else if (it.u !== undefined) out += `<p>${it.u}</p>`;
      else if (it.raw !== undefined) out += it.raw;
      else throw new Error(`sections: ${key} has an item that is not text, a list, {u} or {raw}`);
    }
    void last;
  });
  return out;
}

/** Light-ruled table. `head` is an array of column titles; `rows` are arrays of cell HTML. `widths` are percentages. */
export function table(head, rows, widths = []) {
  const w = (i) => (widths[i] ? ` style="width:${widths[i]}%"` : "");
  return `<table class="t"><thead><tr>${head.map((h, i) => `<th${w(i)}>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** A schedule or exhibit: starts on its own page. */
export const schedule = (letter, title, ...body) => `<h2 class="sched pb">Schedule ${letter} — ${title}</h2>${body.join("")}`;
/** A further schedule that follows on the same page when there is room. */
export const scheduleNext = (letter, title, ...body) => `<h2 class="sched" style="margin-top:22pt">Schedule ${letter} — ${title}</h2>${body.join("")}`;

/** The signature page. Each seat gets a printed name, a title, a signature and a date, two seats to a row. `seats` is [{role, name?, title?}] (name/title default to fields; `title:false` drops it). */
export function sigPage(seats, { lead = "By signing below, each party agrees to this document and confirms that the person signing has the authority to do so.", witness = null, heading = "Signatures", pb = false } = {}) {
  const cell = (s) => `<td><p class="lbl">${s.role}</p>
<p>${text(s.role, `${s.role} printed name`, "Printed name")}</p><p class="lbl">Printed name</p>
${s.title === false ? "" : `<p>${text(s.role, `${s.role} title`, "Title or capacity")}</p><p class="lbl">Title or capacity</p>`}
<p style="margin-top:14pt">${sig(s.role)}</p><p class="lbl">Signature</p>
<p>${signedOn(s.role)}</p><p class="lbl">Date</p></td>`;
  const rows = []; for (let i = 0; i < seats.length; i += 2) rows.push(`<tr>${cell(seats[i])}${seats[i + 1] ? cell(seats[i + 1]) : "<td></td>"}</tr>`);
  const w = witness ? `<div class="wit keep"><p class="lbl">Witness (optional)</p><table class="sig"><tr><td><p>${text(witness, `${witness} printed name`, "Witness printed name")}</p><p class="lbl">Printed name</p></td><td><p>${sig(witness, "Witness signature")}</p><p class="lbl">Signature</p><p>${signedOn(witness)}</p><p class="lbl">Date</p></td></tr></table></div>` : "";
  return `<div class="keep"><h2${pb ? ' class="pb"' : ""}>${heading}</h2><p>${lead}</p><table class="sig">${rows.join("")}</table>${w}</div>`;
}

/** Joins parts and resolves ⟦key⟧ / ⟦key.n⟧ against the numbering the sections() calls wrote. */
export function doc(...parts) {
  let html = parts.join("");
  const nums = new Map();
  for (const m of html.matchAll(/<!--(sec|cl):([\w.]+):([\d.]+)-->/g)) nums.set(m[2], m[3]);
  html = html.replace(/<!--(sec|cl):[\w.]+:[\d.]+-->/g, "");
  html = html.replace(/⟦([\w.]+)⟧/g, (_, k) => { if (!nums.has(k)) throw new Error(`doc: the reference ⟦${k}⟧ names no section`); return nums.get(k); });
  return html;
}
