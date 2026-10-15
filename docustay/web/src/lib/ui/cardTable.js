// For a plain <table> on a phone: every body cell is given the label of its column header (data-label), and the .card-table rules in app.css turn each row into a small card that prints "LABEL value" on a line per column, so no column is hidden behind a scroll box. (DataTable does the same by itself.)
export function cardTable(node) {
  const label = () => {
    const heads = [...node.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    for (const tr of node.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => { if (td.tagName === "TD" && td.getAttribute("data-label") !== (heads[i] ?? "")) td.setAttribute("data-label", heads[i] ?? ""); });
  };
  label();
  const watch = new MutationObserver(label);
  watch.observe(node, { childList: true, subtree: true });
  return { destroy() { watch.disconnect(); } };
}
