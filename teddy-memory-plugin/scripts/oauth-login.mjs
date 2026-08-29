import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { runLiveSmoke } from './live-smoke.mjs';

const DEFAULT_REDIRECT_URI = 'http://localhost:8789/callback';
const DEFAULT_SCOPES = 'openid offline_access memory:read';
const CALLBACK_TIMEOUT_MS = 180_000;

function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function normalizeIssuer(value) {
  const text = requiredText(value, 'Auth0 issuer');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Auth0 issuer must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Auth0 issuer must be a valid HTTPS URL');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString();
}

function normalizeResource(value) {
  const text = requiredText(value, 'OAuth resource');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('OAuth resource must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.search || url.hash) {
    throw new Error('OAuth resource must be a valid HTTPS URL');
  }
  return url.toString();
}

function base64UrlRandom(bytes) {
  return randomBytes(bytes).toString('base64url');
}

function equalState(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function codeChallengeForVerifier(verifier) {
  const text = requiredText(verifier, 'PKCE verifier');
  return createHash('sha256').update(text, 'ascii').digest('base64url');
}

export function buildAuthorizationUrl({
  issuer,
  clientId,
  redirectUri,
  resource,
  state,
  codeChallenge,
} = {}) {
  const normalizedIssuer = normalizeIssuer(issuer);
  const url = new URL('authorize', normalizedIssuer);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', requiredText(clientId, 'Auth0 client ID'));
  url.searchParams.set('redirect_uri', requiredText(redirectUri, 'OAuth redirect URI'));
  url.searchParams.set('scope', DEFAULT_SCOPES);
  url.searchParams.set('resource', normalizeResource(resource));
  url.searchParams.set('state', requiredText(state, 'OAuth state'));
  url.searchParams.set('code_challenge', requiredText(codeChallenge, 'PKCE code challenge'));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function validateCallback(callbackUrl, expectedState) {
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error('OAuth callback URL is invalid');
  }

  if (url.searchParams.has('error')) {
    throw new Error('Auth0 authorization was not completed');
  }
  if (!equalState(url.searchParams.get('state'), expectedState)) {
    throw new Error('OAuth callback state mismatch');
  }
  const code = String(url.searchParams.get('code') || '').trim();
  if (!code) throw new Error('OAuth callback did not contain an authorization code');
  return { code };
}

export async function exchangeAuthorizationCode({
  issuer,
  clientId,
  redirectUri,
  resource,
  code,
  codeVerifier,
  fetchImpl = fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const normalizedIssuer = normalizeIssuer(issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: requiredText(clientId, 'Auth0 client ID'),
    redirect_uri: requiredText(redirectUri, 'OAuth redirect URI'),
    code: requiredText(code, 'authorization code'),
    code_verifier: requiredText(codeVerifier, 'PKCE verifier'),
    resource: normalizeResource(resource),
  });

  const response = await fetchImpl(new URL('oauth/token', normalizedIssuer), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`Auth0 token exchange failed with status ${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Auth0 token exchange returned invalid JSON');
  }

  const accessToken = String(payload?.access_token || '').trim();
  const refreshToken = String(payload?.refresh_token || '').trim();
  if (!accessToken) throw new Error('Auth0 token exchange did not return an access token');
  if (!refreshToken) throw new Error('Auth0 token exchange did not return a refresh token');
  return { accessToken, refreshToken };
}

function validateLoopbackRedirect(value) {
  const url = new URL(requiredText(value, 'OAuth redirect URI'));
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('OAuth redirect URI must be an HTTP loopback URL');
  }
  if (!url.port) throw new Error('OAuth redirect URI must include a loopback port');
  return url;
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function waitForCallback({ redirectUri, expectedState, authorizationUrl }) {
  const redirect = validateLoopbackRedirect(redirectUri);
  const port = Number(redirect.port);

  let settle;
  let rejectSettle;
  const callbackPromise = new Promise((resolve, reject) => {
    settle = resolve;
    rejectSettle = reject;
  });

  const server = http.createServer((request, response) => {
    const incoming = new URL(request.url || '/', redirect.origin);
    if (incoming.pathname !== redirect.pathname) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    try {
      const { code } = validateCallback(incoming.toString(), expectedState);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end('<!doctype html><meta charset="utf-8"><title>Teddy Memory</title><p>Auth0 login received. You can close this tab and return to PowerShell.</p>');
      settle(code);
    } catch (error) {
      response.writeHead(400, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end('<!doctype html><meta charset="utf-8"><title>Teddy Memory</title><p>OAuth callback validation failed. Return to PowerShell.</p>');
      rejectSettle(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, redirect.hostname, resolve);
  });

  const timeout = setTimeout(() => {
    rejectSettle(new Error('Timed out waiting for Auth0 callback'));
  }, CALLBACK_TIMEOUT_MS);

  try {
    openBrowser(authorizationUrl);
    return await callbackPromise;
  } finally {
    clearTimeout(timeout);
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

export async function runOAuthLogin({
  issuer,
  clientId,
  pluginBaseUrl,
  resource,
  redirectUri = DEFAULT_REDIRECT_URI,
  fetchImpl = fetch,
  write = (line) => console.log(line),
} = {}) {
  const normalizedIssuer = normalizeIssuer(issuer);
  const normalizedClientId = requiredText(clientId, 'Auth0 client ID');
  const normalizedBaseUrl = requiredText(pluginBaseUrl, 'Teddy Plugin URL').replace(/\/+$/, '');
  const normalizedResource = normalizeResource(resource || `${normalizedBaseUrl}/mcp`);
  const normalizedRedirectUri = validateLoopbackRedirect(redirectUri).toString();

  const state = base64UrlRandom(24);
  const codeVerifier = base64UrlRandom(48);
  const codeChallenge = await codeChallengeForVerifier(codeVerifier);
  const authorizationUrl = buildAuthorizationUrl({
    issuer: normalizedIssuer,
    clientId: normalizedClientId,
    redirectUri: normalizedRedirectUri,
    resource: normalizedResource,
    state,
    codeChallenge,
  });

  write('Opening Auth0 login in your browser...');
  const code = await waitForCallback({
    redirectUri: normalizedRedirectUri,
    expectedState: state,
    authorizationUrl,
  });

  const { accessToken } = await exchangeAuthorizationCode({
    issuer: normalizedIssuer,
    clientId: normalizedClientId,
    redirectUri: normalizedRedirectUri,
    resource: normalizedResource,
    code,
    codeVerifier,
    fetchImpl,
  });

  return runLiveSmoke({
    baseUrl: normalizedBaseUrl,
    token: accessToken,
    fetchImpl,
    write,
  });
}

async function main() {
  try {
    await runOAuthLogin({
      issuer: process.env.TEDDY_AUTH0_ISSUER || process.env.PLUGIN_OAUTH_ISSUER,
      clientId: process.env.TEDDY_AUTH0_CLIENT_ID,
      pluginBaseUrl: process.env.TEDDY_PLUGIN_URL,
      resource: process.env.TEDDY_PLUGIN_RESOURCE,
      redirectUri: process.env.TEDDY_AUTH0_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'OAuth login test failed');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
