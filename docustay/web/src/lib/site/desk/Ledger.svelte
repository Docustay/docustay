<script>
  import { whenVisible } from "./reveal.js";
  // A live event ledger (sample events, labelled): one row arrives every 2.4 s while it is on screen. The names are the seven real document events.
  const EV = ["documents.document.sent", "documents.document.opened", "documents.document.signed", "documents.document.executed", "documents.document.declined", "documents.document.expired", "documents.document.voided"];
  const order = [0, 1, 2, 2, 3, 0, 1, 2, 4, 3];
  let rows = $state([{ n: 0, t: "09:14:02" }, { n: 1, t: "09:17:40" }]), step = $state(0), timer;
  const clock = (n) => { const s = 9 * 3600 + 14 * 60 + n * 143; return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  const tick = () => { step += 1; rows = [{ n: order[step % order.length], t: clock(step + 2) }, ...rows].slice(0, 6); };
  const vis = (v) => { clearInterval(timer); if (v && !matchMedia("(prefers-reduced-motion: reduce)").matches) timer = setInterval(tick, 2400); };
</script>
<ul class="lg" aria-label="Sample events" {@attach whenVisible(vis)}>{#each rows as r (r.t + r.n)}<li class={r.n === 2 ? "red" : ""}><code>{EV[r.n]}</code><span>{r.t}</span><em>{r.n === 4 ? "waiting" : "delivered"}</em></li>{/each}</ul>
<style>
  .lg { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; } .lg li { display: grid; grid-template-columns: 1fr auto auto; gap: 14px; align-items: center; border: 1px solid #2a2a2c; background: #131315; padding: 10px 14px; } .lg li.red { border-color: #8585fd; }
  code { font: 500 12.5px/1 var(--font-mono); color: #f4f2ec; } span, em { font: 500 11px/1 var(--font-mono); color: #8c877e; font-style: normal; letter-spacing: .06em; } em { color: #7bd88f; text-transform: uppercase; }
  @media (max-width: 600px) { .lg li { grid-template-columns: 1fr auto; } .lg em { display: none; } code { font-size: 11px; } }
</style>
