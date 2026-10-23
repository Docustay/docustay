-- 0758 · Docustay v1 settings trim: the "approve uploaded templates" setting (upload.template_approval) is no longer offered in Docustay and is read as off.
-- A template left `pending` by that setting would then be unsendable with no way to approve it, so every pending Docustay template becomes approved. Data only; nothing is dropped, the platform rows are untouched.
UPDATE keystone.document_template t SET approval_status = 'approved', approved_at = COALESCE(t.approved_at, now())
  FROM keystone.tenant n WHERE n.id = t.tenant_id AND n.product = 'docustay' AND t.approval_status = 'pending';
