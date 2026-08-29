import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

export async function* readJsonl(path) {
  const input = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch (error) {
      const wrapped = new SyntaxError(`Invalid JSONL at line ${lineNumber}: ${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }
}

export async function writeJsonl(path, records) {
  await mkdir(dirname(path), { recursive: true });
  await new Promise(async (resolve, reject) => {
    const out = createWriteStream(path, { encoding: 'utf8' });
    out.on('error', reject);
    out.on('finish', resolve);
    try {
      for await (const record of records) {
        if (!out.write(`${JSON.stringify(record)}\n`)) {
          await new Promise((resume) => out.once('drain', resume));
        }
      }
      out.end();
    } catch (error) {
      out.destroy();
      reject(error);
    }
  });
}
