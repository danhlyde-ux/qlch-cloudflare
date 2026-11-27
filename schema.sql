CREATE TABLE IF NOT EXISTS documents (
  doc_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at);
