import test from 'node:test';
import assert from 'node:assert/strict';

import {
  browserLaunchSpec,
  buildAuthorizationUrl,
  codeChallengeForVerifier,
  exchangeAuthorizationCode,
  validateCallback,
} from '../scripts/oauth-login.mjs';

const issuer = 'https://tenant.example.auth0.com/';
const resource = 'https://teddy-memory-plugin.3767174214.workers.dev/mcp';
const redirectUri = 'http://localhost:8789/callback';

test('PKCE S256 challenge matches RFC 7636 example', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(
    await codeChallengeForVerifier(verifier),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('authorization URL uses code flow, PKCE S256, resource binding, and read-only scopes', () => {
  const url = new URL(buildAuthorizationUrl({
    issuer,
    clientId: 'public-client-id',
    redirectUri,
    resource,
    state: 'state-value',
    codeChallenge: 'challenge-value',
  }));

  assert.equal(url.origin, 'https://tenant.example.auth0.com');
  assert.equal(url.pathname, '/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'public-client-id');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('resource'), resource);
  assert.equal(url.searchParams.get('scope'), 'openid offline_access memory:read');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false);
});

test('Windows browser launcher bypasses cmd.exe so ampersands stay inside the OAuth URL', () => {
  const url = 'https://tenant.example.auth0.com/authorize?response_type=code&client_id=public-client-id&scope=memory%3Aread';
  const spec = browserLaunchSpec('win32', url);

  assert.equal(spec.command.toLowerCase(), 'rundll32.exe');
  assert.deepEqual(spec.args, ['url.dll,FileProtocolHandler', url]);
  assert.equal(spec.args.includes('/c'), false);
  assert.equal(spec.args.some((arg) => arg === 'cmd.exe'), false);
});

test('callback validation requires exact state and authorization code', () => {
  assert.deepEqual(
    validateCallback('http://localhost:8789/callback?code=abc&state=expected', 'expected'),
    { code: 'abc' },
  );
  assert.throws(
    () => validateCallback('http://localhost:8789/callback?code=abc&state=wrong', 'expected'),
    /state/i,
  );
  assert.throws(
    () => validateCallback('http://localhost:8789/callback?state=expected', 'expected'),
    /code/i,
  );
});

test('token exchange is PKCE-only, resource-bound, and never sends a client secret', async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({
      access_token: 'ACCESS_TOKEN_DO_NOT_PRINT',
      refresh_token: 'REFRESH_TOKEN_DO_NOT_PRINT',
      token_type: 'Bearer',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await exchangeAuthorizationCode({
    issuer,
    clientId: 'public-client-id',
    redirectUri,
    resource,
    code: 'authorization-code',
    codeVerifier: 'pkce-verifier',
    fetchImpl,
  });

  assert.deepEqual(result, {
    accessToken: 'ACCESS_TOKEN_DO_NOT_PRINT',
    refreshToken: 'REFRESH_TOKEN_DO_NOT_PRINT',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'https://tenant.example.auth0.com/oauth/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/x-www-form-urlencoded');

  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('client_id'), 'public-client-id');
  assert.equal(body.get('redirect_uri'), redirectUri);
  assert.equal(body.get('code'), 'authorization-code');
  assert.equal(body.get('code_verifier'), 'pkce-verifier');
  assert.equal(body.get('resource'), resource);
  assert.equal(body.has('client_secret'), false);
});

test('token exchange fails closed when Auth0 omits access or refresh token', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ access_token: 'only-access' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    exchangeAuthorizationCode({
      issuer,
      clientId: 'public-client-id',
      redirectUri,
      resource,
      code: 'authorization-code',
      codeVerifier: 'pkce-verifier',
      fetchImpl,
    }),
    /refresh token/i,
  );
});
