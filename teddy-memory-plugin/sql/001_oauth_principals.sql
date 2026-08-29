CREATE TABLE IF NOT EXISTS oauth_principals (
  issuer TEXT NOT NULL,
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  owner_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  PRIMARY KEY (issuer, subject_hash)
);

CREATE INDEX IF NOT EXISTS idx_oauth_principals_owner_active
  ON oauth_principals (owner_id, is_active);
