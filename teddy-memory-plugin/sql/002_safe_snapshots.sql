CREATE TABLE IF NOT EXISTS safe_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  safe_content_digest TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('loading','ready','active','retired','failed'))
);

CREATE INDEX IF NOT EXISTS idx_safe_snapshots_owner_status_created
ON safe_snapshots (owner_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS safe_snapshot_memories (
  snapshot_id TEXT NOT NULL,
  memory_ref TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('project','learning','decision','plan','preference','reference')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  event_time REAL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  source_note TEXT NOT NULL DEFAULT 'historical_chat_summary',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, memory_ref),
  FOREIGN KEY (snapshot_id) REFERENCES safe_snapshots (snapshot_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_safe_snapshot_memories_owner_active
ON safe_snapshot_memories (snapshot_id, owner_id, is_active);

CREATE INDEX IF NOT EXISTS idx_safe_snapshot_memories_owner_category_active
ON safe_snapshot_memories (snapshot_id, owner_id, category, is_active);

CREATE INDEX IF NOT EXISTS idx_safe_snapshot_memories_owner_event_time
ON safe_snapshot_memories (snapshot_id, owner_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_safe_snapshot_memories_owner_ref
ON safe_snapshot_memories (snapshot_id, owner_id, memory_ref);

CREATE TABLE IF NOT EXISTS safe_active_snapshot (
  owner_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES safe_snapshots (snapshot_id)
);
