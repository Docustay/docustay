import { Docustay } from "@docustay2026/sdk";
import Form from "./form";

// A server component: the one-hour link is made on the server, so the API key never reaches the browser.
export default async function Page({ searchParams }) {
  const { id } = await searchParams;
  const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
  const { url } = await docustay.embedSession(id, { seat: "signer_1", origin: process.env.PUBLIC_ORIGIN ?? "http://localhost:3000" });
  return <Form url={url} />;
}
