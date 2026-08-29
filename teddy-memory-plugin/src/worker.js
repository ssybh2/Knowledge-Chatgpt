import { createPluginMcpHandler } from './http-handler.js';
import { createMemoryRepository } from './memory-repository.js';
import {
  StagingAuthConfigurationError,
  resolveStagingPrincipal,
} from './staging-auth.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hostnameFromHostHeader(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    return end >= 0 ? text.slice(0, end + 1) : text;
  }
  return text.split(':', 1)[0];
}

function requestHostname(request) {
  const headerHost = hostnameFromHostHeader(request.headers.get('host'));
  if (headerHost) return headerHost;
  return new URL(request.url).hostname.toLowerCase();
}

function originHostname(request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function boundaryError(status) {
  if (status === 403) return jsonResponse({ error: 'Forbidden' }, 403);
  return jsonResponse({ error: 'Plugin stage is not configured' }, 500);
}

function validateNetworkBoundary(request, env) {
  const allowedHosts = splitCsv(env.PLUGIN_ALLOWED_HOSTS);
  if (allowedHosts.length === 0) return { response: boundaryError(500) };

  const host = requestHostname(request);
  if (!host || !allowedHosts.includes(host)) {
    return { response: boundaryError(403) };
  }

  const origin = originHostname(request);
  if (origin !== null) {
    const allowedOrigins = splitCsv(env.PLUGIN_ALLOWED_ORIGINS);
    if (!origin || allowedOrigins.length === 0 || !allowedOrigins.includes(origin)) {
      return { response: boundaryError(403) };
    }
  }

  return { response: null };
}

function unauthorized() {
  return jsonResponse(
    { error: 'Unauthorized' },
    401,
    { 'www-authenticate': 'Bearer realm="teddy-memory-plugin-stage"' },
  );
}

function genericMcpFailure() {
  return jsonResponse({ error: 'Plugin request unavailable' }, 500);
}

export function createWorkerFetch({
  createRepository = createMemoryRepository,
  createMcpHandler = createPluginMcpHandler,
  resolvePrincipal = resolveStagingPrincipal,
} = {}) {
  if (typeof createRepository !== 'function') {
    throw new TypeError('createRepository must be a function');
  }
  if (typeof createMcpHandler !== 'function') {
    throw new TypeError('createMcpHandler must be a function');
  }
  if (typeof resolvePrincipal !== 'function') {
    throw new TypeError('resolvePrincipal must be a function');
  }

  return async function fetchWorker(request, env = {}) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({
        service: 'teddy-memory-plugin',
        read_only: true,
        stage: 'plan-2',
        mcp: '/mcp',
      });
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return jsonResponse({ ok: true, service: 'teddy-memory-plugin' });
    }

    if (url.pathname !== '/mcp') {
      return jsonResponse({ error: 'Not Found' }, 404);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405, { allow: 'POST' });
    }

    const networkBoundary = validateNetworkBoundary(request, env);
    if (networkBoundary.response) return networkBoundary.response;

    let principal;
    try {
      principal = resolvePrincipal(request, env);
    } catch (error) {
      if (error instanceof StagingAuthConfigurationError) {
        return boundaryError(500);
      }
      return genericMcpFailure();
    }

    if (!principal) return unauthorized();

    try {
      const db = env.SAFE_DB;
      if (!db || typeof db.prepare !== 'function') {
        return genericMcpFailure();
      }
      const repository = createRepository(db);
      const handler = createMcpHandler(repository, principal.ownerId);
      return await handler.fetch(request);
    } catch {
      return genericMcpFailure();
    }
  };
}

const fetchWorker = createWorkerFetch();

export default {
  fetch(request, env) {
    return fetchWorker(request, env);
  },
};
