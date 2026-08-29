import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { readJsonl, writeJsonl } from '../src/jsonl.js';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (s) => { stdout += String(s); } },
      stderr: { write: (s) => { stderr += String(s); } },
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

async function collect(path) {
  const rows = [];
  for await (const row of readJsonl(path)) rows.push(row);
  return rows;
}

test('build-candidates include-keywords scans all input and keeps only title/content matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-keywords-'));
  const conversations = join(dir, 'conversations.jsonl');
  const messages = join(dir, 'messages.jsonl');
  const output = join(dir, 'review.jsonl');

  await writeJsonl(conversations, [
    { id: 'c1', title: 'Ordinary chat' },
    { id: 'c2', title: 'Quadruped reinforcement learning notes' },
    { id: 'c3', title: 'PCB project' },
  ]);

  await writeJsonl(messages, [
    { id: 'c1::u1', conversation_id: 'c1', role: 'user', content: 'This is an ordinary historical message that is long enough but irrelevant.', is_retrievable: 1 },
    { id: 'c2::u1', conversation_id: 'c2', role: 'user', content: 'This message is long enough and matches through the conversation title only.', is_retrievable: 1 },
    { id: 'c3::u1', conversation_id: 'c3', role: 'user', content: 'The EtherCAT slave board uses a dedicated real-time communication path for the robotics project.', is_retrievable: 1 },
  ]);

  const cap = captureIo();
  const code = await main([
    'build-candidates',
    '--messages', messages,
    '--conversations', conversations,
    '--owner', 'owner-1',
    '--output', output,
    '--include-keywords', 'EtherCAT,quadruped',
    '--max-candidates', '10',
  ], cap.io);

  assert.equal(code, 0);
  const rows = await collect(output);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.source_archive_id).sort(), ['c2::u1', 'c3::u1']);
  assert.match(cap.stdout, /"keyword_filter":\["ethercat","quadruped"\]/);
  assert.match(cap.stdout, /"matched_messages":2/);
  assert.ok(!cap.stdout.includes('ordinary historical message'));
});
