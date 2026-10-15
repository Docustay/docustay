import { redirect } from "@sveltejs/kit";
// Launch step 7: Contracts is a view of Documents
export const load = () => { throw redirect(307, "/documents?view=contracts"); };
