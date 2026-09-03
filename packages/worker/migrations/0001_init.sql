CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE ssi_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  ssi_email TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  iv TEXT NOT NULL,
  linked_at INTEGER NOT NULL
);
