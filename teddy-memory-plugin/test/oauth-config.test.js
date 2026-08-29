import test from 'node:test';
import assert from 'node:assert/strict';

import { readOAuthConfig } from '../src/oauth-config.js';

const validEnv = {
  PLUGIN_OAUTH_ISSUER: 'https://tenant.example.auth0.com/',
  PLUGIN_OAUTH_RESOURCE: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  PLUGIN_OAUTH_REQUIRED_SCOPE: 'memory:read',
};

test('readOAuthConfig returns canonical OAuth settings', () => {
  assert.deepEqual(readOAuthConfig(validEnv), {
    issuer: 'https://tenant.example.auth0.com/',
    resource: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
    requiredScope: 'memory:read',
    metadataUrl: 'https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource',
  });
});

test('OAuth config fails closed for missing or non-HTTPS issuer/resource', () => {
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_ISSUER: '' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_ISSUER: 'http://tenant.example/' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_RESOURCE: 'http://plugin.example/mcp' }));
});

test('OAuth config requires memory:read exactly', () => {
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_REQUIRED_SCOPE: 'memory:write' }));
});
