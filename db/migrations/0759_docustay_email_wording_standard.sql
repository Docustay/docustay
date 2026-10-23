-- 0759 · Docustay v1 item 8: the editor for a workspace's own email wording is gone and the standard wording always applies.
-- The three emails the host sends from its own template store (signed copy, declined, expired) still read the "edited" rows an older version wrote there, so those rows are switched off for Docustay workspaces.
-- Rows are kept (active = false), nothing is deleted, the platform workspaces are untouched.
UPDATE keystone.email_template e SET active = false
  FROM keystone.tenant n
 WHERE n.id = e.tenant_id AND n.product = 'docustay' AND e.active AND e.origin = 'edited'
   AND e.key IN ('documents.signed_copy', 'documents.document_declined', 'documents.document_expired');
