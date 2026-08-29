import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSnapshotCleanup } from '../src/snapshot-export.js';

test('snapshot cleanup keeps active plus two newest retired snapshots by default', () => {
  assert.equal(typeof renderSnapshotCleanup, 'function');
  const sql = renderSnapshotCleanup({ ownerId: 'teddy-primary' });

  assert.match(sql, /BEGIN TRANSACTION/i);
  assert.match(sql, /DELETE FROM safe_snapshot_memories/i);
  assert.match(sql, /DELETE FROM safe_snapshots/i);
  assert.match(sql, /owner_id\s*=\s*'teddy-primary'/i);
  assert.match(sql, /status\s*=\s*'retired'/i);
  assert.match(sql, /ORDER BY created_at DESC[\s\S]*snapshot_id DESC/i);
  assert.match(sql, /LIMIT\s+-1\s+OFFSET\s+2/i);
  assert.doesNotMatch(sql, /DELETE FROM safe_active_snapshot/i);
  assert.doesNotMatch(sql, /status\s*=\s*'active'/i);

  const childDelete = sql.indexOf('DELETE FROM safe_snapshot_memories');
  const parentDelete = sql.indexOf('DELETE FROM safe_snapshots');
  assert.ok(childDelete >= 0 && parentDelete > childDelete, 'child snapshot rows must be deleted before snapshot metadata');
});

test('snapshot cleanup retention count is derived from keepSuccessful minus active snapshot', () => {
  const sql = renderSnapshotCleanup({ ownerId: 'owner-2', keepSuccessful: 4 });
  assert.match(sql, /owner_id\s*=\s*'owner-2'/i);
  assert.match(sql, /LIMIT\s+-1\s+OFFSET\s+3/i);
});

test('snapshot cleanup refuses to retain fewer than active plus two rollback snapshots', () => {
  for (const keepSuccessful of [0, 1, 2, -1, 2.5]) {
    assert.throws(
      () => renderSnapshotCleanup({ ownerId: 'teddy-primary', keepSuccessful }),
      /keepSuccessful|3|integer/i,
    );
  }
  assert.throws(() => renderSnapshotCleanup({}), /owner/i);
});
