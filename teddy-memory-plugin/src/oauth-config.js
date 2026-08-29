function requireHttpsUrl(value, label, { trailingSlash = false } = {}) {
  const text = String(value || '').trim();
  if (!text) throw new Error('OAuth configuration is invalid');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('OAuth configuration is invalid');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('OAuth configuration is invalid');
  }
  if (trailingSlash && !text.endsWith('/')) {
    throw new Error('OAuth configuration is invalid');
  }

  return url.toString();
}

export function readOAuthConfig(env = {}) {
  const issuer = requireHttpsUrl(env.PLUGIN_OAUTH_ISSUER, 'PLUGIN_OAUTH_ISSUER', {
    trailingSlash: true,
  });
  const resource = requireHttpsUrl(env.PLUGIN_OAUTH_RESOURCE, 'PLUGIN_OAUTH_RESOURCE');
  const resourceUrl = new URL(resource);

  if (resourceUrl.pathname !== '/mcp') {
    throw new Error('OAuth configuration is invalid');
  }

  const requiredScope = String(env.PLUGIN_OAUTH_REQUIRED_SCOPE || '').trim();
  if (requiredScope !== 'memory:read') {
    throw new Error('OAuth configuration is invalid');
  }

  return {
    issuer,
    resource,
    requiredScope,
    metadataUrl: new URL('/.well-known/oauth-protected-resource', resourceUrl).toString(),
  };
}
