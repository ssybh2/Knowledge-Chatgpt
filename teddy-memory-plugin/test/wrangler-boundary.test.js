import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wranglerUrl = new URL('../wrangler.jsonc', import.meta.url);

function readWrangler() {
  const text = readFileSync(wranglerUrl, 'utf8');
  return { text, config: JSON.parse(text) };
}

test('Wrangler binds only the independent safe D1', () => {
  const { config } = readWrangler();
  assert.deepEqual(config.d1_databases?.map((entry) => entry.binding), ['SAFE_DB']);
  assert.deepEqual(config.d1_databases?.map((entry) => entry.database_name), ['teddy-memory-plugin-safe']);
});

test('Wrangler tracks canonical OAuth resource and exact read-only scope', () => {
  const { config } = readWrangler();
  assert.equal(
    config.vars?.PLUGIN_OAUTH_RESOURCE,
    'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  );
  assert.equal(config.vars?.PLUGIN_OAUTH_REQUIRED_SCOPE, 'memory:read');
});

test('Wrangler contains no Plan 2 staging or private-track runtime configuration', () => {
  const { text, config } = readWrangler();
  assert.equal(Object.hasOwn(config.vars || {}, 'PLUGIN_DEV_ACCESS_TOKEN'), false);
  assert.equal(Object.hasOwn(config.vars || {}, 'PLUGIN_DEV_OWNER_ID'), false);

  for (const forbidden of [
    'teddy-memory-core',
    'teddy-memory-api',
    'TEDDY_MEMORY_API',
    'MEMORY_API_KEY',
    'MCP_ACCESS_TOKEN',
  ]) {
    assert.equal(text.includes(forbidden), false, `wrangler must not contain ${forbidden}`);
  }
});

test('tracked Auth0 issuer is either absent before tenant setup or canonical HTTPS', () => {
  const { config } = readWrangler();
  const issuer = config.vars?.PLUGIN_OAUTH_ISSUER;
  if (issuer === undefined) return;
  assert.match(issuer, /^https:\/\//);
  assert.equal(issuer.endsWith('/'), true);
  const parsed = new URL(issuer);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
});
