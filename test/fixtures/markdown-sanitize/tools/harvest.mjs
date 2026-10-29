// Builds inputs.json.gz: the frozen inputs for record.mjs. Run once; the
// recorded golden must not move when READMEs or docs change later.
// Usage: node tools/harvest.mjs <dompurify-payloads.json>
//   The payloads file holds DOMPurify 3.4.17's test payloads as
//   [{ id, source, title, payload }] (see README.md for how it was built).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HAND_CASES } from './hand-cases.mjs';
import { FIXTURE_DIR, ROOT, bundle, installDom, writeGz } from './lib.mjs';

const payloadFile = process.argv[2];

if (payloadFile === undefined) {
  throw new Error('usage: node tools/harvest.mjs <dompurify-payloads.json>');
}

installDom();

// markdownToHtml calls sanitizeBlockHtml once per block-level html node, with
// the raw source. Swapping the module for a recorder yields exactly those strings.
const capture = {
  name: 'capture-sanitize',
  setup(build) {
    build.onResolve({ filter: /\/sanitize-html$/ }, () => ({ path: 'capture', namespace: 'capture' }));
    build.onLoad({ filter: /.*/, namespace: 'capture' }, () => ({
      contents: 'export async function sanitizeBlockHtml(raw) { globalThis.__htmlBlocks.push(raw); return ""; }',
      loader: 'js',
    }));
  },
};

const lib = await bundle(`
  export { markdownToHtml } from './src/markdown/markdownToHtml';
  export { fuzzCorpus, FUZZ_COUNT, FUZZ_SEED } from './test/unit/markdown/engine/corpus';
`, [capture]);

const htmlBlocks = async (markdown) => {
  globalThis.__htmlBlocks = [];
  await lib.markdownToHtml(markdown);

  return globalThis.__htmlBlocks;
};

const benign = new Map();
const stats = {};
const failures = [];

const add = (input, source) => {
  if (!benign.has(input)) {
    benign.set(input, { source, seen: 0 });
  }
  benign.get(input).seen++;
};

const harvestDoc = async (markdown, source, group) => {
  try {
    const blocks = await htmlBlocks(markdown);

    stats[group] = (stats[group] ?? 0) + blocks.length;
    blocks.forEach((raw) => add(raw, source));
  } catch (error) {
    failures.push({ source, error: String(error) });
  }
};

const mdFiles = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((file) => file !== '' && !file.startsWith('docs/plans/'));

for (const file of mdFiles) {
  await harvestDoc(readFileSync(path.join(ROOT, file), 'utf8'), `repo-md:${file}`, 'repo-md');
}

const engineFixture = (name) => JSON.parse(gunzipSync(readFileSync(path.join(ROOT, 'test/unit/markdown/engine/fixtures', name))).toString('utf8'));
const upstream = engineFixture('upstream-corpus.json.gz');
const realworld = engineFixture('realworld-corpus.json.gz');
const fuzz = lib.fuzzCorpus(lib.FUZZ_COUNT, lib.FUZZ_SEED, upstream.map((entry) => entry.input));

for (const entry of upstream) {
  await harvestDoc(entry.input, `pipeline-upstream:${entry.source}`, 'pipeline-upstream');
}
for (const entry of realworld) {
  await harvestDoc(entry.input, `pipeline-realworld:${entry.source}`, 'pipeline-realworld');
}
for (const entry of fuzz) {
  await harvestDoc(entry.input, `pipeline-fuzz:${entry.source}`, 'pipeline-fuzz');
}

// A hand case is Markdown. What the parser hands over is kept as `hand:<n>`.
// When that is not the case itself (a blank line splits the block, or the
// line is inline HTML, which is escaped), the raw string is kept too as
// `hand-direct:<n>`: it still covers the sanitizer's API.
const handDirect = [];

for (const [index, input] of HAND_CASES.entries()) {
  const blocks = await htmlBlocks(input);

  stats.hand = (stats.hand ?? 0) + blocks.length;
  blocks.forEach((raw) => add(raw, `hand:${index + 1}`));
  if (blocks.length !== 1 || blocks[0] !== input) {
    handDirect.push(index + 1);
    add(input, `hand-direct:${index + 1}`);
  }
}

const id = (input) => `b-${createHash('sha1').update(input).digest('hex').slice(0, 10)}`;
const rows = [...benign].map(([input, { source, seen }]) => ({ id: id(input), kind: 'benign', source, seen, input }));

if (new Set(rows.map((row) => row.id)).size !== rows.length) {
  throw new Error('benign id collision');
}

const payloads = JSON.parse(readFileSync(payloadFile, 'utf8'));

for (const p of payloads) {
  rows.push({ id: p.id, kind: 'hostile', source: `dompurify-3.4.17:${p.source}`, title: p.title, input: p.payload });
}

writeGz(path.join(FIXTURE_DIR, 'inputs.json.gz'), {
  note: 'Frozen inputs. benign: raw html blocks from Markdown (deduplicated, first source kept, `seen` = how often). hostile: DOMPurify 3.4.17 test payloads.',
  mdFiles: mdFiles.length,
  pipelineDocs: { upstream: upstream.length, realworld: realworld.length, fuzz: fuzz.length },
  htmlBlocksBeforeDedup: stats,
  handNotOneBlock: handDirect,
}, rows);

console.log(JSON.stringify({ mdFiles: mdFiles.length, stats, benignUnique: benign.size, hostile: payloads.length, handNotOneBlock: handDirect, failures }, null, 1));
