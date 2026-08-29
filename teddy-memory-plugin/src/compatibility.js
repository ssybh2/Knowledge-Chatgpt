function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function requiredFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  return fetchImpl;
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
