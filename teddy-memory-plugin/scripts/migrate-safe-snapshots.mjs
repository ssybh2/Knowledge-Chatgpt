import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runOAuthLogin } from './oauth-login.mjs';

const EXPECTED_SAFE_ROWS = 4227;
const OWNER_ID = 'teddy-primary';
const DATABASE = 'teddy-memory-plugin-safe';
const LEGACY_SNAPSHOT = 'snap_legacy_seed_v1';
const PUBLIC_OAUTH = Object.freeze({
  issuer: 'https://dev-32xguyuwp0wrwddr.us.auth0.com/',
  clientId: '1hN8PGhbAUGzOvyJOkF7gObHiDE318qA',
  pluginBaseUrl: 'https://teddy-memory-plugin.3767174214.workers.dev',
  resource: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  redirectUri: 'http://localhost:8789/callback',
});
const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER_JS = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const SCHEMA_SQL = fileURLToPath(new URL('../sql/002_safe_snapshots.sql', import.meta.url));
const SEED_SQL = fileURLToPath(new URL('../sql/003_seed_legacy_safe_snapshot.sql', import.meta.url));

const BASELINE_SQL = `SELECT COUNT(*) AS total, SUM(CASE WHEN owner_id='${OWNER_ID}' THEN 1 ELSE 0 END) AS teddy_primary, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active FROM safe_memories;`;
const PRINCIPAL_SQL = `SELECT COUNT(*) AS active_principals FROM oauth_principals WHERE owner_id='${OWNER_ID}' AND is_active=1;`;
const SNAPSHOT_SQL = `SELECT s.snapshot_id, s.record_count, s.status, COUNT(m.memory_ref) AS loaded FROM safe_snapshots s LEFT JOIN safe_snapshot_memories m ON m.snapshot_id=s.snapshot_id AND m.owner_id=s.owner_id WHERE s.snapshot_id='${LEGACY_SNAPSHOT}' AND s.owner_id='${OWNER_ID}' GROUP BY s.snapshot_id,s.record_count,s.status;`;
const POINTER_SQL = `SELECT owner_id, snapshot_id FROM safe_active_snapshot WHERE owner_id='${OWNER_ID}';`;
const ACTIVE_ROWS_SQL = `SELECT COUNT(*) AS active_rows FROM safe_snapshot_memories m JOIN safe_active_snapshot a ON a.snapshot_id=m.snapshot_id AND a.owner_id=m.owner_id WHERE a.owner_id='${OWNER_ID}' AND m.is_active=1;`;

export async function runCommand(command, args, { cwd = PLUGIN_DIR, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: Number(code ?? 1), stdout, stderr }));
  });
}

function ensureSuccess(result, label) {
  if (!result || Number(result.code) !== 0) throw new Error(`${label} failed`);
  return result;
}

export function parseD1Rows(stdout) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || ''));
  } catch {
    throw new Error('Wrangler D1 returned invalid JSON');
  }
  const queue = [payload];
  while (queue.length > 0) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      for (const item of value) queue.push(item);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value.results)) return value.results;
    if (Array.isArray(value.result)) return value.result;
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') queue.push(nested);
    }
  }
  return [];
}

export function latestDeploymentVersion(stdout) {
  const matches = [];
  const pattern = /Version\(s\):\s*\(100%\)\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})/g;
  for (const match of String(stdout || '').matchAll(pattern)) matches.push(match[1]);
  if (matches.length === 0) throw new Error('Could not determine current Worker deployment version');
  return matches.at(-1);
}

async function wrangler(runCommandImpl, args) {
  return runCommandImpl(process.execPath, [WRANGLER_JS, ...args], { cwd: PLUGIN_DIR, env: process.env });
}

async function query(runCommandImpl, sql) {
  const result = ensureSuccess(await wrangler(runCommandImpl, [
    'd1', 'execute', DATABASE, '--remote', '--json', '--command', sql,
  ]), 'Remote D1 query');
  return parseD1Rows(result.stdout);
}

async function executeFile(runCommandImpl, path, label) {
  ensureSuccess(await wrangler(runCommandImpl, [
    'd1', 'execute', DATABASE, '--remote', '--json', '--file', path,
  ]), label);
}

function exactNumber(row, key, expected, label) {
  const actual = Number(row?.[key]);
  if (!Number.isFinite(actual) || actual !== expected) throw new Error(`${label} mismatch: expected ${expected}`);
  return actual;
}

function assertBaseline(rows, expectedSafeRows) {
  const row = rows[0];
  exactNumber(row, 'total', expectedSafeRows, 'Safe baseline total');
  exactNumber(row, 'teddy_primary', expectedSafeRows, 'Safe baseline owner count');
  exactNumber(row, 'active', expectedSafeRows, 'Safe baseline active count');
}

function assertPrincipal(rows) {
  return exactNumber(rows[0], 'active_principals', 1, 'Active OAuth principal count');
}

