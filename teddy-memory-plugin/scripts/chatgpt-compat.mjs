import { pathToFileURL } from 'node:url';

import {
  checkAnonymousMcpChallenge,
  checkAuthenticatedMcp,
  checkAuthorizationServer,
  checkProtectedResource,
} from '../src/compatibility.js';
import { obtainOAuthTokens, refreshOAuthTokens } from './oauth-login.mjs';

const DEFAULT_REDIRECT_URI = 'http://localhost:8789/callback';
const CHECK_NAMES = Object.freeze([
  'public_https',
  'protected_resource_metadata',
  'canonical_resource',
  'auth0_discovery',
  'authorization_endpoint',
  'token_endpoint',
  'pkce_s256',
  'resource_binding',
  'memory_read_scope',
  'refresh_token',
  'anonymous_mcp_challenge',
  'mcp_initialize',
  'tools_list',
  'tool_annotations',
  'tool_schemas',
  'safe_search',
  'unknown_ref',
  'restricted_query_guard',
]);

function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function normalizeHttpsBaseUrl(value) {
  let url;
  try {
    url = new URL(requiredText(value, 'Teddy Plugin URL'));
  } catch {
    throw new Error('Teddy Plugin URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Teddy Plugin URL must be a valid HTTPS URL');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function normalizeHttpsResource(value) {
  let url;
  try {
    url = new URL(requiredText(value, 'OAuth resource'));
  } catch {
    throw new Error('OAuth resource must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('OAuth resource must be a valid HTTPS URL');
  }
  return url.toString();
}

function normalizeIssuer(value) {
  let url;
  try {
    url = new URL(requiredText(value, 'Auth0 issuer'));
  } catch {
    throw new Error('Auth0 issuer must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Auth0 issuer must be a valid HTTPS URL');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString();
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function validateTokens(tokens, label) {
  const accessToken = requiredText(tokens?.accessToken, `${label} access token`);
  const refreshToken = requiredText(tokens?.refreshToken, `${label} refresh token`);
  return { accessToken, refreshToken };
}

async function checkPublicEndpoint(baseUrl, fetchImpl) {
  const response = await fetchImpl(`${baseUrl}/healthz`, { method: 'GET' });
  if (response.status !== 200) throw new Error(`public HTTPS endpoint failed with status ${response.status}`);
}

function successfulChecks() {
  return Object.fromEntries(CHECK_NAMES.map((name) => [name, true]));
}

function writeMatrix(write, checks) {
  for (const name of CHECK_NAMES) write(`PASS ${name}`);
  const passed = Object.values(checks).filter(Boolean).length;
  write(`RESULT ${passed}/${CHECK_NAMES.length} PASS`);
}

export async function runChatGptCompatibility({
  issuer,
  clientId,
  baseUrl,
  resource,
  redirectUri = DEFAULT_REDIRECT_URI,
  fetchImpl = fetch,
  tokenProvider = obtainOAuthTokens,
  refreshProvider = refreshOAuthTokens,
  write = (line) => console.log(line),
} = {}) {
  const fetcher = requireFunction(fetchImpl, 'fetch implementation');
  const obtainTokens = requireFunction(tokenProvider, 'token provider');
  const refreshTokens = requireFunction(refreshProvider, 'refresh provider');
  const writer = requireFunction(write, 'write callback');
  const normalizedBaseUrl = normalizeHttpsBaseUrl(baseUrl);
  const normalizedResource = normalizeHttpsResource(resource || `${normalizedBaseUrl}/mcp`);
  const normalizedIssuer = normalizeIssuer(issuer);
  const normalizedClientId = requiredText(clientId, 'Auth0 client ID');
  const normalizedRedirectUri = requiredText(redirectUri, 'OAuth redirect URI');

  await checkPublicEndpoint(normalizedBaseUrl, fetcher);

  const protectedResource = await checkProtectedResource({
    baseUrl: normalizedBaseUrl,
    fetchImpl: fetcher,
  });
  if (protectedResource.resource !== normalizedResource) {
    throw new Error('protected-resource metadata does not match requested OAuth resource');
  }
  if (protectedResource.issuer !== normalizedIssuer) {
    throw new Error('protected-resource authorization server does not match configured Auth0 issuer');
  }
  if (protectedResource.requiredScope !== 'memory:read') {
    throw new Error('protected-resource required scope is not memory:read');
  }

  const authorizationServer = await checkAuthorizationServer({
    issuer: normalizedIssuer,
    fetchImpl: fetcher,
  });
  if (!authorizationServer.authorizationEndpoint || !authorizationServer.tokenEndpoint) {
    throw new Error('Auth0 discovery endpoints are incomplete');
  }
  if (authorizationServer.supportsPkceS256 !== true) {
    throw new Error('Auth0 does not advertise PKCE S256');
  }
  if (authorizationServer.supportsOfflineAccess !== true) {
    throw new Error('Auth0 does not advertise offline_access');
  }

  await checkAnonymousMcpChallenge({
    baseUrl: normalizedBaseUrl,
    resource: normalizedResource,
    requiredScope: protectedResource.requiredScope,
    fetchImpl: fetcher,
  });

  const initialTokens = validateTokens(await obtainTokens({
    issuer: normalizedIssuer,
    clientId: normalizedClientId,
    resource: normalizedResource,
    redirectUri: normalizedRedirectUri,
    fetchImpl: fetcher,
  }), 'initial OAuth');

  const refreshedTokens = validateTokens(await refreshTokens({
    issuer: normalizedIssuer,
    clientId: normalizedClientId,
    resource: normalizedResource,
    refreshToken: initialTokens.refreshToken,
    fetchImpl: fetcher,
  }), 'refreshed OAuth');

  const mcp = await checkAuthenticatedMcp({
    baseUrl: normalizedBaseUrl,
    token: refreshedTokens.accessToken,
    fetchImpl: fetcher,
  });

  const checks = successfulChecks();
  const report = {
    ok: true,
    passed: CHECK_NAMES.length,
    total: CHECK_NAMES.length,
    checks,
    toolCount: mcp.toolCount,
    searchResultCount: mcp.searchResultCount,
  };
  writeMatrix(writer, checks);
  return report;
}

async function main() {
  try {
    await runChatGptCompatibility({
      issuer: process.env.TEDDY_AUTH0_ISSUER || process.env.PLUGIN_OAUTH_ISSUER,
      clientId: process.env.TEDDY_AUTH0_CLIENT_ID,
      baseUrl: process.env.TEDDY_PLUGIN_URL,
      resource: process.env.TEDDY_PLUGIN_RESOURCE,
      redirectUri: process.env.TEDDY_AUTH0_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'ChatGPT compatibility check failed');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
