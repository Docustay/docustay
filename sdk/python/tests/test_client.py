import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from docustay import Docustay, DocustayError, verify_webhook


def serve(handler):
    calls = []

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _do(self):
            n = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(n)) if n else None
            calls.append({"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
            status, payload, extra = handler(calls[-1], len(calls))
            raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/pdf" if isinstance(payload, bytes) else "application/json")
            for k, v in extra.items():
                self.send_header(k, v)
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        do_GET = do_POST = _do

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return calls, f"http://127.0.0.1:{srv.server_port}", srv


class ClientTests(unittest.TestCase):
    def test_keys_post_has_idempotency_get_does_not(self):
        calls, base, srv = serve(lambda c, n: (200, {"id": "d1", "state": "sent"}, {}))
        d = Docustay("gl_test_abc", base_url=base)
        self.assertTrue(d.test_mode)
        d.send_document("t", [{"seat": "signer_1", "name": "A", "email": "a@x.test"}], title="Lease")
        d.get_document("d1")
        self.assertEqual(calls[0]["headers"]["authorization"], "Bearer gl_test_abc")
        self.assertGreaterEqual(len(calls[0]["headers"]["idempotency-key"]), 8)
        self.assertEqual(calls[0]["body"]["title"], "Lease")
        self.assertNotIn("idempotency-key", calls[1]["headers"])
        srv.shutdown()

    def test_retry_reuses_the_same_idempotency_key(self):
        calls, base, srv = serve(lambda c, n: (503, {"error": {"kind": "dependency", "message": "x", "retryable": True}}, {}) if n == 1 else (200, {"id": "d1", "state": "sent"}, {}))
        out = Docustay("gl_live_k", base_url=base).send_document("t", [])
        self.assertEqual(out["id"], "d1")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["headers"]["idempotency-key"], calls[1]["headers"]["idempotency-key"])
        srv.shutdown()

    def test_404_is_raised_with_kind_and_request_id_and_not_retried(self):
        calls, base, srv = serve(lambda c, n: (404, {"error": {"kind": "not_found", "message": "no such document", "requestId": "r1", "retryable": False}}, {}))
        with self.assertRaises(DocustayError) as cm:
            Docustay("gl_live_k", base_url=base).get_document("zzz")
        self.assertEqual((cm.exception.status, cm.exception.kind, cm.exception.request_id), (404, "not_found", "r1"))
        self.assertEqual(len(calls), 1)
        srv.shutdown()

    def test_each_document_follows_the_cursor(self):
        def h(c, n):
            return (200, {"documents": [{"id": "b"}], "page": {"nextCursor": None}}, {}) if "cursor=c2" in c["path"] else (200, {"documents": [{"id": "a"}], "page": {"nextCursor": "c2"}}, {})
        calls, base, srv = serve(h)
        self.assertEqual([x["id"] for x in Docustay("gl_live_k", base_url=base).each_document(state="executed")], ["a", "b"])
        self.assertIn("state=executed", calls[0]["path"])
        srv.shutdown()

    def test_file_template_is_base64_and_pdf_comes_back_as_bytes(self):
        calls, base, srv = serve(lambda c, n: (201, {"templateId": "t", "fields": 6, "warnings": []}, {}) if c["method"] == "POST" else (200, b"%PDF-1.7 x", {}))
        d = Docustay("gl_live_k", base_url=base)
        d.create_template_from_file("n", "n.pdf", bytes([1, 2, 3]))
        self.assertEqual(calls[0]["body"]["file"], "AQID")
        self.assertTrue(d.download_signed_pdf("d1").startswith(b"%PDF"))
        srv.shutdown()


class WebhookTests(unittest.TestCase):
    vec = json.load(open(os.path.join(os.path.dirname(__file__), "server_vector.json")))

    def test_verifies_a_delivery_signed_by_the_real_server_code(self):
        v = self.vec
        self.assertEqual(verify_webhook(v["secret"], v["headers"], v["body"], now=v["ts"] + 5)["id"], "e9")

    def test_refuses_a_changed_body_a_wrong_secret_and_an_old_timestamp(self):
        v = self.vec
        with self.assertRaisesRegex(ValueError, "does not match"):
            verify_webhook(v["secret"], v["headers"], v["body"] + " ", now=v["ts"])
        with self.assertRaisesRegex(ValueError, "does not match"):
            verify_webhook("whsec_" + "QUJD" * 11, v["headers"], v["body"], now=v["ts"])
        with self.assertRaisesRegex(ValueError, "not in the whsec_… form"):
            verify_webhook("whsec_not a secret!", v["headers"], v["body"], now=v["ts"])
        with self.assertRaisesRegex(ValueError, "not in the whsec_… form"):
            verify_webhook("whsec_", v["headers"], v["body"], now=v["ts"])
        with self.assertRaisesRegex(ValueError, "tolerance"):
            verify_webhook(v["secret"], v["headers"], v["body"], now=v["ts"] + 4000)


if __name__ == "__main__":
    unittest.main()


class BadResponseTest(unittest.TestCase):
    """D-023: a 200 answer that is not JSON (a web page, a wrong base_url) is a typed error that says what to check, never a raw JSON parse error."""

    def test_html_answer_is_a_typed_error_naming_base_url(self):
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(b"<!DOCTYPE html><html>Not the API</html>")
            def log_message(self, *a): pass
        srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
        d = Docustay("gl_test_x", base_url=f"http://127.0.0.1:{srv.server_address[1]}", max_retries=0)
        with self.assertRaises(DocustayError) as c:
            d.get_document("abc")
        self.assertEqual(c.exception.kind, "bad_response"); self.assertIn("base_url", str(c.exception)); srv.shutdown()
