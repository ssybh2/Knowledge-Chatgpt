import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

import {
  OAuthAuthenticationError,
  OAuthInsufficientScopeError,
  createOAuthTokenValidator,
} from '../src/oauth-token.js';

const config = {
  issuer: 'https://tenant.example.auth0.com/',
  resource: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  requiredScope: 'memory:read',
  metadataUrl: 'https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource',
};

async function createFixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'test-key', use: 'sig', alg: 'RS256' });

  const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  async function signToken({
    issuer = config.issuer,
    audience = config.resource,
    subject = 'auth0|test-user',
    scope = 'openid memory:read',
    expiresAt = Math.floor(Date.now() / 1000) + 300,
    notBefore,
  } = {}) {
    let jwt = new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresAt);
    if (subject !== null) jwt = jwt.setSubject(subject);
    if (notBefore !== undefined) jwt = jwt.setNotBefore(notBefore);
    return jwt.sign(privateKey);
  }

  return { fetchImpl, signToken };
}

function requestWith(token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return new Request('https://plugin.example.com/mcp', { method: 'POST', headers });
}

test('valid RS256 Auth0 token returns issuer, subject, and normalized scopes', async () => {
  const { fetchImpl, signToken } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  const token = await signToken({ scope: 'openid   memory:read' });

  assert.deepEqual(await validate(requestWith(token), config), {
    issuer: config.issuer,
    subject: 'auth0|test-user',
    scopes: ['openid', 'memory:read'],
  });
});

test('missing bearer is rejected generically', async () => {
  const { fetchImpl } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(), config), OAuthAuthenticationError);
});

test('wrong issuer is rejected', async () => {
  const { fetchImpl, signToken } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(await signToken({ issuer: 'https://wrong.example/' })), config), OAuthAuthenticationError);
});

test('wrong audience/resource is rejected', async () => {
  const { fetchImpl, signToken } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(await signToken({ audience: 'https://other.example/mcp' })), config), OAuthAuthenticationError);
});

test('expired token is rejected', async () => {
  const { fetchImpl, signToken } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(await signToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 })), config), OAuthAuthenticationError);
});

test('future nbf is rejected', async () => {
  const { fetchImpl, signToken } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(await signToken({ notBefore: Math.floor(Date.now() / 1000) + 600 })), config), OAuthAuthenticationError);
});

test('missing sub is rejected', async () => {
  const { fetchImpl, signToken } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(await signToken({ subject: null })), config), OAuthAuthenticationError);
});

test('missing memory:read scope is distinguished as insufficient scope', async () => {
  const { fetchImpl, signToken } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(await signToken({ scope: 'openid profile' })), config), OAuthInsufficientScopeError);
});

test('HS256 algorithm substitution is rejected', async () => {
  const { fetchImpl } = await createFixture();
  const validate = createOAuthTokenValidator({ fetchImpl });
  const secret = new TextEncoder().encode('test-only-secret-with-sufficient-length');
  const token = await new SignJWT({ scope: 'memory:read' })
    .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
    .setIssuer(config.issuer)
    .setAudience(config.resource)
    .setSubject('auth0|test-user')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);

  await assert.rejects(validate(requestWith(token), config), OAuthAuthenticationError);
});

test('JWKS fetch failure fails closed as a generic authentication error', async () => {
  const { signToken } = await createFixture();
  const fetchImpl = async () => new Response('unavailable', { status: 500 });
  const validate = createOAuthTokenValidator({ fetchImpl });
  await assert.rejects(validate(requestWith(await signToken()), config), OAuthAuthenticationError);
});
