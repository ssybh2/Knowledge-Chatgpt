export class StagingAuthConfigurationError extends Error {
  constructor() {
    super('Plugin staging authentication is not configured');
    this.name = 'StagingAuthConfigurationError';
  }
}

export function constantWorkEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let index = 0; index < length; index += 1) {
    const aCode = index < a.length ? a.charCodeAt(index) : 0;
    const bCode = index < b.length ? b.charCodeAt(index) : 0;
    difference |= aCode ^ bCode;
  }

  return difference === 0;
}

function bearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : '';
}

export function resolveStagingPrincipal(request, env = {}) {
  const configuredToken = String(env.PLUGIN_DEV_ACCESS_TOKEN || '').trim();
  const ownerId = String(env.PLUGIN_DEV_OWNER_ID || '').trim();

  if (!configuredToken || !ownerId) {
    throw new StagingAuthConfigurationError();
  }

  const presentedToken = bearerToken(request);
  if (!constantWorkEqual(presentedToken, configuredToken)) {
    return null;
  }

  return { ownerId };
}
