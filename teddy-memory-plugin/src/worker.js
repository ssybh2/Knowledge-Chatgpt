import { createPluginMcpHandler } from './http-handler.js';
import { createMemoryRepository } from './memory-repository.js';
import { readOAuthConfig } from './oauth-config.js';
import { bearerChallenge, protectedResourceMetadata } from './oauth-metadata.js';
import {
  OAuthAuthenticationError,
  OAuthInsufficientScopeError,
  createOAuthTokenValidator,
} from './oauth-token.js';
import { createPrincipalRepository } from './principal-repository.js';

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
  return jsonResponse({ error: 'Plugin request unavailable' }, 500);
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

function oauthFailure(config, { insufficientScope = false } = {}) {
  return jsonResponse(
    { error: insufficientScope ? 'Forbidden' : 'Unauthorized' },
    insufficientScope ? 403 : 401,
    { 'www-authenticate': bearerChallenge(config, { insufficientScope }) },
  );
}

function genericMcpFailure() {
  return jsonResponse({ error: 'Plugin request unavailable' }, 500);
}

const defaultValidateOAuthRequest = createOAuthTokenValidator();

export function createWorkerFetch({
  createRepository = createMemoryRepository,
  createMcpHandler = createPluginMcpHandler,
  readConfig = readOAuthConfig,
  buildMetadata = protectedResourceMetadata,
  validateOAuthRequest = defaultValidateOAuthRequest,
  createPrincipalRepository: makePrincipalRepository = createPrincipalRepository,
} = {}) {
  for (const [name, value] of Object.entries({
    createRepository,
    createMcpHandler,
    readConfig,
    buildMetadata,
    validateOAuthRequest,
    makePrincipalRepository,
  })) {
    if (typeof value !== 'function') {
      throw new TypeError(`${name} must be a function`);
    }
  }

  return async function fetchWorker(request, env = {}) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({
        service: 'teddy-memory-plugin',
        read_only: true,
        stage: 'plan-3',
        auth: 'oauth',
        mcp: '/mcp',
      });
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return jsonResponse({ ok: true, service: 'teddy-memory-plugin' });
    }

    if (
      request.method === 'GET'
      && (
        url.pathname === '/.well-known/oauth-protected-resource'
        || url.pathname === '/.well-known/oauth-protected-resource/mcp'
      )
    ) {
      try {
        return jsonResponse(buildMetadata(readConfig(env)));
      } catch {
        return genericMcpFailure();
      }
    }

    if (url.pathname !== '/mcp') {
      return jsonResponse({ error: 'Not Found' }, 404);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405, { allow: 'POST' });
    }

    const networkBoundary = validateNetworkBoundary(request, env);
    if (networkBoundary.response) return networkBoundary.response;

    let config;
    try {
      config = readConfig(env);
    } catch {
      return genericMcpFailure();
    }

    let identity;
    try {
      identity = await validateOAuthRequest(request, config);
    } catch (error) {
      if (error instanceof OAuthInsufficientScopeError) {
        return oauthFailure(config, { insufficientScope: true });
      }
      if (error instanceof OAuthAuthenticationError) {
        return oauthFailure(config);
      }
      return genericMcpFailure();
    }

    try {
      const db = env.SAFE_DB;
      if (!db || typeof db.prepare !== 'function') {
        return genericMcpFailure();
      }

      const principalRepository = makePrincipalRepository(db);
      const ownerId = await principalRepository.resolveOwner({
        issuer: identity.issuer,
        subject: identity.subject,
      });
      if (!ownerId) return boundaryError(403);

      const repository = createRepository(db);
      const handler = createMcpHandler(repository, ownerId);
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
