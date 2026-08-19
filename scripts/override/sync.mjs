import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPayload } from './build-payload.mjs';
import { stagePayload } from './sync-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const payloadDir = resolve(root, 'override-extension/payload');

const stage = (outDir, version, builtAt) => {
  const code = readFileSync(join(outDir, 'blok-override.js'), 'utf8');
  const { file } = stagePayload(payloadDir, code, { version, builtAt });
  console.log(`payload synced: ${file} (${version})`);
};

const watchMode = process.argv.includes('--watch');

if (watchMode) {
  const { result, outDir, version, builtAt } = await buildPayload({ watch: {} });
  result.on('event', (event) => {
    if (event.code === 'END') {
      stage(outDir, version, builtAt);
    }
    if (event.code === 'ERROR') {
      console.error(event.error);
    }
  });
  console.log('watching src/ — payload re-syncs on change; Ctrl-C to stop');
} else {
  const { outDir, version, builtAt } = await buildPayload();
  stage(outDir, version, builtAt);
}
