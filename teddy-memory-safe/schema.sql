CREATE TABLE IF NOT EXISTS safe_memories (
  id TEXT PRIMARY KEY,
  memory_ref TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('project','learning','decision','plan','preference','reference')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  event_time REAL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source_note TEXT NOT NULL DEFAULT 'historical_chat_summary',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_safe_memories_owner_active
ON safe_memories(owner_id, is_active);

CREATE INDEX IF NOT EXISTS idx_safe_memories_owner_category
ON safe_memories(owner_id, category, is_active);

CREATE INDEX IF NOT EXISTS idx_safe_memories_owner_event
ON safe_memories(owner_id, event_time DESC);
