ALTER TABLE issued_tickets ADD COLUMN qr_token bytea;
UPDATE issued_tickets SET qr_token = qr_secret_hash WHERE qr_token IS NULL;
ALTER TABLE issued_tickets ALTER COLUMN qr_token SET NOT NULL;

---- create above / drop below ----
ALTER TABLE issued_tickets DROP COLUMN qr_token;
