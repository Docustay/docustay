-- 0535_invoice_reminders_enabled — Ty, 29 Sep 2026 (F819)
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE GAP THIS CLOSES. The invoice editor's "Send reminders / No reminders" switch never
--     reached the server (webreact InvoiceEditor.jsx's handleRemindersToggle only ever set local
--     React state). Backend support for turning EXISTING reminder rows on/off already existed —
--     `toggleInvoiceReminders` (src/money/reminders.mjs:130), soft-deleting/restoring unsent
--     `keystone.invoice_reminder` rows via their own `deleted_at` — but that only matters once rows
--     exist, and for a draft none do yet: `sendInvoice()` (src/money/invoiceSend.mjs:100) creates
--     the practice's default reminder set "if none exist" at send time. A draft that was toggled
--     off had exactly as many rows (zero) as one that was never touched, so there was no way to
--     tell "explicitly off" from "not decided yet" — sendInvoice() would re-populate the defaults
--     regardless.
--
-- ★★ THE FIX IS A TRI-STATE INVOICE-LEVEL FLAG, NOT A CHANGE TO invoice_reminder ITSELF.
--     invoice_reminder's own on/off mechanism (deleted_at) is correct and untouched — this column
--     is read ONLY by sendInvoice()'s "create defaults if none exist yet" branch, to decide whether
--     that branch should run at all:
--       NULL  — not decided; use the practice's `money.reminder_days` default (today's behaviour)
--       true  — explicitly on; same as NULL for a draft (defaults still populate at send)
--       false — explicitly off; sendInvoice() skips default-creation, so the invoice sends with
--               zero invoice_reminder rows and the reminder sweep (INVOICE_REMINDER_FACT,
--               src/money/reminders.mjs:24) has nothing to find for it, ever.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.invoice ADD COLUMN reminders_enabled boolean;

COMMENT ON COLUMN keystone.invoice.reminders_enabled IS
  '0535/F819: tri-state override for whether sendInvoice() populates the practice default reminder '
  'set (money.reminder_days) at send time. NULL = not decided, use the practice default. true = on '
  '(same effect as NULL today). false = off — sendInvoice() creates no invoice_reminder rows for '
  'this invoice. Editable only while status=''draft'' (webreact InvoiceEditor.jsx disables the '
  'control once sent) — this column is never read again after send.';

-- ── SELF-CHECK ─────────────────────────────────────────────────────────────────────────────────
DO $invoice_reminders_enabled_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'invoice' AND column_name = 'reminders_enabled'
  ) THEN
    RAISE EXCEPTION '0535: keystone.invoice.reminders_enabled was not created';
  END IF;
  RAISE NOTICE '0535: keystone.invoice.reminders_enabled added';
END
$invoice_reminders_enabled_check$;
