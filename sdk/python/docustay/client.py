from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Iterator, Optional

VERSION = "0.1.0"


class DocustayError(Exception):
    def __init__(self, status: int, body: Optional[dict], headers: Any = None):
        e = (body or {}).get("error", {}) if isinstance(body, dict) else {}
        super().__init__(e.get("message") or f"Docustay request failed ({status})")
        self.status = status
        self.kind = e.get("kind", "unknown")
        self.request_id = e.get("requestId") or (headers.get("x-request-id") if headers else None)
        self.retryable = e.get("retryable") is True
        try:
            self.retry_after_seconds = float(headers.get("retry-after")) if headers and headers.get("retry-after") else None
        except ValueError:
            self.retry_after_seconds = None
        self.detail = e.get("detail")


class Docustay:
    """Client for the Docustay API. `api_key` comes from Settings → Developers ("dsk_test_…" keys, and older "gl_test_…" keys, are test mode)."""

    def __init__(self, api_key: str, base_url: str = "https://app.docustay.app", max_retries: int = 2, timeout: float = 30.0):
        if not api_key:
            raise TypeError("Docustay: an API key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.timeout = timeout
        self.test_mode = api_key.startswith(("gl_test_", "dsk_test_"))

    # -- transport ---------------------------------------------------------
    def _request(self, method: str, path: str, query: Optional[dict] = None, body: Any = None, idempotency_key: Optional[str] = None, raw: bool = False):
        q = {k: v for k, v in (query or {}).items() if v is not None}
        url = f"{self.base_url}{path}" + (("?" + urllib.parse.urlencode(q)) if q else "")
        key = (idempotency_key or str(uuid.uuid4())) if method == "POST" else None  # one key for every retry of this call
        headers = {"authorization": f"Bearer {self.api_key}", "accept": "*/*" if raw else "application/json", "user-agent": f"docustay-python/{VERSION}"}
        data = None
        if body is not None:
            headers["content-type"] = "application/json"
            data = json.dumps(body).encode()
        if key:
            headers["idempotency-key"] = key
        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    payload = res.read()
                    if raw:
                        return payload
                    try:
                        return json.loads(payload)
                    except ValueError:
                        raise DocustayError(res.status, {"error": {"kind": "bad_response", "message": f"The server at {self.base_url} answered with something that is not Docustay's API ({len(payload)} bytes that are not JSON). Check the base_url option: the default is https://app.docustay.app, and a self-hosted or sandbox server needs its own address."}}, res.headers)
            except urllib.error.HTTPError as e:
                text = e.read()
                try:
                    parsed = json.loads(text)
                except ValueError:
                    parsed = None
                err = DocustayError(e.code, parsed, e.headers)
                if (e.code == 429 or e.code >= 500) and attempt < self.max_retries:
                    time.sleep(min(err.retry_after_seconds, 30) if err.retry_after_seconds else _backoff(attempt))
                    attempt += 1
                    continue
                raise err from None
            except (urllib.error.URLError, TimeoutError):
                if attempt < self.max_retries:
                    time.sleep(_backoff(attempt))
                    attempt += 1
                    continue
                raise

    # -- documents ---------------------------------------------------------
    def send_document(self, template_id: str, parties: list, *, title: Optional[str] = None, message: Optional[str] = None, subject: Optional[str] = None, expiry_days: Optional[int] = None, metadata: Optional[dict] = None, external_id: Optional[str] = None, embedded: Optional[list] = None, values: Optional[dict] = None, idempotency_key: Optional[str] = None) -> dict:
        """Send a template. `parties` is [{"seat": "signer_1", "name": "…", "email": "…"}]. Returns {"id", "state"}."""
        body = {"templateId": template_id, "parties": parties}
        for k, v in (("title", title), ("message", message), ("subject", subject), ("expiryDays", expiry_days), ("metadata", metadata), ("externalId", external_id), ("embedded", embedded), ("values", values)):
            if v is not None:
                body[k] = v
        return self._request("POST", "/api/v1/documents/send", body=body, idempotency_key=idempotency_key)

    def get_document(self, document_id: str) -> dict:
        return self._request("GET", f"/api/v1/documents/{urllib.parse.quote(document_id)}")

    def list_documents(self, state: Optional[str] = None, limit: Optional[int] = None, cursor: Optional[str] = None, external_id: Optional[str] = None, metadata: Optional[dict] = None) -> dict:
        """Filter by your own reference: external_id, and metadata={"key": "value"} (a document must match every pair)."""
        query = {"state": state, "limit": limit, "cursor": cursor, "externalId": external_id}
        for k, v in (metadata or {}).items():
            query[f"metadata[{k}]"] = v
        return self._request("GET", "/api/v1/documents", query=query)

    def each_document(self, state: Optional[str] = None, limit: Optional[int] = None) -> Iterator[dict]:
        """Every document, page after page."""
        cursor = None
        while True:
            page = self.list_documents(state=state, limit=limit, cursor=cursor)
            yield from page["documents"]
            cursor = (page.get("page") or {}).get("nextCursor")
            if not cursor:
                return

    def download_signed_pdf(self, document_id: str) -> bytes:
        return self._request("GET", f"/api/v1/documents/{urllib.parse.quote(document_id)}/signed.pdf", raw=True)

    def audit_log_csv(self, document_id: str) -> str:
        return self._request("GET", f"/api/v1/documents/{urllib.parse.quote(document_id)}/audit-log.csv", raw=True).decode("utf-8")

    def embed_session(self, document_id: str, seat: str, origin: str, idempotency_key: Optional[str] = None) -> dict:
        """A one-hour embedded signing session for a seat that was sent in `embedded`: {"id", "seat", "url", "expiresAt"}. `origin` is the website that will show it."""
        return self._request("POST", f"/api/v1/documents/{urllib.parse.quote(document_id)}/embed-session", body={"seat": seat, "origin": origin}, idempotency_key=idempotency_key)

    def scribe_session(self, origin: str, name: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        """A one-hour link for an iframe or <docustay-scribe> on one of your allowed websites. Draft-only: it can make drafts and ask for a send to be approved, never send."""
        body = {"origin": origin}
        if name:
            body["name"] = name
        return self._request("POST", "/api/v1/embedded/scribe-session", body=body, idempotency_key=idempotency_key)

    def builder_session(self, origin: str, name: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        """A one-hour link for an iframe or <docustay-builder> on one of your allowed websites (the embeddable template builder)."""
        body = {"origin": origin}
        if name:
            body["name"] = name
        return self._request("POST", "/api/v1/embedded/builder-session", body=body, idempotency_key=idempotency_key)

    def remind(self, document_id: str, seat: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        return self._request("POST", f"/api/v1/documents/{urllib.parse.quote(document_id)}/remind", body={"seat": seat} if seat else {}, idempotency_key=idempotency_key)

    def test_sign(self, document_id: str, seat: str, idempotency_key: Optional[str] = None) -> dict:
        """TEST MODE ONLY: sign one seat of a test document with sample answers, so an automated test can finish a signature. A live key is refused."""
        return self._request("POST", f"/api/v1/documents/{urllib.parse.quote(document_id)}/test-sign", body={"seat": seat}, idempotency_key=idempotency_key)

    def list_emails(self, document_id: Optional[str] = None, to: Optional[str] = None, status: Optional[str] = None, kind: Optional[str] = None, limit: Optional[int] = None, cursor: Optional[str] = None) -> dict:
        return self._request("GET", "/api/v1/emails", query={"documentId": document_id, "to": to, "status": status, "kind": kind, "limit": limit, "cursor": cursor})

    # -- webhooks ----------------------------------------------------------

    def list_webhook_topics(self) -> dict:
        return self._request("GET", "/api/v1/webhooks/topics")

    def list_webhooks(self) -> dict:
        return self._request("GET", "/api/v1/webhooks")

    def create_webhook(self, event_types: list, url: Optional[str] = None, relay: Optional[bool] = None, name: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        """Add a webhook: a public https `url`, or relay=True for one that `docustay listen` fetches to your computer. The secret is in the answer once."""
        body = {"eventTypes": event_types}
        if url: body["url"] = url
        if relay: body["relay"] = True
        if name: body["name"] = name
        return self._request("POST", "/api/v1/webhooks", body=body, idempotency_key=idempotency_key)

    def delete_webhook(self, webhook_id: str) -> dict:
        return self._request("DELETE", f"/api/v1/webhooks/{urllib.parse.quote(webhook_id)}")

    def test_webhook(self, webhook_id: str, topic: Optional[str] = None) -> dict:
        return self._request("POST", f"/api/v1/webhooks/{urllib.parse.quote(webhook_id)}/test", body={"topic": topic} if topic else {})

    def rotate_webhook_secret(self, webhook_id: str, window_hours: Optional[int] = None) -> dict:
        return self._request("POST", f"/api/v1/webhooks/{urllib.parse.quote(webhook_id)}/rotate", body={"windowHours": window_hours} if window_hours else {})

    def list_webhook_deliveries(self, webhook_id: str) -> dict:
        return self._request("GET", f"/api/v1/webhooks/{urllib.parse.quote(webhook_id)}/deliveries")

    def fetch_relay_events(self, webhook_id: str, after: Optional[str] = None, wait: Optional[int] = None, limit: Optional[int] = None) -> dict:
        return self._request("GET", f"/api/v1/webhooks/{urllib.parse.quote(webhook_id)}/relay", query={"after": after, "wait": wait, "limit": limit})

    def delete_draft(self, document_id: str) -> dict:
        """Delete a draft that was never sent. A sent document answers 409: void it instead."""
        return self._request("DELETE", f"/api/v1/documents/{urllib.parse.quote(document_id)}")

    def void_document(self, document_id: str, reason: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        return self._request("POST", f"/api/v1/documents/{urllib.parse.quote(document_id)}/void", body={"reason": reason} if reason else {}, idempotency_key=idempotency_key)

    # -- templates ---------------------------------------------------------
    def list_templates(self) -> dict:
        return self._request("GET", "/api/v1/documents/templates")

    def get_template(self, template_id: str) -> dict:
        return self._request("GET", f"/api/v1/templates/{urllib.parse.quote(template_id)}")

    def create_template_from_html(self, name: str, html: str, paper: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        body = {"name": name, "html": html}
        if paper:
            body["paper"] = paper
        return self._request("POST", "/api/v1/templates/html", body=body, idempotency_key=idempotency_key)

    def create_template_from_source(self, name: str, source: dict, profile: Optional[str] = None, paper: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        """Keep a document source (shared-editor JSON) as a template. Returns {"templateId", "profile", "version", "hash", "warnings"}."""
        body = {"name": name, "source": source}
        if profile:
            body["profile"] = profile
        if paper:
            body["paper"] = paper
        return self._request("POST", "/api/v1/templates/source", body=body, idempotency_key=idempotency_key)

    # -- the v2 flow: words and people ---------------------------------------
    def create_document(self, title: str, source: dict, people: list, facts: Optional[dict] = None, variable_values: Optional[dict] = None, paper: Optional[str] = None, send: Optional[dict] = None, description: Optional[str] = None, send_now: bool = False, metadata: Optional[dict] = None, external_id: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        """Make a document from a source and people ({"name", "email", "role"?, "action"?, "order"?}). A draft unless send_now. Returns {"id", "state", "roles", "warnings"}."""
        body = {"title": title, "source": source, "people": people}
        for k, v in (("facts", facts), ("variableValues", variable_values), ("paper", paper), ("send", send), ("description", description), ("metadata", metadata), ("externalId", external_id)):
            if v:
                body[k] = v
        if send_now:
            body["sendNow"] = True
        return self._request("POST", "/api/v1/documents", body=body, idempotency_key=idempotency_key)

    def check_document(self, source: dict, facts: Optional[dict] = None, people: Optional[list] = None, variable_values: Optional[dict] = None, require_signature: Optional[bool] = None, for_template: bool = False) -> dict:
        body = {"source": source}
        if facts:
            body["facts"] = facts
        if people:
            body["people"] = people
        if variable_values:
            body["variableValues"] = variable_values
        if require_signature is not None:
            body["requireSignature"] = require_signature
        if for_template:
            body["forTemplate"] = True
        return self._request("POST", "/api/v1/documents/check", body=body)

    def get_draft_source(self, document_id: str) -> dict:
        return self._request("GET", f"/api/v1/documents/{urllib.parse.quote(document_id)}/source")

    def revise_document(self, document_id: str, source: dict, facts: Optional[dict] = None, variable_values: Optional[dict] = None, role_map: Optional[dict] = None, idempotency_key: Optional[str] = None) -> dict:
        """Change the words of a draft. A NEW draft takes the people and choices and the old one is deleted: use the returned id."""
        body = {"source": source}
        for k, v in (("facts", facts), ("variableValues", variable_values), ("roleMap", role_map)):
            if v:
                body[k] = v
        return self._request("POST", f"/api/v1/documents/{urllib.parse.quote(document_id)}/revise", body=body, idempotency_key=idempotency_key)

    def send_draft(self, document_id: str, idempotency_key: Optional[str] = None) -> dict:
        return self._request("POST", f"/api/v1/documents/{urllib.parse.quote(document_id)}/send", body={}, idempotency_key=idempotency_key)

    def use_template(self, template_id: str, people: list, title: Optional[str] = None, variable_values: Optional[dict] = None, facts: Optional[dict] = None, send: Optional[dict] = None, send_now: bool = False, metadata: Optional[dict] = None, external_id: Optional[str] = None, idempotency_key: Optional[str] = None) -> dict:
        """Use a written template for people, answering its questions in variable_values."""
        body = {"people": people}
        for k, v in (("title", title), ("variableValues", variable_values), ("facts", facts), ("send", send), ("metadata", metadata), ("externalId", external_id)):
            if v:
                body[k] = v
        if send_now:
            body["sendNow"] = True
        return self._request("POST", f"/api/v1/templates/{urllib.parse.quote(template_id)}/documents", body=body, idempotency_key=idempotency_key)

    def set_template_defaults(self, template_id: str, defaults: dict) -> dict:
        return self._request("POST", f"/api/v1/templates/{urllib.parse.quote(template_id)}/defaults", body=defaults)

    def edit_with_ai(self, request: str, source: dict, mode: Optional[str] = None, variables: Optional[list] = None) -> dict:
        """Ask the assistant to change a document. Returns {"jobId", "state"}; the result is PROPOSED changes (patches.applied), and proposed answers (patches.values) when variables are given."""
        body = {"request": request, "source": source}
        if mode:
            body["mode"] = mode
        if variables:
            body["variables"] = variables
        return self._request("POST", "/api/v1/documents/ai/edit", body=body)

    def cancel_ai_job(self, job_id: str) -> dict:
        return self._request("POST", f"/api/v1/documents/ai/jobs/{urllib.parse.quote(job_id)}/cancel", body={})

    def get_wizard(self) -> dict:
        return self._request("GET", "/api/v1/ai/wizard")

    def ai_usage(self) -> dict:
        return self._request("GET", "/api/v1/ai/usage")

    def payments_status(self) -> dict:
        return self._request("GET", "/api/v1/payments/status")

    # ── Run 9: search, payments ──
    def search(self, q: str, *, per: Optional[int] = None) -> dict:
        """The app's search: documents, templates and people, best first."""
        return self._request("GET", "/api/v1/search", query={"q": q, **({"per": per} if per else {})})

    def list_payments(self, *, before: Optional[str] = None, limit: Optional[int] = None) -> dict:
        """Payments taken through documents, newest first, with this month's figures."""
        return self._request("GET", "/api/v1/payments", query={k: v for k, v in {"before": before, "limit": limit}.items() if v is not None})

    def refund_payment(self, payment_id: str, reason: str, *, amount_minor: Optional[int] = None, idempotency_key: Optional[str] = None) -> dict:
        """Refund through Stripe; leave out amount_minor for the rest of the payment. The reason is required."""
        body: dict = {"reason": reason}
        if amount_minor is not None: body["amountMinor"] = amount_minor
        return self._request("POST", f"/api/v1/payments/{urllib.parse.quote(payment_id, safe='')}/refund", body=body, idempotency_key=idempotency_key)

    # ── the template library: the 54 built-in templates (every plan) ──
    def list_library_templates(self) -> dict:
        """The built-in templates."""
        return self._request("GET", "/api/v1/templates/library")

    def get_library_template(self, slug: str) -> dict:
        """One built-in in full: its fields (who fills each one) and its guidance."""
        return self._request("GET", f"/api/v1/templates/library/{urllib.parse.quote(slug, safe='')}")

    def draft_from_library_template(self, slug: str, title: Optional[str] = None) -> dict:
        """A draft straight from a built-in (no copy; not a new template). Add people and send it as any draft."""
        return self._request("POST", f"/api/v1/templates/library/{urllib.parse.quote(slug, safe='')}/documents", body={"title": title} if title else {})

    def customize_library_template(self, slug: str, name: Optional[str] = None) -> dict:
        """Your own editable copy of a built-in, as a new template (counts toward Free's 5 new templates a month)."""
        return self._request("POST", f"/api/v1/templates/library/{urllib.parse.quote(slug, safe='')}/customize", body={"name": name} if name else {})

    # ── skills (plays), playbooks (packs) and drafts (Pro) ──
    def list_plays(self, kind: Optional[str] = None, category: Optional[str] = None) -> dict:
        q = {k: v for k, v in (("kind", kind), ("category", category)) if v}
        return self._request("GET", "/api/v1/plays" + (("?" + urllib.parse.urlencode(q)) if q else ""))

    def get_play(self, name: str) -> dict:
        return self._request("GET", f"/api/v1/plays/{urllib.parse.quote(name)}")

    def test_play(self, source: str) -> dict:
        """A dry run of a play file: every problem, and what the picker would use. Creates nothing."""
        return self._request("POST", "/api/v1/plays/test", body={"source": source})

    def save_play(self, source: str) -> dict:
        """Save a play file (Markdown with a YAML block on top) as a new version; publish it to use it."""
        return self._request("POST", "/api/v1/plays", body={"source": source})

    def publish_play(self, name: str, version: Optional[int] = None) -> dict:
        return self._request("POST", f"/api/v1/plays/{urllib.parse.quote(name)}/publish", body={"version": version} if version else {})

    def duplicate_play(self, name: str, as_name: Optional[str] = None) -> dict:
        return self._request("POST", f"/api/v1/plays/{urllib.parse.quote(name)}/duplicate", body={"as": as_name} if as_name else {})

    def archive_play(self, name: str) -> dict:
        return self._request("DELETE", f"/api/v1/plays/{urllib.parse.quote(name)}")

    def list_playbooks(self) -> dict:
        return self._request("GET", "/api/v1/playbooks")

    def save_playbook(self, name: str, title: str, plays: Optional[list] = None, description: Optional[str] = None, templates: Optional[list] = None) -> dict:
        """A pack: up to 12 skills and 24 templates ("builtin:<slug>" or your template's family id), at least one of either."""
        body = {"name": name, "title": title, "plays": plays or [], "templates": templates or []}
        if description:
            body["description"] = description
        return self._request("POST", "/api/v1/playbooks", body=body)

    def set_playbook_on(self, name: str, on: bool) -> dict:
        """Switch a pack on or off for the workspace."""
        return self._request("POST", f"/api/v1/playbooks/{urllib.parse.quote(name, safe='')}/enable", body={"enabled": bool(on)})

    def start_draft(self, template: str, people: list, title: Optional[str] = None, answers: Optional[dict] = None, use_defaults: bool = False) -> dict:
        """Start a draft from a built-in Document template, guided by its own questions: needs_input (with questions and a draftRef) until the must-ask ones are answered, then a draft. Nothing is ever sent."""
        body = {"template": template, "people": people}
        if title:
            body["title"] = title
        if answers:
            body["answers"] = answers
        if use_defaults:
            body["useDefaults"] = True
        return self._request("POST", "/api/v1/drafts", body=body)

    def answer_draft(self, draft_ref: str, answers: dict, use_defaults: bool = False) -> dict:
        body = {"answers": answers}
        if use_defaults:
            body["useDefaults"] = True
        return self._request("POST", f"/api/v1/drafts/{urllib.parse.quote(draft_ref)}/answers", body=body)

    def draft_with_ai(self, prompt: Optional[str] = None, mode: Optional[str] = None, brief: Optional[dict] = None) -> dict:
        """Ask for an AI-written draft, from a prompt or from the wizard's brief (brief.payment carries a payment the person typed). Returns {"jobId", "state"}. The draft is a suggestion for a person to read; nothing is saved or sent."""
        body = {}
        if prompt:
            body["prompt"] = prompt
        if brief:
            body["brief"] = brief
        if mode:
            body["mode"] = mode
        return self._request("POST", "/api/v1/documents/ai/draft", body=body)

    def get_ai_draft(self, job_id: str) -> dict:
        return self._request("GET", f"/api/v1/documents/ai/jobs/{urllib.parse.quote(job_id)}")

    def wait_for_ai_draft(self, job_id: str, timeout_s: float = 300, interval_s: float = 2) -> dict:
        """Poll get_ai_draft until the job is done, failed or cancelled; raises TimeoutError if it takes too long."""
        end = time.monotonic() + timeout_s
        while True:
            job = self.get_ai_draft(job_id)
            if job.get("state") in ("done", "failed", "cancelled"):
                return job
            if time.monotonic() + interval_s > end:
                raise TimeoutError(f"AI draft {job_id} did not finish within {timeout_s} s (last state: {job.get('state')})")
            time.sleep(interval_s)

    def create_template_from_file(self, name: str, file_name: str, file: "bytes | str", idempotency_key: Optional[str] = None, fields: Optional[str] = None, min_confidence: Optional[float] = None) -> dict:
        data = file if isinstance(file, str) else base64.b64encode(file).decode()
        body = {"name": name, "fileName": file_name, "file": data}
        if fields: body["fields"] = fields
        if min_confidence is not None: body["minConfidence"] = min_confidence
        return self._request("POST", "/api/v1/templates/file", body=body, idempotency_key=idempotency_key)

    def detect_fields(self, file: "bytes | str", file_name: Optional[str] = None, min_confidence: Optional[float] = None, ocr: Optional[bool] = None) -> dict:
        """Find the fields on a PDF (nothing is stored): type, page, box, confidence, source and signer for each."""
        data = file if isinstance(file, str) else base64.b64encode(file).decode()
        body = {"file": data}
        if file_name: body["fileName"] = file_name
        if min_confidence is not None: body["minConfidence"] = min_confidence
        if ocr is False: body["ocr"] = False
        return self._request("POST", "/api/v1/documents/detect-fields", body=body)

    # -- usage and teams ---------------------------------------------------
    def usage(self) -> dict:
        """Documents sent this allowance period (the billing period on a paid plan, the calendar month on Free; ``periodStart`` and ``periodEnd``) and emails sent today, against the plan's limits."""
        return self._request("GET", "/api/v1/usage")

    def preflight(self, action: str, *, documents: int | None = None, people: int | None = None, bytes: int | None = None, item: str | None = None) -> dict:
        """Ask BEFORE acting: may I, what does it cost, what are my options. ``action`` is one of ``send_document``, ``bulk_send`` (``documents``), ``invite_person`` / ``remove_person`` (``people``), ``ai_draft``, ``ai_edit``, ``ai_read_file``, ``create_template``, ``upload`` (``bytes``), ``use_feature`` (``item``) or ``connect_payments``. Reads only: nothing is sent, charged or stored. The answer has ``allowed``, ``cost["minor"]`` (whole cents), ``severity`` (none, info, warn, limit, blocked), ``reason`` (the refusal code the action would carry), ``options`` (cheapest first) and ``message``."""
        body: dict = {"action": action}
        if documents is not None: body["documents"] = documents
        if people is not None: body["people"] = people
        if bytes is not None: body["bytes"] = bytes
        if item: body["item"] = item
        return self._request("POST", "/api/v1/preflight", body=body)

    def list_teams(self) -> dict:
        return self._request("GET", "/api/v1/teams")


def _backoff(attempt: int) -> float:
    return min(0.5 * 2 ** attempt, 8.0) + random.random() * 0.2


def verify_webhook(secret: str, headers: Any, body: "str | bytes", tolerance_seconds: int = 300, now: Optional[float] = None) -> dict:
    """Check a webhook delivery (Standard Webhooks). `body` must be the RAW request body. Returns the parsed event or raises ValueError."""
    def h(name: str):
        for k, v in dict(headers).items():
            if k.lower() == name:
                return v
        return None

    wid, ts, sig = h("webhook-id"), h("webhook-timestamp"), h("webhook-signature")
    if not (wid and ts and sig):
        raise ValueError("missing webhook headers")
    if abs((now if now is not None else time.time()) - float(ts)) > tolerance_seconds:
        raise ValueError("webhook timestamp outside the tolerance")
    raw = secret.removeprefix("whsec_") if hasattr(secret, "removeprefix") else (secret[6:] if secret.startswith("whsec_") else secret)
    raw = raw.replace("-", "+").replace("_", "/")
    try:
        key = base64.b64decode(raw + "=" * (-len(raw) % 4), validate=True)
    except ValueError:
        key = b""
    if not key:
        raise ValueError("that webhook secret is not in the whsec_… form; copy it again from the endpoint's page")
    text = body if isinstance(body, str) else body.decode("utf-8")
    expected = base64.b64encode(hmac.new(key, f"{wid}.{ts}.{text}".encode(), hashlib.sha256).digest()).decode()
    for part in str(sig).split(" "):
        v, _, val = part.partition(",")
        if v == "v1" and hmac.compare_digest(val, expected):
            return json.loads(text)
    raise ValueError("webhook signature does not match")
