import { redirect } from "@sveltejs/kit";
// Older and shorter links use /sign; the document links the backend builds use /sign/pdf. Both land on the signing page.
export function load({ url }) { redirect(307, `/sign/pdf${url.search}`); }
