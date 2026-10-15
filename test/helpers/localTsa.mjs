// A real RFC 3161 time-stamp authority for tests: signs genuine TimeStampResp tokens (exclusive critical id-kp-timeStamping certificate, nonce and message imprint echoed), so `pdf-rfc3161` accepts them exactly as it would a public service's.
// `startLocalTsa({ up })` -> { url, setUp(bool), stop() }. While `up` is false it answers 503, like a service that is down.
import http from "node:http";
import { webcrypto, createHash } from "node:crypto";
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";

const crypto = webcrypto;
pkijs.setEngine("test-tsa", new pkijs.CryptoEngine({ name: "test-tsa", crypto, subtle: crypto.subtle }));

async function makeCert() {
  const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
  const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
  const cert = new pkijs.Certificate();
  cert.version = 2; cert.serialNumber = new asn1js.Integer({ value: 1 });
  const name = [new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Test Time-Stamp Authority" }) })];
  cert.issuer.typesAndValues.push(...name); cert.subject.typesAndValues.push(...name);
  cert.notBefore.value = new Date(Date.now() - 86400e3); cert.notAfter.value = new Date(Date.now() + 365 * 86400e3);
  cert.extensions = [
    new pkijs.Extension({ extnID: "2.5.29.19", critical: false, extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false) }),
    new pkijs.Extension({ extnID: "2.5.29.37", critical: true, extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.8"] }).toSchema().toBER(false) }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  return { cert, key: keys.privateKey };
}

/** The address to put in DOCUMENT_TSA_URL (before the document code is imported). pdf-rfc3161 refuses literal loopback addresses, so the test uses this made-up public-looking name and `startLocalTsa` routes it to the local server through a fetch shim. */
export const TEST_TSA_URL = "http://tsa.local-test.example/";
let routeTo = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = typeof input === "string" ? input : input?.url ?? String(input);
  if (u.startsWith(TEST_TSA_URL)) { if (!routeTo) return Promise.reject(new TypeError("fetch failed (no time-stamp authority is running)")); return realFetch(routeTo, init); }
  return realFetch(input, init);
};

export async function startLocalTsa({ up = true } = {}) {
  const { cert, key } = await makeCert();
  let isUp = up, serial = 1000;
  // id-aa-signingCertificateV2: the signer certificate named by its SHA-256 hash (RFC 5035), which a time-stamp token must carry
  const certHash = createHash("sha256").update(Buffer.from(cert.toSchema(true).toBER(false))).digest();
  const essCertId = new pkijs.Attribute({ type: "1.2.840.113549.1.9.16.2.47", values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: certHash })] })] })] })] });
  const respond = async (body) => {
    const req = pkijs.TimeStampReq.fromBER(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    const tst = new pkijs.TSTInfo({
      version: 1, policy: "1.3.6.1.4.1.99999.1", messageImprint: req.messageImprint, serialNumber: new asn1js.Integer({ value: serial++ }),
      genTime: new Date(), nonce: req.nonce, ordering: false,
    });
    const tstDer = tst.toSchema().toBER(false);
    const signed = new pkijs.SignedData({
      version: 3, encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.9.16.1.4", eContent: new asn1js.OctetString({ valueHex: tstDer }) }),
      signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }), signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [
        new pkijs.Attribute({ type: "1.2.840.113549.1.9.3", values: [new asn1js.ObjectIdentifier({ value: "1.2.840.113549.1.9.16.1.4" })] }),
        new pkijs.Attribute({ type: "1.2.840.113549.1.9.4", values: [new asn1js.OctetString({ valueHex: createHash("sha256").update(Buffer.from(tstDer)).digest() })] }), essCertId] }) })],
      certificates: [cert],
    });
    await signed.sign(key, 0, "SHA-256");
    const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) });
    const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }), timeStampToken: token });
    return Buffer.from(resp.toSchema().toBER(false));
  };
  const server = http.createServer((rq, rs) => {
    const chunks = []; rq.on("data", (c) => chunks.push(c));
    rq.on("end", async () => {
      if (!isUp) { rs.writeHead(503); rs.end("down"); return; }
      try { const out = await respond(Buffer.concat(chunks)); rs.writeHead(200, { "content-type": "application/timestamp-reply" }); rs.end(out); }
      catch (e) { if (process.env.TSA_DEBUG) console.error("tsa:", e.stack); rs.writeHead(500); rs.end(String(e.message)); }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  routeTo = `http://127.0.0.1:${server.address().port}/`;
  return { url: TEST_TSA_URL, setUp: (v) => { isUp = v; }, stop: () => { routeTo = null; return new Promise((r) => server.close(r)); } };
}
