import { toPublicMemory } from './dto.js';
import { assertSafeLookupInput, normalizeLookupInput } from './query-policy.js';

const RESTRICTED_MESSAGE = 'This category is unavailable through Plugin-safe memory';
const GENERIC_LOOKUP_ERROR = 'Plugin-safe memory lookup unavailable';
const MEMORY_REF_PATTERN = /^mem_[0-9a-f]{32}$/;

function validateRepository(repository) {
  if (!repository || typeof repository.search !== 'function' || typeof repository.getByRef !== 'function') {
    throw new TypeError('repository with search and getByRef is required');
  }
}

function validateOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new TypeError('ownerId is required');
  }
  return ownerId.trim();
}

function success(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function failure(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function safeFailure(error) {
  if (error instanceof Error && error.message === RESTRICTED_MESSAGE) {
    return failure(RESTRICTED_MESSAGE);
  }
  return failure(GENERIC_LOOKUP_ERROR);
}

function minimizeMemories(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(toPublicMemory);
}

function assertMemoryRef(memoryRef) {
  if (typeof memoryRef !== 'string' || !MEMORY_REF_PATTERN.test(memoryRef)) {
    throw new RangeError('Invalid memory reference');
  }
  return memoryRef;
}

export function createPluginToolHandlers(repository, ownerId) {
  validateRepository(repository);
  const scopedOwnerId = validateOwnerId(ownerId);

  async function runLookup(input, options) {
    try {
      assertSafeLookupInput(input);
      const normalized = normalizeLookupInput(input, options);
      const rows = await repository.search({
        ownerId: scopedOwnerId,
        query: normalized.query,
        keywords: normalized.keywords,
        limit: normalized.limit,
      });
      return success({ memories: minimizeMemories(rows) });
    } catch (error) {
      return safeFailure(error);
    }
  }

  return {
    get_context(input = {}) {
      return runLookup(input, { defaultLimit: 6, maxLimit: 12 });
    },

    search_memory(input = {}) {
      return runLookup(input, { defaultLimit: 8, maxLimit: 20 });
    },

    async get_memory_item(input = {}) {
      try {
        const memoryRef = assertMemoryRef(input.memory_ref);
        const row = await repository.getByRef({ ownerId: scopedOwnerId, memoryRef });
        return success({ memory: row ? toPublicMemory(row) : null });
      } catch (error) {
        return safeFailure(error);
      }
    },
  };
}
