import { pathToFileURL } from 'node:url';
import { readJsonl, writeJsonl } from './jsonl.js';
import { normalizeConversation, normalizeSourceMessage } from './contracts.js';
import { buildCandidate } from './candidates.js';
import { compileApprovedMemory } from './approval.js';
import { scanCandidateFields } from './policy.js';
import { writeD1Batches } from './d1-export.js';

const CATEGORIES = new Set(['project', 'learning', 'decision', 'plan', 'preference', 'reference']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new TypeError('arguments must use --name value form');
    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new TypeError(`missing value for --${key}`);
    options[key] = value;
    i += 1;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = String(options[name] ?? '').trim();
  if (!value) throw new TypeError(`--${name} is required`);
  return value;
}

function positiveInt(value, name, fallback = null) {
  if (value === undefined && fallback !== null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`--${name} must be a positive integer`);
  return number;
}

function writeJson(ioStream, value) {
  ioStream.write(`${JSON.stringify(value)}\n`);
}

async function loadConversationTitles(path) {
  const titles = new Map();
  if (!path) return titles;
  for await (const raw of readJsonl(path)) {
    const conversation = normalizeConversation(raw);
    titles.set(conversation.id, conversation.title);
  }
  return titles;
}

async function buildCandidates(options, io) {
  const messagesPath = requireOption(options, 'messages');
  const ownerId = requireOption(options, 'owner');
  const output = requireOption(options, 'output');
  const maxCandidates = options['max-candidates'] === undefined
    ? Number.POSITIVE_INFINITY
    : positiveInt(options['max-candidates'], 'max-candidates');
  const titles = await loadConversationTitles(options.conversations);
  const candidates = [];
  const seen = new Set();
  let scanned = 0;
  for await (const raw of readJsonl(messagesPath)) {
    scanned += 1;
    const message = normalizeSourceMessage(raw);
    const candidate = buildCandidate({ ownerId, message, conversationTitle: titles.get(message.conversation_id) });
    if (!candidate || seen.has(candidate.candidate_id)) continue;
    seen.add(candidate.candidate_id);
    candidates.push(candidate);
    if (candidates.length >= maxCandidates) break;
  }
  await writeJsonl(output, candidates);
  writeJson(io.stdout, {
    ok: true,
    command: 'build-candidates',
    scanned_messages: scanned,
    candidates: candidates.length,
    blocked: candidates.filter((row) => row.blocked_reasons.length > 0).length,
  });
  return 0;
}

async function loadDecisions(path) {
  const decisions = new Map();
  for await (const row of readJsonl(path)) {
    const id = String(row?.candidate_id ?? '').trim();
    if (!id) throw new TypeError('decision candidate_id is required');
    if (decisions.has(id) && JSON.stringify(decisions.get(id)) !== JSON.stringify(row)) {
      throw new TypeError('conflicting duplicate decision');
    }
    decisions.set(id, row);
  }
  return decisions;
}

async function compileApproved(options, io) {
  const candidatesPath = requireOption(options, 'candidates');
  const decisionsPath = requireOption(options, 'decisions');
  const output = requireOption(options, 'output');
  const decisions = await loadDecisions(decisionsPath);
  const approvedRows = [];
  const counts = { approved: 0, rejected: 0, blocked: 0, missing_decision: 0 };

  for await (const candidate of readJsonl(candidatesPath)) {
    const decision = decisions.get(candidate.candidate_id);
    if (!decision || decision.decision === 'pending') {
      counts.missing_decision += 1;
      continue;
    }
    if (decision.decision === 'reject') {
      counts.rejected += 1;
      continue;
    }
    if (Array.isArray(candidate.blocked_reasons) && candidate.blocked_reasons.length > 0) {
      counts.blocked += 1;
      continue;
    }
    try {
      const compiled = compileApprovedMemory(candidate, decision);
      if (compiled) {
        approvedRows.push(compiled);
        counts.approved += 1;
      }
    } catch (error) {
      if (String(error?.message || '').startsWith('safe memory rejected by policy:')) {
        counts.blocked += 1;
        continue;
      }
      throw error;
    }
  }

  approvedRows.sort((a, b) => {
    const owner = a.owner_id.localeCompare(b.owner_id);
    if (owner) return owner;
    const aTime = a.event_time ?? Number.NEGATIVE_INFINITY;
    const bTime = b.event_time ?? Number.NEGATIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });
  await writeJsonl(output, approvedRows);
  writeJson(io.stdout, { ok: true, command: 'compile-approved', ...counts });
  return 0;
}

