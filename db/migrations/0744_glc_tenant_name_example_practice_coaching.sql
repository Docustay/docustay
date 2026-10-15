-- the maintainer, 14 Oct 2026: every email a coaching lead or client gets must say "an example organisation", never "an example organisation Recovery Services" (F657, the email half).
-- The brand already comes from the practice.name setting in most paths, but about thirty code paths still read keystone.tenant.name (invoices, receipts, booking pages,
-- gift cards, documents, the lead consent line...). Renaming the one tenant row makes every one of them say the brand at once; "an example organisation" is the d/b/a of the
-- legal entity an example organisation Recovery Services LLC (named in the website footer), so it is accurate on an invoice. Idempotent; touches only the practice with slug 'glc'
-- and only while it still carries the old name.
UPDATE keystone.tenant SET name = 'Example Practice Coaching' WHERE slug = 'glc' AND name = 'Example Practice Recovery Services';
