import { redirect } from "@sveltejs/kit";
// one front door: the older written templates are templates like any other; they are listed on /templates and edited in Create
export const load = () => { throw redirect(307, "/templates"); };
