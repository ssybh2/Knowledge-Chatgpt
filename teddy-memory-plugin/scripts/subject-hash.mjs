import { pathToFileURL } from 'node:url';

import { hashPrincipalSubject } from '../src/principal-repository.js';

export async function subjectHashFromEnv(env = process.env) {
  const issuer = String(env.PLUGIN_OAUTH_ISSUER || '');
  const subject = String(env.PLUGIN_OAUTH_SUBJECT || '');
  if (!issuer || !subject) {
    throw new Error('OAuth subject hash inputs are required');
  }
  return hashPrincipalSubject(issuer, subject);
}

async function main() {
  try {
    const hash = await subjectHashFromEnv();
    process.stdout.write(`${hash}\n`);
  } catch {
    process.stderr.write('Unable to compute OAuth subject hash\n');
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
