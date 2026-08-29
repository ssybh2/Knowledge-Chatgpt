import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

export class OAuthAuthenticationError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'OAuthAuthenticationError';
  }
}

export class OAuthInsufficientScopeError extends OAuthAuthenticationError {
  constructor() {
    super();
    this.name = 'OAuthInsufficientScopeError';
  }
}

function bearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer[\t ]+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : '';
}

function scopeList(value) {
  if (typeof value !== 'string') return [];
  const text = value.trim();
  return text ? text.split(/[\t\n\f\r ]+/).filter(Boolean) : [];
}

export function createOAuthTokenValidator({ fetchImpl = fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  const keySets = new Map();

  return async function validateOAuthRequest(request, config) {
    const token = bearerToken(request);
    if (!token) throw new OAuthAuthenticationError();

    let keySet = keySets.get(config.issuer);
    if (!keySet) {
      const jwksUrl = new URL('.well-known/jwks.json', config.issuer);
      keySet = createRemoteJWKSet(jwksUrl, {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
        [customFetch]: fetchImpl,
      });
      keySets.set(config.issuer, keySet);
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ['RS256'],
        clockTolerance: 5,
      }));
    } catch {
      throw new OAuthAuthenticationError();
    }

    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!subject) throw new OAuthAuthenticationError();

    const scopes = scopeList(payload.scope);
    if (!scopes.includes(config.requiredScope)) {
      throw new OAuthInsufficientScopeError();
    }

    return {
      issuer: config.issuer,
      subject,
      scopes,
    };
  };
}
