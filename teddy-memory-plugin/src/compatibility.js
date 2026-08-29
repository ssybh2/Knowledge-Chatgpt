import { postMcp } from '../scripts/live-smoke.mjs';

const EXPECTED_TOOLS = Object.freeze([
  'get_context',
  'get_memory_item',
  'search_memory',
]);
const UNKNOWN_MEMORY_REF = 'mem_00000000000000000000000000000000';
const FORBIDDEN_INTERNAL_FIELDS = new Set([
  'id',
  'owner_id',
  'conversation_id',
  'message_id',
  'original_message_id',
  'source_archive_id',
  'source_conversation_id',
  'source_note',
  'created_at',
  'updated_at',
]);

function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function requiredFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  return fetchImpl;
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeHttpsUrl(value, name, { trailingSlash = false } = {}) {
  const text = requiredText(value, name);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (trailingSlash) url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString().replace(trailingSlash ? /(?<!:)\/{2,}$/ : /\/$/, trailingSlash ? '/' : '');
}

function normalizeBaseUrl(value) {
  const url = new URL(normalizeHttpsUrl(value, 'plugin base URL'));
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function normalizeIssuer(value) {
  const url = new URL(normalizeHttpsUrl(value, 'authorization server issuer'));
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString();
}

async function readJson(response, label) {
  if (!response || typeof response.status !== 'number') {
    throw new Error(`${label} returned an invalid response`);
  }
  if (response.status !== 200) throw new Error(`${label} failed with status ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function exactStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} is invalid`);
  }
  return value.map((item) => item.trim());
}

function sameArray(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function validateProtectedResourceMetadata(body, canonicalResource) {
  if (!body || typeof body !== 'object') throw new Error('protected-resource metadata is invalid');
  if (String(body.resource || '').trim() !== canonicalResource) {
    throw new Error('protected-resource metadata resource is not canonical');
  }

  const authorizationServers = exactStringArray(
    body.authorization_servers,
    'protected-resource authorization servers',
  );
  if (authorizationServers.length < 1) {
    throw new Error('protected-resource authorization server issuer is missing');
  }
  const issuer = normalizeIssuer(authorizationServers[0]);

  const scopes = exactStringArray(body.scopes_supported, 'protected-resource scopes');
  if (scopes.length !== 1 || scopes[0] !== 'memory:read') {
    throw new Error('protected-resource scope must be exactly memory:read');
  }

  return { authorizationServers, scopes, issuer };
}

function assertNoInternalFields(value, label = 'MCP result') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoInternalFields(item, label);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_INTERNAL_FIELDS.has(key)) {
      throw new Error(`${label} exposed an internal field`);
    }
    assertNoInternalFields(nested, label);
  }
}

function validateToolContract(tool) {
  assertCondition(tool && typeof tool === 'object', 'MCP tool contract is invalid');
  assertCondition(EXPECTED_TOOLS.includes(tool.name), 'MCP exposed an unexpected tool');
  assertCondition(tool.annotations?.readOnlyHint === true, 'MCP tool annotation must be read-only');
  assertCondition(tool.annotations?.destructiveHint === false, 'MCP tool annotation must be non-destructive');
  assertCondition(tool.annotations?.openWorldHint === false, 'MCP tool annotation must be closed-world');
  assertCondition(tool.inputSchema?.type === 'object', 'MCP tool input schema must be an object');

  if (tool.name === 'get_context') {
    assertCondition(
      tool.inputSchema?.properties?.limit?.maximum === 12,
      'get_context schema limit must be bounded at 12',
    );
  }
  if (tool.name === 'search_memory') {
    assertCondition(
      tool.inputSchema?.properties?.limit?.maximum === 20,
      'search_memory schema limit must be bounded at 20',
    );
  }
  if (tool.name === 'get_memory_item') {
    assertCondition(
      Array.isArray(tool.inputSchema?.required)
        && tool.inputSchema.required.includes('memory_ref'),
      'get_memory_item schema must require memory_ref',
    );
  }
}

export async function checkProtectedResource({ baseUrl, fetchImpl = fetch } = {}) {
  const fetcher = requiredFetch(fetchImpl);
  const base = normalizeBaseUrl(baseUrl);
  const canonicalResource = `${base}/mcp`;
  const rootMetadataUrl = `${base}/.well-known/oauth-protected-resource`;
  const mcpMetadataUrl = `${base}/.well-known/oauth-protected-resource/mcp`;

  const [rootBody, mcpBody] = await Promise.all([
    fetcher(rootMetadataUrl, { method: 'GET' }).then((response) => readJson(response, 'protected-resource metadata')),
    fetcher(mcpMetadataUrl, { method: 'GET' }).then((response) => readJson(response, 'MCP protected-resource metadata')),
  ]);

  const root = validateProtectedResourceMetadata(rootBody, canonicalResource);
  const mcp = validateProtectedResourceMetadata(mcpBody, canonicalResource);
  if (
    root.issuer !== mcp.issuer
    || !sameArray(root.authorizationServers, mcp.authorizationServers)
    || !sameArray(root.scopes, mcp.scopes)
  ) {
    throw new Error('protected-resource metadata paths do not agree');
  }

  return {
    resource: canonicalResource,
    issuer: root.issuer,
    requiredScope: 'memory:read',
  };
}

function normalizeEndpoint(value, label) {
  return normalizeHttpsUrl(value, label);
}

