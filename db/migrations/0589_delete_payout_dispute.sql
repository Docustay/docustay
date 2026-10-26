-- 0589 · THE SHARED DELETE MUST BE ABLE TO DELETE A PAYOUT OR A DISPUTE (QUEUE §13, found in the sandbox browser test).
-- `payment`, `refund`, `credit_note` and the rest of Ty's "remove from Mainstay's view" types are deleted by the shared route (src/records/delete.mjs),
-- which removes Mainstay's OWN row and writes a tombstone for Stripe's copy. keystone.payout and keystone.dispute were the two tables app_rw could
-- SELECT/INSERT/UPDATE but not DELETE, so a bulk delete answered "permission denied for table payout". The privilege is exactly the one the others
-- already have; row-level security still confines it to the practice's own rows, and the only caller is the audited Owner/Admin delete route.
GRANT DELETE ON keystone.payout, keystone.dispute TO app_rw;
