-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P9.3 — SEND MODE. HOW MUCH OF AN INSTRUMENT MAY CHANGE ON ITS WAY OUT.
--
-- ★★★ THERE WAS NO SEND MODE AT ALL. [MEASURED 2026-09-15] the strings `send_mode`, `sendMode`,
--     `'locked'`, `'fill'` and `'open'` appear nowhere in `src/`, `web/src/` or any migration for
--     this purpose. Every send was implicitly LOCKED — the template's words, exactly, with no way to
--     fill anything in and no way to depart from them.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE THREE MODES, AND WHY `fill` IS THE DEFAULT (KS-8.2, RULED).
--
--     LOCKED — the template's words, unchanged. Correct for a standard consent; too rigid for most
--              real documents, because almost every agreement has a name, a date or a fee in it.
--     FILL   — the words are fixed; the VARIABLES are filled in. **The default.**
--     OPEN   — the sender may depart from the template. Necessary, and dangerous: it lets somebody
--              rewrite a legal instrument minutes before a client signs it.
--
--   ★★ SO THE DEFAULT IS THE MIDDLE ONE, AND THAT IS A DECISION, NOT A COMPROMISE. Defaulting to
--      LOCKED makes the product refuse the ordinary case and teaches people to reach for OPEN;
--      defaulting to OPEN makes the dangerous case the one nobody chose.
--
-- ★★★ AND AN OPEN SEND IS RECORDED, IN THE ROW, FOREVER: **"an instrument that differs from its
--     template without a record is indistinguishable from a forgery."** `body_overridden` is that
--     record. It is set by the write path when the body actually sent differs from the template's,
--     and `open_send_is_recorded` below makes the pair unrepresentable any other way — a departure
--     cannot exist without the mode that permitted it.
--   ★ NOT a log line, and not only an event: a row somebody reads years later, beside the frozen
--     words, in the same place they are reading the signature.
--
-- ★★ THE MODE IS ON THE **INSTANCE**, NOT THE TEMPLATE, and that is the whole point of it. "This
--    agreement may be departed from" is not a property of a template — it is a decision about ONE
--    send, made by the person making it, and it must be recorded against the instrument that went
--    out rather than against a library row that serves hundreds.
--
-- ★ Every existing instrument gets `fill` and `body_overridden = false`, which is exactly what they
--   were: template words, nothing departed from. Nothing is retroactively described as an override.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.document_instance
  ADD COLUMN IF NOT EXISTS send_mode text NOT NULL DEFAULT 'fill',
  ADD COLUMN IF NOT EXISTS body_overridden boolean NOT NULL DEFAULT false;

ALTER TABLE keystone.document_instance
  ADD CONSTRAINT document_instance_send_mode_check
  CHECK (send_mode IN ('locked', 'fill', 'open'));

-- ★★★ THE PAIR THE DATABASE REFUSES TO REPRESENT: a body that departed from its template under a
--     mode that does not permit departing. Enforced here rather than only in the write path, because
--     the write path is one statement and this row outlives every version of it.
ALTER TABLE keystone.document_instance
  ADD CONSTRAINT open_send_is_recorded
  CHECK (NOT body_overridden OR send_mode = 'open');

COMMENT ON COLUMN keystone.document_instance.send_mode IS
  'P9.3. locked = the template''s words unchanged · fill = variables filled in (DEFAULT, KS-8.2) · open = the sender departed from the template. A property of THIS send, not of the template.';
COMMENT ON COLUMN keystone.document_instance.body_overridden IS
  'P9.3. true when the frozen body differs from the template''s. An instrument that differs from its template without a record is indistinguishable from a forgery.';

-- ★★ THE INSTRUMENTS SOMEBODY WILL ACTUALLY GO LOOKING FOR. "Which agreements did we depart from?"
--    is the question an auditor asks first, and it should not be a sequential scan over every
--    document the practice has ever sent.
CREATE INDEX IF NOT EXISTS document_instance_departed_from_template
  ON keystone.document_instance (tenant_id, sent_at DESC)
  WHERE body_overridden;
