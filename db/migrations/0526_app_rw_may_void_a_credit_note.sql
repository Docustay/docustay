-- 0526 — P3.S2 (RECONCILE de-code, 27 Sep 2026): app_rw could SELECT and INSERT keystone.credit_note
-- (0491:106) but never UPDATE — voidCreditNote's own UPDATE (src/money/creditNotes.mjs:394-398) has
-- always failed at the database, before any application logic ran.
GRANT UPDATE ON keystone.credit_note TO app_rw;
