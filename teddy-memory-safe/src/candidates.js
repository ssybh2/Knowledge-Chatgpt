import { createHash } from 'node:crypto';
import { scanCandidateFields } from './policy.js';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function truncateCodePoints(value, max) {
  return Array.from(String(value ?? '')).slice(0, max).join('');
}

function stableCandidateId(ownerId, messageId) {
  const digest = createHash('sha256')
    .update(`${ownerId}\0${messageId}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `cand_${digest}`;
}

export function buildCandidate({ ownerId, message, conversationTitle } = {}) {
  const normalizedOwnerId = normalizeWhitespace(ownerId);
  if (!normalizedOwnerId) throw new TypeError('ownerId is required');
  if (!message || typeof message !== 'object') throw new TypeError('message is required');
  if (message.role !== 'user' || message.retrievable !== true) return null;

  const content = normalizeWhitespace(message.content);
  if (content.replace(/\s/gu, '').length < 20) return null;

  const summary = truncateCodePoints(content, 1200);
  const normalizedTitle = normalizeWhitespace(conversationTitle);
  const title = truncateCodePoints(normalizedTitle || truncateCodePoints(content, 72), 120);
  const keywords = [];
  const blockedReasons = scanCandidateFields({ title, summary, keywords });

  return {
    candidate_id: stableCandidateId(normalizedOwnerId, String(message.id ?? '')),
    owner_id: normalizedOwnerId,
    category: 'reference',
    title,
    summary,
    keywords,
    event_time: message.create_time ?? null,
    revision: 1,
    source_note: 'historical_chat_summary',
    source_archive_id: String(message.id ?? ''),
    source_conversation_id: String(message.conversation_id ?? ''),
    blocked_reasons: blockedReasons,
    decision: 'pending',
  };
}
