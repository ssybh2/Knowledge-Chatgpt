BEGIN TRANSACTION;

INSERT OR IGNORE INTO safe_snapshots (
  snapshot_id,
  owner_id,
  created_at,
  safe_content_digest,
  record_count,
  status
)
SELECT
  'snap_legacy_seed_v1',
  'teddy-primary',
  CAST(strftime('%s', 'now') AS INTEGER),
  'legacy:seed-v1',
  (
    SELECT COUNT(*)
    FROM safe_memories
    WHERE owner_id = 'teddy-primary'
      AND is_active = 1
  ),
  'active'
WHERE NOT EXISTS (
  SELECT 1
  FROM safe_active_snapshot
  WHERE owner_id = 'teddy-primary'
);

INSERT OR IGNORE INTO safe_snapshot_memories (
  snapshot_id,
  memory_ref,
  id,
  owner_id,
  category,
  title,
  summary,
  keywords_json,
  event_time,
  revision,
  source_note,
  is_active,
  created_at,
  updated_at
)
SELECT
  'snap_legacy_seed_v1',
  memory_ref,
  id,
  owner_id,
  category,
  title,
  summary,
  keywords_json,
  event_time,
  revision,
  source_note,
  is_active,
  created_at,
  updated_at
FROM safe_memories
WHERE owner_id = 'teddy-primary'
  AND is_active = 1
  AND NOT EXISTS (
    SELECT 1
    FROM safe_active_snapshot
    WHERE owner_id = 'teddy-primary'
  );

INSERT OR IGNORE INTO safe_active_snapshot (
  owner_id,
  snapshot_id,
  updated_at
)
SELECT
  'teddy-primary',
  'snap_legacy_seed_v1',
  CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (
  SELECT 1
  FROM safe_active_snapshot
  WHERE owner_id = 'teddy-primary'
);

COMMIT;
