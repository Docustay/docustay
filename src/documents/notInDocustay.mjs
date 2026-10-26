// Docustay v1: a few island routes still serve the platform's screens (webreact) but are not part of Docustay any more. They answer a Docustay workspace with the same 404 as a route that does not exist,
// and are left exactly as they were for every other product. The island never learns the product by name: it asks the host's `brand.isDocustay` port.
import { notFound } from "../http/errors.mjs";
import { ports } from "./ports.mjs";

/** Throws the ordinary 404 for a Docustay workspace. Call first in a gated writer. `tx` is a tenant transaction. */
export async function notInDocustay(tx, what = "That page does not exist.") {
  if (await (await ports()).brand?.isDocustay?.(tx)) throw notFound(what);
}

/** Throws the ordinary 404 on the HOSTED Docustay service only (a self-hosted install, and every other product, is unchanged). Item 9: own sending domain, SMTP server, mailbox and signing address. */
export async function notOnHostedDocustay(tx, what = "That page does not exist.") {
  if (process.env.KEYSTONE_SELF_HOST === "1") return;
  await notInDocustay(tx, what);
}