function assertSeed(rows, expectedSafeRows) {
  const row = rows[0];
  if (String(row?.snapshot_id || '') !== LEGACY_SNAPSHOT || String(row?.status || '') !== 'active') {
    throw new Error('Legacy Safe snapshot seed verification failed');
  }
  exactNumber(row, 'record_count', expectedSafeRows, 'Legacy snapshot record_count');
  return exactNumber(row, 'loaded', expectedSafeRows, 'Legacy snapshot loaded count');
}

function assertPointer(rows) {
  const row = rows[0];
  if (String(row?.owner_id || '') !== OWNER_ID || String(row?.snapshot_id || '') !== LEGACY_SNAPSHOT) {
    throw new Error('Safe active snapshot pointer verification failed');
  }
}

async function defaultOAuthLogin({ write }) {
  return runOAuthLogin({
    issuer: process.env.TEDDY_AUTH0_ISSUER || PUBLIC_OAUTH.issuer,
    clientId: process.env.TEDDY_AUTH0_CLIENT_ID || PUBLIC_OAUTH.clientId,
    pluginBaseUrl: process.env.TEDDY_PLUGIN_URL || PUBLIC_OAUTH.pluginBaseUrl,
    resource: process.env.TEDDY_PLUGIN_RESOURCE || PUBLIC_OAUTH.resource,
    redirectUri: process.env.TEDDY_AUTH0_REDIRECT_URI || PUBLIC_OAUTH.redirectUri,
    write,
  });
}

export async function runProductionSafeSnapshotMigration({
  runCommandImpl = runCommand,
  oauthLoginImpl = defaultOAuthLogin,
  write = (line) => console.log(line),
  expectedSafeRows = EXPECTED_SAFE_ROWS,
} = {}) {
  if (typeof runCommandImpl !== 'function') throw new TypeError('runCommandImpl must be a function');
  if (typeof oauthLoginImpl !== 'function') throw new TypeError('oauthLoginImpl must be a function');
  if (typeof write !== 'function') throw new TypeError('write must be a function');
  const expected = Number(expectedSafeRows);
  if (!Number.isInteger(expected) || expected < 1) throw new TypeError('expectedSafeRows must be a positive integer');

  write('MIGRATION preflight START');
  const baselineRows = await query(runCommandImpl, BASELINE_SQL);
  assertBaseline(baselineRows, expected);
  const initialPrincipal = assertPrincipal(await query(runCommandImpl, PRINCIPAL_SQL));
  write(`MIGRATION baseline PASS safe_rows=${expected} active_principals=${initialPrincipal}`);

  await executeFile(runCommandImpl, SCHEMA_SQL, 'Snapshot schema migration');
  const principalAfterSchema = assertPrincipal(await query(runCommandImpl, PRINCIPAL_SQL));
  write(`MIGRATION schema PASS active_principals=${principalAfterSchema}`);

  await executeFile(runCommandImpl, SEED_SQL, 'Legacy snapshot seed');
  const seededRows = assertSeed(await query(runCommandImpl, SNAPSHOT_SQL), expected);
  assertPointer(await query(runCommandImpl, POINTER_SQL));
  write(`MIGRATION seed PASS snapshot_rows=${seededRows}`);

  const deployments = ensureSuccess(await wrangler(runCommandImpl, ['deployments', 'list']), 'Deployment listing');
  const rollbackVersion = latestDeploymentVersion(deployments.stdout);
  write(`MIGRATION rollback-version PASS version=${rollbackVersion}`);

  ensureSuccess(await wrangler(runCommandImpl, ['deploy']), 'Worker deployment');
  write('MIGRATION deploy PASS');

  try {
    const oauthReport = await oauthLoginImpl({ write });
    if (oauthReport?.oauth_authenticated !== true) throw new Error('OAuth live smoke did not authenticate');
  } catch {
    write('MIGRATION oauth FAIL; rolling back Worker');
    ensureSuccess(await wrangler(runCommandImpl, ['rollback', rollbackVersion]), 'Worker rollback');
    write('MIGRATION rollback PASS');
    throw new Error('Post-deploy OAuth smoke failed; Worker rolled back');
  }
  write('MIGRATION oauth PASS');

  const finalPrincipal = assertPrincipal(await query(runCommandImpl, PRINCIPAL_SQL));
  const activeRows = exactNumber((await query(runCommandImpl, ACTIVE_ROWS_SQL))[0], 'active_rows', expected, 'Final active Safe row count');
  assertPointer(await query(runCommandImpl, POINTER_SQL));
  write(`MIGRATION final PASS active_principals=${finalPrincipal} active_rows=${activeRows}`);

  const report = {
    baseline_safe_rows: expected,
    active_principals: finalPrincipal,
    seeded_snapshot_rows: seededRows,
    rollback_version: rollbackVersion,
    deployed: true,
    oauth_authenticated: true,
    final_active_rows: activeRows,
  };
  write(`MIGRATION COMPLETE ${JSON.stringify(report)}`);
  return report;
}

async function main() {
  try {
    await runProductionSafeSnapshotMigration();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Safe snapshot migration failed');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
