import { redirect } from "@sveltejs/kit";
// Launch step 7: Payments is a section of Billing
export const load = () => { throw redirect(307, "/billing?tab=payments"); };
