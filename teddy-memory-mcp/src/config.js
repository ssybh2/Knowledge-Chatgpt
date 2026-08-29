const DEFAULT_BASE_URL = 'https://teddy-memory-api.3767174214.workers.dev';
const DEFAULT_TIMEOUT_MS = 15_000;

export function readConfig(env = process.env) {
  const apiKey = String(env.MEMORY_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('MEMORY_API_KEY is required');
  }

  const baseUrl = String(env.TEDDY_MEMORY_API_BASE_URL || DEFAULT_BASE_URL).trim();
  if (!baseUrl) {
    throw new Error('TEDDY_MEMORY_API_BASE_URL must not be empty');
  }

  const timeoutMs = Number(env.TEDDY_MEMORY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('TEDDY_MEMORY_TIMEOUT_MS must be a positive number');
  }

  return { apiKey, baseUrl, timeoutMs };
}
