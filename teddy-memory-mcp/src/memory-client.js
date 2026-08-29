export class TeddyMemoryApiError extends Error {
  constructor(message, { status = null, cause = undefined } = {}) {
    super(message, { cause });
    this.name = 'TeddyMemoryApiError';
    this.status = status;
  }
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) throw new TypeError('baseUrl is required');
  return value.replace(/\/+$/, '');
}

function normalizeTimeout(timeoutMs) {
  const value = Number(timeoutMs ?? 15_000);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError('timeoutMs must be a positive number');
  }
  return value;
}

export function createMemoryClient({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedKey = String(apiKey || '').trim();
  const normalizedTimeout = normalizeTimeout(timeoutMs);

  if (!normalizedKey) throw new TypeError('apiKey is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  async function request(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${normalizedBaseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const headers = { Authorization: `Bearer ${normalizedKey}` };
    const init = {
      method,
      headers,
      signal: AbortSignal.timeout(normalizedTimeout),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? `Teddy Memory request timed out after ${normalizedTimeout} ms`
        : `Teddy Memory request failed: ${error?.message || 'network error'}`;
      throw new TeddyMemoryApiError(message, { cause: error });
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) {
        throw new TeddyMemoryApiError(`Teddy Memory API returned HTTP ${response.status}`, {
          status: response.status,
        });
      }
      throw new TeddyMemoryApiError('Teddy Memory API returned invalid JSON', {
        status: response.status,
      });
    }

    if (!response.ok) {
      const detail = typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`;
      throw new TeddyMemoryApiError(`Teddy Memory API error: ${detail}`, {
        status: response.status,
      });
    }

    return data;
  }

  return {
    searchMemory(input) {
      return request('/v1/search', { method: 'POST', body: input });
    },
    getContext(input) {
      return request('/v1/context', { method: 'POST', body: input });
    },
    getConversation({ conversation_id, limit = 200, offset = 0 }) {
      const id = String(conversation_id || '').trim();
      if (!id) throw new TypeError('conversation_id is required');
      return request(`/v1/conversation/${encodeURIComponent(id)}`, {
        query: { limit, offset },
      });
    },
  };
}
