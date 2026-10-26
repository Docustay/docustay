import { redirect } from "@sveltejs/kit";
// The old Write screen is replaced by the new flow (Who signs → Prepare). Old links keep working.
export const load = ({ url }) => { throw redirect(307, `/create/flow${url.search}`); };
