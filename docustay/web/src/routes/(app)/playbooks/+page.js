import { redirect } from "@sveltejs/kit";
// Launch step 7: Playbooks are the "Packs" section of Plays
export const load = () => { throw redirect(307, "/plays?tab=packs"); };
