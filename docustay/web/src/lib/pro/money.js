// Whole cents to dollars, the one way every billing screen writes money ("$0.50", "$12.40", "$300").
export const usd = (minor) => { const n = Number(minor ?? 0) / 100; return `$${Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2)}`; };
