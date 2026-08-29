import test from 'node:test';
import assert from 'node:assert/strict';

import { protectedResourceMetadata, bearerChallenge } from '../src/oauth-metadata.js';

const config = {
  issuer: 'https://tenant.example.auth0.com/',
  resource: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  requiredScope: 'memory:read',
  metadataUrl: 'https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource',
};

test('metadata advertises only the public resource and memory:read', () => {
  const metadata = protectedResourceMetadata(config);
  assert.deepEqual(metadata, {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ['memory:read'],
  });
  assert.equal(JSON.stringify(metadata).includes('offline_access'), false);
});

test('anonymous and insufficient-scope challenges point at resource metadata', () => {
  assert.equal(
    bearerChallenge(config),
    `Bearer resource_metadata="${config.metadataUrl}", scope="memory:read"`,
  );
  assert.equal(
    bearerChallenge(config, { insufficientScope: true }),
    `Bearer error="insufficient_scope", resource_metadata="${config.metadataUrl}", scope="memory:read"`,
  );
});