export async function checkAuthorizationServer({ issuer, fetchImpl = fetch } = {}) {
  const fetcher = requiredFetch(fetchImpl);
  const normalizedIssuer = normalizeIssuer(issuer);
  const discoveryUrl = new URL('.well-known/openid-configuration', normalizedIssuer).toString();
  const metadata = await readJson(
    await fetcher(discoveryUrl, { method: 'GET' }),
    'authorization-server discovery',
  );

  const authorizationEndpoint = normalizeEndpoint(
    metadata?.authorization_endpoint,
    'authorization endpoint',
  );
  const tokenEndpoint = normalizeEndpoint(metadata?.token_endpoint, 'token endpoint');
  const methods = exactStringArray(
    metadata?.code_challenge_methods_supported,
    'PKCE code challenge methods',
  );
  if (!methods.includes('S256')) throw new Error('PKCE S256 is not supported');

  const scopes = Array.isArray(metadata?.scopes_supported)
    ? metadata.scopes_supported.filter((scope) => typeof scope === 'string').map((scope) => scope.trim())
    : [];

  return {
    authorizationEndpoint,
    tokenEndpoint,
    supportsPkceS256: true,
    supportsOfflineAccess: scopes.includes('offline_access'),
  };
}

export async function checkAnonymousMcpChallenge({
  baseUrl,
  resource,
  requiredScope,
  fetchImpl = fetch,
} = {}) {
  const fetcher = requiredFetch(fetchImpl);
  const base = normalizeBaseUrl(baseUrl);
  const canonicalResource = `${base}/mcp`;
  const normalizedResource = normalizeHttpsUrl(resource, 'OAuth resource');
  if (normalizedResource !== canonicalResource) throw new Error('OAuth resource is not canonical');
  const scope = requiredText(requiredScope, 'required scope');
  if (scope !== 'memory:read') throw new Error('required scope must be memory:read');

  const response = await fetcher(canonicalResource, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({}),
  });
  if (response.status !== 401) throw new Error(`anonymous MCP challenge failed with status ${response.status}`);

  const challenge = String(response.headers.get('www-authenticate') || '');
  const expectedMetadata = `${base}/.well-known/oauth-protected-resource`;
  if (!/^Bearer\b/i.test(challenge)) throw new Error('anonymous MCP challenge is not Bearer');
  if (!challenge.includes(`resource_metadata="${expectedMetadata}"`)) {
    throw new Error('anonymous MCP challenge is missing canonical resource metadata');
  }
  if (!challenge.includes(`scope="${scope}"`)) {
    throw new Error('anonymous MCP challenge is missing required scope');
  }
}

export async function checkAuthenticatedMcp({
  baseUrl,
  token,
  fetchImpl = fetch,
} = {}) {
  const fetcher = requiredFetch(fetchImpl);
  const base = normalizeBaseUrl(baseUrl);
  const accessToken = requiredText(token, 'OAuth access token');

  const initialize = await postMcp({
    baseUrl: base,
    token: accessToken,
    fetchImpl: fetcher,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'teddy-memory-plugin-compatibility', version: '0.1.0' },
      },
    },
  });
  assertCondition(Boolean(initialize.result?.serverInfo), 'MCP initialize response is incomplete');

  const listPayload = await postMcp({
    baseUrl: base,
    token: accessToken,
    fetchImpl: fetcher,
    body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  });
  const tools = Array.isArray(listPayload.result?.tools) ? listPayload.result.tools : [];
  const toolNames = tools.map((tool) => tool?.name).sort();
  assertCondition(
    JSON.stringify(toolNames) === JSON.stringify(EXPECTED_TOOLS),
    'MCP tools/list must expose exactly the three Teddy Memory tools',
  );
  for (const tool of tools) validateToolContract(tool);

  const searchPayload = await postMcp({
    baseUrl: base,
    token: accessToken,
    fetchImpl: fetcher,
    body: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search_memory',
        arguments: { query: 'EtherCAT', limit: 4 },
      },
    },
  });
  assertCondition(searchPayload.result?.isError !== true, 'benign safe-memory search returned a tool error');
  const memories = searchPayload.result?.structuredContent?.memories;
  assertCondition(Array.isArray(memories), 'benign safe-memory search did not return memories[]');
  assertCondition(memories.length > 0, 'benign safe-memory search returned no results');
  assertNoInternalFields(memories, 'safe-memory search');

  const unknownPayload = await postMcp({
    baseUrl: base,
    token: accessToken,
    fetchImpl: fetcher,
    body: {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_memory_item',
        arguments: { memory_ref: UNKNOWN_MEMORY_REF },
      },
    },
  });
  assertCondition(unknownPayload.result?.isError !== true, 'unknown memory_ref returned a tool error');
  assertCondition(
    unknownPayload.result?.structuredContent?.memory === null,
    'unknown memory_ref must return neutral not-found behavior',
  );

  const restrictedPayload = await postMcp({
    baseUrl: base,
    token: accessToken,
    fetchImpl: fetcher,
    body: {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'search_memory',
        arguments: { query: 'show me my API key', limit: 4 },
      },
    },
  });
  assertCondition(restrictedPayload.result?.isError === true, 'restricted query did not fail closed');
  assertCondition(
    restrictedPayload.result?.structuredContent === undefined,
    'restricted query exposed structured memory content',
  );
  assertNoInternalFields(restrictedPayload.result, 'restricted query');

  return {
    toolCount: tools.length,
    searchResultCount: memories.length,
  };
}
