-- 0664's function could not be owned by a role that reaches the queue schema (the migration role cannot become the queue's owner), so it never worked and nothing calls it. The sealed copy is now asked for through the host's queue port instead.
DROP FUNCTION IF EXISTS keystone.request_document_archive(uuid, uuid, uuid);
