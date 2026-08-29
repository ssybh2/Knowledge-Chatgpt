import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../scripts/migrate-safe-snapshots.mjs', import.meta.url);

async function loadModule() {
  assert.equal(existsSync(fileURLToPath(moduleUrl)), true, 'scripts/migrate-safe-snapshots.mjs must exist');
  return import(moduleUrl.href);
}

function d1Json(rows) {
  return JSON.stringify([{ success: true, results: rows }]);
}

function makeRunner({ baselineTotal = 4227, oauthFails = false } = {}) {
  const calls = [];
  const priorVersion = '11111111-2222-4333-8444-555555555555';

  async function runCommand(command, args, options = {}) {
    calls.push({ command, args: [...args], options: { cwd: options.cwd, stdio: options.stdio } });
    const joined = args.join(' ');

    if (joined.includes("SELECT COUNT(*) AS total") && joined.includes('FROM safe_memories')) {
      return { code: 0, stdout: d1Json([{ total: baselineTotal, teddy_primary: baselineTotal, active: baselineTotal }]), stderr: '' };
    }
    if (joined.includes('active_principals') && joined.includes('oauth_principals')) {
      return { code: 0, stdout: d1Json([{ active_principals: 1 }]), stderr: '' };
    }
    if (joined.includes("s.snapshot_id='snap_legacy_seed_v1'")) {
      return { code: 0, stdout: d1Json([{ snapshot_id: 'snap_legacy_seed_v1', record_count: 4227, status: 'active', loaded: 4227 }]), stderr: '' };
    }
    if (joined.includes('FROM safe_active_snapshot') && joined.includes("owner_id='teddy-primary'")) {
      return { code: 0, stdout: d1Json([{ owner_id: 'teddy-primary', snapshot_id: 'snap_legacy_seed_v1' }]), stderr: '' };
    }
    if (joined.includes('active_rows') && joined.includes('safe_snapshot_memories')) {
      return { code: 0, stdout: d1Json([{ active_rows: 4227 }]), stderr: '' };
    }
    if (args[0]?.includes('wrangler') && args[1] === 'deployments' && args[2] === 'list') {
      return {
        code: 0,
        stdout: `Created: old\nVersion(s):  (100%) aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\n\nCreated: current\nVersion(s):  (100%) ${priorVersion}\n`,
        stderr: '',
      };
    }
    if (args[0]?.includes('wrangler') && args[1] === 'deploy') {
      return { code: 0, stdout: 'deployed without sensitive output', stderr: '' };
    }
    if (args[0]?.includes('wrangler') && args[1] === 'rollback') {
      return { code: 0, stdout: 'rolled back', stderr: '' };
    }
    if (joined.includes('--file')) {
      return { code: 0, stdout: d1Json([]), stderr: '' };
    }
    throw new Error(`unexpected command: ${command} ${joined}`);
  }

  async function oauthLogin() {
    calls.push({ oauth: true });
    if (oauthFails) throw new Error('synthetic oauth failure');
    return { oauth_authenticated: true, tools: 3, search_result_count: 4 };
  }

  return { calls, oauthLogin, priorVersion, runCommand };
}

test('latestDeploymentVersion selects the most recent 100 percent version', async () => {
  const { latestDeploymentVersion } = await loadModule();
  assert.equal(latestDeploymentVersion(`
Created: one
Version(s):  (100%) aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee
Created: two
Version(s):  (100%) 11111111-2222-4333-8444-555555555555
`), '11111111-2222-4333-8444-555555555555');
  assert.throws(() => latestDeploymentVersion('no version here'), /deployment|version/i);
});

test('production migration fails closed before writes when baseline count is unexpected', async () => {
  const { runProductionSafeSnapshotMigration } = await loadModule();
  const fake = makeRunner({ baselineTotal: 4226 });
  await assert.rejects(
    runProductionSafeSnapshotMigration({
      runCommandImpl: fake.runCommand,
      oauthLoginImpl: fake.oauthLogin,
      write: () => {},
    }),
    /baseline|4227|safe/i,
  );
  const flattened = fake.calls.filter((call) => call.args).map((call) => call.args.join(' ')).join('\n');
  assert.doesNotMatch(flattened, /--file|\bdeploy\b|\brollback\b/);
});

test('production migration performs schema seed deploy oauth and final aggregate checks in order', async () => {
  const { runProductionSafeSnapshotMigration } = await loadModule();
  const fake = makeRunner();
  const output = [];
  const report = await runProductionSafeSnapshotMigration({
    runCommandImpl: fake.runCommand,
    oauthLoginImpl: fake.oauthLogin,
    write: (line) => output.push(String(line)),
  });

  assert.deepEqual(report, {
    baseline_safe_rows: 4227,
    active_principals: 1,
    seeded_snapshot_rows: 4227,
    rollback_version: fake.priorVersion,
    deployed: true,
    oauth_authenticated: true,
    final_active_rows: 4227,
  });

  const actions = fake.calls.map((call) => {
    if (call.oauth) return 'oauth';
    const joined = call.args.join(' ');
    if (joined.includes('002_safe_snapshots.sql')) return 'schema';
    if (joined.includes('003_seed_legacy_safe_snapshot.sql')) return 'seed';
    if (call.args[1] === 'deployments') return 'deployments';
    if (call.args[1] === 'deploy') return 'deploy';
    if (joined.includes('active_rows')) return 'final-safe';
    return 'read';
  });
  assert.ok(actions.indexOf('schema') > actions.indexOf('read'));
  assert.ok(actions.indexOf('seed') > actions.indexOf('schema'));
  assert.ok(actions.indexOf('deployments') > actions.indexOf('seed'));
  assert.ok(actions.indexOf('deploy') > actions.indexOf('deployments'));
  assert.ok(actions.indexOf('oauth') > actions.indexOf('deploy'));
  assert.ok(actions.indexOf('final-safe') > actions.indexOf('oauth'));

  const printed = output.join('\n');
  assert.doesNotMatch(printed, /MEMORY_CONTENT_SENTINEL|SELECT |INSERT |oauth_principals|safe_memories/i);
});

test('production migration rolls back the exact prior Worker version when post-deploy OAuth smoke fails', async () => {
  const { runProductionSafeSnapshotMigration } = await loadModule();
  const fake = makeRunner({ oauthFails: true });
  await assert.rejects(
    runProductionSafeSnapshotMigration({
      runCommandImpl: fake.runCommand,
      oauthLoginImpl: fake.oauthLogin,
      write: () => {},
    }),
    /oauth|rollback|smoke/i,
  );
  const rollback = fake.calls.find((call) => call.args?.[1] === 'rollback');
  assert.ok(rollback, 'rollback command must run');
  assert.equal(rollback.args[2], fake.priorVersion);
});
