// Site pass 3 (10 Oct 2026): the extra sections for every page under the five header tabs. ADD maps a page path to blocks that go in before the page's FAQ. Each block is real: it draws a screen, a record or a call the product has.
// Numbers are never typed here: __FREE_DOCS__, __PRO_PRICE__ and friends are filled from plans.js by the registry; everything else is a name from the docs or the features list.
import { PRODUCT_ADD } from "./pass3-product.js";
import { USECASE_ADD } from "./pass3-usecases.js";
import { DEV_ADD } from "./pass3-dev.js";
import { TRUST_ADD } from "./pass3-trust.js";
import { TOOLS_ADD } from "./pass3-tools.js";
export const ADD = { ...PRODUCT_ADD, ...USECASE_ADD, ...DEV_ADD, ...TRUST_ADD, ...TOOLS_ADD };
