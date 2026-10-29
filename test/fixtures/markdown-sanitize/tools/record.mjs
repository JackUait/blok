// Records golden.json.gz: every input of inputs.json.gz run through the
// DOMPurify-based sanitizeBlockHtml (src/markdown/sanitize-html.ts before 7c47c966),
// once with no base URL (Ask AI) and once with a README base URL (file preview).
//
// Re-recording needs the DOMPurify-based sanitize-html.ts and dompurify 3.4.17
// in node_modules. Once dompurify leaves package.json it may still be there
// through mermaid (which depends on dompurify ^3.4.12), but do not count on it:
// check node_modules/dompurify/package.json, or `yarn add -D dompurify@3.4.17`
// temporarily, record, then remove it again. The script refuses other versions.
// Usage: node tools/record.mjs [out-file]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_DIR, README_BASE, ROOT, bundle, installDom, readGz, writeGz } from './lib.mjs';

const SOURCE = 'src/markdown/sanitize-html.ts';
const blob = (file) => execFileSync('git', ['hash-object', file], { cwd: ROOT, encoding: 'utf8' }).trim();
const versionOf = (pkg) => JSON.parse(readFileSync(path.join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version;
const versions = { dompurify: versionOf('dompurify'), jsdom: versionOf('jsdom') };

if (versions.dompurify !== '3.4.17' || versions.jsdom !== '29.1.1') {
  throw new Error(`need dompurify 3.4.17 and jsdom 29.1.1, found ${JSON.stringify(versions)}`);
}
if (!readFileSync(path.join(ROOT, SOURCE), 'utf8').includes("import('dompurify')")) {
  throw new Error(`${SOURCE} no longer uses DOMPurify; the golden must come from the DOMPurify version`);
}

installDom();

const { sanitizeBlockHtml } = await bundle(`export { sanitizeBlockHtml } from './${SOURCE}';`);
const probe = await sanitizeBlockHtml('<img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><script>alert(1)</script>');

if (/onerror|javascript:|script/i.test(probe)) {
  throw new Error(`sanitizer did not sanitize the probe: ${probe}`);
}

const { cases } = readGz(path.join(FIXTURE_DIR, 'inputs.json.gz'));
const rows = [];

for (const { id, kind, source, input } of cases) {
  rows.push({ id, kind, source, input, output: await sanitizeBlockHtml(input), outputWithBase: await sanitizeBlockHtml(input, README_BASE) });
}

writeGz(process.argv[2] ?? path.join(FIXTURE_DIR, 'golden.json.gz'), {
  note: 'output: sanitizeBlockHtml(input). outputWithBase: sanitizeBlockHtml(input, baseUrl). Compare bytes under jsdom only.',
  baseUrl: README_BASE,
  ...versions,
  sanitizeHtmlBlob: blob(SOURCE),
  sanitizeUrlBlob: blob('src/shared/sanitize-url.ts'),
}, rows);

console.log(`recorded ${rows.length} cases`);
