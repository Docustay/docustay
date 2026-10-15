// Generates this install's OWN self-signed PDF-sealing certificate: node make-signing-cert.mjs <p12-base64-out> <cert-pem-out>
import forge from "node-forge";
import { writeFileSync, chmodSync } from "node:fs";
const [p12Out, crtOut] = process.argv.slice(2);
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey; cert.serialNumber = "01";
cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(); cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
const attrs = [{ name: "commonName", value: "Docustay Document Signing" }, { name: "organizationName", value: "Docustay (self-hosted)" }];
cert.setSubject(attrs); cert.setIssuer(attrs);
cert.setExtensions([{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true, nonRepudiation: true }]);
cert.sign(keys.privateKey, forge.md.sha256.create());
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, "", { algorithm: "3des" });
writeFileSync(p12Out, Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary").toString("base64"), { mode: 0o600 });
writeFileSync(crtOut, forge.pki.certificateToPem(cert), { mode: 0o644 });
console.log("docustay: signing certificate written");
