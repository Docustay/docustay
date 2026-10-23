// The developers hub is a hand-built page (like the home page); it shows plan numbers from plans.js, with the live prices when billing answers quickly.
import { viewPlans } from "$lib/site/plans.js";
export const prerender = true;
export const load = async () => ({ plans: viewPlans(null) });
