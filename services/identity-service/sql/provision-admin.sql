\set ON_ERROR_STOP on

INSERT INTO admin_accounts (email)
VALUES (lower(btrim(:'admin_email')))
ON CONFLICT (email) DO NOTHING
RETURNING id, email, created_at;
