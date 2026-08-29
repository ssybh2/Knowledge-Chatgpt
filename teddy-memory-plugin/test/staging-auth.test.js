import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StagingAuthConfigurationError,
  constantWorkEqual,
  resolveStagingPrincipal,
} from '../src/staging-auth.js';

function requestWithAuthorization(value) {
  const headers = value ? { authorization: value } : {};
  return new Request('https://plugin.example.com/mcp', { headers });
}

test('missing staging token configuration throws a non-secret configuration error', () => {
  assert.throws(
    () => resolveStagingPrincipal(requestWithAuthorization(), {
      PLUGIN_DEV_OWNER_ID: 'teddy-primary',
    }),
    (error) => error instanceof StagingAuthConfigurationError
      && /configured/i.test(error.message)
      && !error.message.includes('teddy-primary'),
  );
});

test('missing staging owner configuration also fails closed', () => {
  assert.throws(
    () => resolveStagingPrincipal(requestWithAuthorization(), {
      PLUGIN_DEV_ACCESS_TOKEN: 'stage-secret',
    }),
    StagingAuthConfigurationError,
  );
});

test('missing or wrong bearer resolves to no principal', () => {
  const env = {
    PLUGIN_DEV_ACCESS_TOKEN: 'stage-secret',
    PLUGIN_DEV_OWNER_ID: 'teddy-primary',
  };

  assert.equal(resolveStagingPrincipal(requestWithAuthorization(), env), null);
  assert.equal(resolveStagingPrincipal(requestWithAuthorization('Bearer wrong-secret'), env), null);
});

test('correct bearer resolves only the configured owner id', () => {
  const principal = resolveStagingPrincipal(
    requestWithAuthorization('Bearer stage-secret'),
    {
      PLUGIN_DEV_ACCESS_TOKEN: 'stage-secret',
      PLUGIN_DEV_OWNER_ID: 'teddy-primary',
    },
  );

  assert.deepEqual(principal, { ownerId: 'teddy-primary' });
});

test('secret equality uses a constant-work XOR loop instead of direct string equality', () => {
  assert.equal(constantWorkEqual('same-secret', 'same-secret'), true);
  assert.equal(constantWorkEqual('same-secret', 'other-secret'), false);
  assert.equal(constantWorkEqual('short', 'much-longer-secret'), false);

  const source = constantWorkEqual.toString();
  assert.match(source, /charCodeAt/);
  assert.match(source, /\^/);
  assert.doesNotMatch(source, /return\s+left\s*===\s*right/);
});
