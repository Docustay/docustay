import { Docustay } from "@docustay2026/sdk";
const docustay = () => new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});

// POST { name, email } → sends the template to that person, to be signed inside your page.
export async function POST(req) {
  const { name, email } = await req.json();
  try {
    const doc = await docustay().sendDocument({ templateId: process.env.DOCUSTAY_TEMPLATE_ID, embedded: ["signer_1"], parties: [{ seat: "signer_1", name, email }] });
    return Response.json({ id: doc.id });
  } catch (e) { return Response.json({ error: e.message }, { status: e.status ?? 500 }); }
}