function validateApprovedRow(row) {
  if (!row || typeof row !== 'object') throw new TypeError('approved row must be an object');
  if ('source_archive_id' in row || 'source_conversation_id' in row || 'conversation_id' in row || 'message_id' in row) {
    throw new TypeError('approved row contains forbidden private source identifiers');
  }
  if (!/^sm_[0-9a-f]{32}$/.test(String(row.id ?? ''))) throw new TypeError('approved id is invalid');
  if (!/^mem_[0-9a-f]{32}$/.test(String(row.memory_ref ?? ''))) throw new TypeError('memory_ref is invalid');
  if (!String(row.owner_id ?? '').trim()) throw new TypeError('owner_id is required');
  if (!CATEGORIES.has(row.category)) throw new TypeError('category is invalid');
  const title = String(row.title ?? '').trim();
  const summary = String(row.summary ?? '').trim();
  if (!title || Array.from(title).length > 160) throw new TypeError('title is invalid');
  if (!summary || Array.from(summary).length > 4000) throw new TypeError('summary is invalid');
  const keywords = Array.isArray(row.keywords) ? row.keywords : [];
  if (keywords.length > 20) throw new TypeError('keywords are invalid');
  const reasons = scanCandidateFields({ title, summary, keywords });
  if (reasons.length) throw new Error(`safe memory rejected by policy: ${reasons.join(',')}`);
  if (!Number.isInteger(Number(row.revision)) || Number(row.revision) < 1) throw new TypeError('revision is invalid');
  if (row.source_note !== 'historical_chat_summary') throw new TypeError('source_note is invalid');
  if (row.is_active !== true) throw new TypeError('is_active must be true for export');
  return row;
}

async function exportD1(options, io) {
  const approvedPath = requireOption(options, 'approved');
  const outDir = requireOption(options, 'out-dir');
  const batchSize = positiveInt(options['batch-size'], 'batch-size', 100);
  const rows = [];
  for await (const row of readJsonl(approvedPath)) rows.push(validateApprovedRow(row));
  const files = await writeD1Batches(rows, { outDir, batchSize });
  writeJson(io.stdout, { ok: true, command: 'export-d1', records: rows.length, batches: files.length });
  return 0;
}

async function stats(options, io) {
  const path = requireOption(options, 'file');
  let records = 0;
  let blocked = 0;
  const blockedReasons = {};
  const decisions = { pending: 0, approve: 0, reject: 0, other: 0 };
  for await (const row of readJsonl(path)) {
    records += 1;
    if (Array.isArray(row.blocked_reasons) && row.blocked_reasons.length) {
      blocked += 1;
      for (const reason of row.blocked_reasons) {
        const key = String(reason);
        blockedReasons[key] = (blockedReasons[key] || 0) + 1;
      }
    }
    if (row.decision === 'pending') decisions.pending += 1;
    else if (row.decision === 'approve') decisions.approve += 1;
    else if (row.decision === 'reject') decisions.reject += 1;
    else if (row.decision !== undefined) decisions.other += 1;
  }
  writeJson(io.stdout, { ok: true, command: 'stats', records, blocked, blocked_reasons: blockedReasons, decisions });
  return 0;
}

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const { command, options } = parseArgs(argv);
    if (command === 'build-candidates') return await buildCandidates(options, io);
    if (command === 'compile-approved') return await compileApproved(options, io);
    if (command === 'export-d1') return await exportD1(options, io);
    if (command === 'stats') return await stats(options, io);
    throw new TypeError('command must be build-candidates, compile-approved, export-d1, or stats');
  } catch (error) {
    io.stderr.write(`Error: ${String(error?.message || 'operation failed')}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
