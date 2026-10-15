# Which key scopes each MCP tool needs

Derived by running every tool against a recording client and looking each route up in the server's own scope table (`scripts/scopes.mjs`). A key without the scope gets the same plain 401 as any bad key, so a tool a key cannot use fails with that answer rather than a special message. `DOCUSTAY_READ_ONLY=1` removes every tool marked **writes**.

| Tool | Writes | Calls | Scopes (any one of these on the key) |
|---|---|---|---|
| `list_templates` | reads | `GET /api/v1/documents/templates` | `documents:read`, `templates:read` |
| `get_template` | reads | `GET /api/v1/templates/00000000-0000-4000-8000-000000000001` | `templates:read` |
| `list_documents` | reads | `GET /api/v1/documents` | `documents:read` |
| `get_document` | reads | `GET /api/v1/documents/00000000-0000-4000-8000-000000000001` | `documents:read` |
| `get_audit_log` | reads | `GET /api/v1/documents/00000000-0000-4000-8000-000000000001/audit-log.csv` | `documents:read` |
| `get_report` | reads | `GET /api/v1/reports` | `reports:read` |
| `save_signed_pdf` | reads | `GET /api/v1/documents/00000000-0000-4000-8000-000000000001/signed.pdf` | `documents:read` |
| `send_document` | **writes** | `POST /api/v1/documents/send` | `documents:write` |
| `remind` | **writes** | `POST /api/v1/documents/00000000-0000-4000-8000-000000000001/remind` | `documents:write` |
| `void_document` | **writes** | `POST /api/v1/documents/00000000-0000-4000-8000-000000000001/void` | `documents:write` |
| `list_emails` | reads | `GET /api/v1/emails` | `documents:read` |
| `test_sign_document` | **writes** | `POST /api/v1/documents/00000000-0000-4000-8000-000000000001/test-sign` | `documents:write` |
| `create_template_from_html` | **writes** | `POST /api/v1/templates/html` | `templates:write` |
| `create_template_from_source` | **writes** | `POST /api/v1/templates/source` | `templates:write` |
| `draft_document_with_ai` | **writes** | `POST /api/v1/documents/ai/draft`<br>`GET /api/v1/documents/ai/jobs/00000000-0000-4000-8000-000000000001` | `documents:read`, `documents:write` |
| `edit_document_with_ai` | **writes** | `POST /api/v1/documents/ai/edit`<br>`GET /api/v1/documents/ai/jobs/00000000-0000-4000-8000-000000000001` | `documents:read`, `documents:write` |
| `cancel_ai_job` | **writes** | `POST /api/v1/documents/ai/jobs/00000000-0000-4000-8000-000000000001/cancel` | `documents:write` |
| `get_wizard` | reads | `GET /api/v1/ai/wizard` | `documents:read` |
| `get_ai_usage` | reads | `GET /api/v1/ai/usage` | `account:read` |
| `detect_fields` | reads | `POST /api/v1/documents/detect-fields` | `templates:read` |
| `get_payments_status` | reads | `GET /api/v1/payments/status` | `account:read` |
| `check_document` | reads | `POST /api/v1/documents/check` | `documents:read` |
| `create_document` | **writes** | `POST /api/v1/documents` | `documents:write` |
| `use_template` | **writes** | `POST /api/v1/templates/00000000-0000-4000-8000-000000000001/documents` | `documents:write` |
| `get_draft_source` | reads | `GET /api/v1/documents/00000000-0000-4000-8000-000000000001/source` | `documents:read` |
| `revise_document` | **writes** | `POST /api/v1/documents/00000000-0000-4000-8000-000000000001/revise` | `documents:write` |
| `send_draft` | **writes** | `POST /api/v1/documents/00000000-0000-4000-8000-000000000001/send` | `documents:write` |
| `set_template_defaults` | **writes** | `POST /api/v1/templates/00000000-0000-4000-8000-000000000001/defaults` | `templates:write` |
| `list_forms` | reads | `GET /api/v1/forms` | `documents:read` |
| `list_form_templates` | reads | `GET /api/v1/forms/templates` | `documents:read`, `templates:read` |
| `get_form` | reads | `GET /api/v1/forms/00000000-0000-4000-8000-000000000001` | `documents:read` |
| `list_form_responses` | reads | `GET /api/v1/forms/00000000-0000-4000-8000-000000000001/responses` | `documents:read` |
| `list_plays` | reads | `GET /api/v1/plays` | `plays:read` |
| `get_play` | reads | `GET /api/v1/plays/x` | `plays:read` |
| `start_draft` | **writes** | `POST /api/v1/drafts` | `drafts:write` |
| `answer_questions` | **writes** | `POST /api/v1/drafts/x/answers` | `drafts:write` |
| `get_ai_draft` | reads | `GET /api/v1/documents/ai/jobs/00000000-0000-4000-8000-000000000001` | `documents:read` |
| `search_documents` | reads | `GET /api/v1/search` | `documents:read` |
| `list_contracts` | reads | `GET /api/v1/contracts` | `documents:read` |
| `set_contract_date` | **writes** | `POST /api/v1/contracts/00000000-0000-4000-8000-000000000001/dates` | `documents:write` |
| `list_payments` | reads | `GET /api/v1/payments` | `documents:read` |
| `list_automations` | reads | `GET /api/v1/automations` | `plays:read` |
| `list_library_templates` | reads | `GET /api/v1/templates/library` | `templates:read` |
| `get_library_template` | reads | `GET /api/v1/templates/library/x` | `templates:read` |
| `draft_from_library_template` | **writes** | `POST /api/v1/templates/library/x/documents` | `templates:write` |
| `list_playbooks` | reads | `GET /api/v1/playbooks` | `plays:read` |
