"""Docustay + Python (standard library only): send, embedded signing page, and a webhook receiver.

    DOCUSTAY_API_KEY=dsk_test_... DOCUSTAY_TEMPLATE_ID=... DOCUSTAY_WEBHOOK_SECRET=whsec_... python app.py
"""
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer
from docustay import Docustay, DocustayError, verify_webhook

kw = {"base_url": os.environ["DOCUSTAY_URL"]} if os.environ.get("DOCUSTAY_URL") else {}
docustay = Docustay(os.environ["DOCUSTAY_API_KEY"], **kw)
ORIGIN = os.environ.get("PUBLIC_ORIGIN", "http://localhost:3000")  # the website you listed in Settings -> Documents -> Embedding


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (json.dumps(body) if ctype == "application/json" else body).encode()
        self.send_response(status); self.send_header("content-type", ctype); self.send_header("content-length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("content-length", 0)))
        try:
            if self.path == "/webhooks":  # the signature is over the exact bytes Docustay sent
                event = verify_webhook(os.environ["DOCUSTAY_WEBHOOK_SECRET"], dict(self.headers), raw.decode())
                print("webhook", event.get("topic"), event.get("subject_id"))
                return self._send(204, b"", "text/plain")
            if self.path == "/send":
                p = json.loads(raw or b"{}")
                doc = docustay.send_document(os.environ["DOCUSTAY_TEMPLATE_ID"], [{"seat": "signer_1", "name": p["name"], "email": p["email"]}], embedded=["signer_1"])
                return self._send(200, {"id": doc["id"]})
        except DocustayError as e:
            return self._send(e.status or 500, {"error": str(e)})
        except Exception as e:
            print("rejected:", e); return self._send(400, {"error": "bad request"})
        self._send(404, {"error": "not found"})

    def do_GET(self):
        if self.path.startswith("/sign/"):
            try:
                url = docustay.embed_session(self.path.split("/")[2], "signer_1", ORIGIN)["url"]
            except DocustayError as e:
                return self._send(e.status or 500, str(e), "text/plain")
            return self._send(200, f'<!doctype html><meta charset=utf-8><title>Sign</title><script type="module" src="https://esm.sh/@docustay2026/embed"></script><docustay-sign url="{url}" height="720"></docustay-sign>', "text/html")
        self._send(404, {"error": "not found"})


if __name__ == "__main__":
    HTTPServer(("", int(os.environ.get("PORT", "3000"))), Handler).serve_forever()
