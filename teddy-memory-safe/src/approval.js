import { createHash } from 'node:crypto';
import { candidateIdForSource } from './candidates.js';
import { scanCandidateFields } from './policy.js';

const CATEGORIES = new Set(['project', 'learning', 'decision', 'plan', 'preference', 'reference']);

function codePointLength(value) {
  return Array.from(String(value ?? '')).length;
}

function requiredText(value, field, max) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const length = codePointLength(text);
  if (length < 1 || length > max) throw new TypeError(`${field} must be 1-${max} code points`);
  return text;
}

function normalizeKeywords(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('keywords must be an array');
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const keyword = requiredText(raw, 'keyword', 80);
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length > 20) throw new TypeError('keywords must contain at most 20 items');
  }
  return out;
}

function normalizeRevision(value) {
  const revision = Number(value ?? 1);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError('revision must be an integer >= 1');
  return revision;
}

function safePolicyError(reasons) {
  const unique = [...new Set(reasons)].sort();
  return new Error(`safe memory rejected by policy: ${unique.join(',')}`);
}

function hashHex(value, length) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length);
}

export function approvedIdForCandidate(ownerId, candidateId, revision = 1) {
  return `sm_${hashHex(`${ownerId}\0${candidateId}\0${revision}`, 32)}`;
}

export function memoryRefForApprovedId(id) {
  return `mem_${hashHex(`public-ref\0${id}`, 32)}`;
}

export function memoryRefForSource({ ownerId, messageId, revision = 1 } = {}) {
  const candidateId = candidateIdForSource(ownerId, messageId);
  const id = approvedIdForCandidate(ownerId, candidateId, revision);
  return memoryRefForApprovedId(id);
}

export function compileApprovedMemory(candidate, decision) {
  if (!decision || decision.decision === 'pending' || decision.decision === 'reject') return null;
  if (decision.decision !== 'approve') throw new TypeError('decision must be approve, reject, or pending');
  if (!candidate || typeof candidate !== 'object') throw new TypeError('candidate is required');
  if (decision.candidate_id !== candidate.candidate_id) throw new TypeError('candidate_id does not match candidate');

  const blocked = Array.isArray(candidate.blocked_reasons) ? candidate.blocked_reasons : [];
  if (blocked.length) throw safePolicyError(blocked);

  const ownerId = requiredText(candidate.owner_id, 'owner_id', 256);
  const category = String(decision.category ?? '').trim();
  if (!CATEGORIES.has(category)) throw new TypeError('category is invalid');
  const title = requiredText(decision.title, 'title', 160);
  const summary = requiredText(decision.summary, 'summary', 4000);
  const keywords = normalizeKeywords(decision.keywords);
  const revision = normalizeRevision(decision.revision);
  const eventTime = decision.event_time == null ? candidate.event_time ?? null : Number(decision.event_time);
  if (eventTime !== null && !Number.isFinite(eventTime)) throw new TypeError('event_time must be finite or null');

  const reasons = scanCandidateFields({ title, summary, keywords });
  if (reasons.length) throw safePolicyError(reasons);

  const id = approvedIdForCandidate(ownerId, candidate.candidate_id, revision);
  const memoryRef = memoryRefForApprovedId(id);

  return {
    id,
    memory_ref: memoryRef,
    owner_id: ownerId,
    category,
    title,
    summary,
    keywords,
    event_time: eventTime,
    revision,
    source_note: 'historical_chat_summary',
    is_active: true,
  };
}
