// Site rebuild (13 Oct 2026): pass-4 blocks per page family, merged AFTER pass 3 so they land before the FAQ in the order written.
import { ADD4_DEV } from "./pass4-dev.js";
import { ADD4_PRODUCT } from "./pass4-product.js";
import { ADD4_USECASE } from "./pass4-usecase.js";
import { ADD4_EXTRA } from "./pass4-extra.js";
import { ADD4_MISC } from "./pass4-misc.js";
import { ADD4_LEGAL } from "./pass4-legal.js";
const merge = (...maps) => { const out = {}; for (const m of maps) for (const [k, v] of Object.entries(m)) out[k] = [...(out[k] ?? []), ...v]; return out; };
export const ADD4 = merge(ADD4_DEV, ADD4_PRODUCT, ADD4_USECASE, ADD4_MISC, ADD4_LEGAL, ADD4_EXTRA);
