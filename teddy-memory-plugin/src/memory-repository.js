import { toPublicMemory } from './dto.js';

function assertDatabase(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('A D1-compatible database is required');
  }
}

function assertOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new TypeError('ownerId is required');
  }
  return ownerId.trim();
}

function assertSearchLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('limit must be an integer between 1 and 20');
  }
  return limit;
}

function assertMemoryRef(memoryRef) {
  if (typeof memoryRef !== 'string' || !memoryRef.trim()) {
    throw new TypeError('memoryRef is required');
  }
  return memoryRef.trim();
}

function buildTerms(query, keywords = []) {
  const values = [];
  if (typeof query === 'string' && query.trim()) values.push(query.trim());
  if (Array.isArray(keywords)) {
    for (const keyword of keywords) {
      if (typeof keyword === 'string' && keyword.trim()) values.push(keyword.trim());
    }
  }

  const seen = new Set();
  const terms = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(value);
    if (terms.length === 8) break;
  }

  if (terms.length === 0) {
    throw new RangeError('Provide query or keywords');
  }
  return terms;
}

function escapeLike(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function likePattern(value) {
  return `%${escapeLike(value)}%`;
}

function buildScoreFragment(termCount) {
  return Array.from({ length: termCount }, () => `(
    CASE WHEN title LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END +
    CASE WHEN keywords_json LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END +
    CASE WHEN summary LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END
  )`).join(' + ');
}

function buildMatchFragment(termCount) {
  return Array.from({ length: termCount }, () => `(
    title LIKE ? ESCAPE '\\' OR
    keywords_json LIKE ? ESCAPE '\\' OR
    summary LIKE ? ESCAPE '\\'
  )`).join(' OR ');
}

function repeatedPatterns(patterns) {
  return patterns.flatMap((pattern) => [pattern, pattern, pattern]);
}

export function createMemoryRepository(db) {
  assertDatabase(db);

  return {
    async search({ ownerId, query, keywords = [], limit }) {
      const scopedOwnerId = assertOwnerId(ownerId);
      const boundedLimit = assertSearchLimit(limit);
      const terms = buildTerms(query, keywords);
      const patterns = terms.map(likePattern);
      const scoreFragment = buildScoreFragment(patterns.length);
      const matchFragment = buildMatchFragment(patterns.length);

      const sql = `
        WITH owner_rows AS (
          SELECT memory_ref, title, category, summary, event_time, revision, keywords_json
          FROM safe_memories
          WHERE owner_id = ? AND is_active = 1
        ), ranked AS (
          SELECT
            memory_ref,
            title,
            category,
            summary,
            event_time,
            revision,
            (${scoreFragment}) AS score
          FROM owner_rows
          WHERE ${matchFragment}
        )
        SELECT memory_ref, title, category, summary, event_time, revision
        FROM ranked
        ORDER BY score DESC, event_time DESC, memory_ref ASC
        LIMIT ?
      `;

      const binds = [
        scopedOwnerId,
        ...repeatedPatterns(patterns),
        ...repeatedPatterns(patterns),
        boundedLimit,
      ];

      const result = await db.prepare(sql).bind(...binds).all();
      const rows = Array.isArray(result?.results) ? result.results : [];
      return rows.map(toPublicMemory);
    },

    async getByRef({ ownerId, memoryRef }) {
      const scopedOwnerId = assertOwnerId(ownerId);
      const scopedMemoryRef = assertMemoryRef(memoryRef);
      const sql = `
        SELECT memory_ref, title, category, summary, event_time, revision
        FROM safe_memories
        WHERE owner_id = ? AND is_active = 1 AND memory_ref = ?
        LIMIT 1
      `;

      const row = await db.prepare(sql).bind(scopedOwnerId, scopedMemoryRef).first();
      return row ? toPublicMemory(row) : null;
    },
  };
}
