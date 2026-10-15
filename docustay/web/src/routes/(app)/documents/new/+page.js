import { redirect } from "@sveltejs/kit";
// one front door: uploading a file is the Upload way of starting in Create
export const load = () => { throw redirect(307, "/create?mode=document&upload=1"); };
