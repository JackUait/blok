import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const hashOf = (content) => createHash('sha256').update(content).digest('hex').slice(0, 12);

export const payloadFileName = (hash) => `blok-override.${hash}.js`;

export function stagePayload(payloadDir, code, meta) {
  mkdirSync(payloadDir, { recursive: true });
  const hash = hashOf(code);
  const file = payloadFileName(hash);
  writeFileSync(join(payloadDir, file), code);
  writeFileSync(join(payloadDir, 'current.json'), `${JSON.stringify({ file, hash, ...meta }, null, 2)}\n`);
  for (const stale of readdirSync(payloadDir)) {
    if (stale.startsWith('blok-override.') && stale !== file) {
      rmSync(join(payloadDir, stale));
    }
  }
  return { file };
}
