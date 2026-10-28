const fs = require('fs');
const path = require('path');
// Usage: node corpus.cjs <out.json>. Run from anywhere; paths resolve from this file.
const ROOT = path.resolve(__dirname, '../../../..');
const FIX = path.join(ROOT, 'test/fixtures/prism-upstream/languages');
const MAIN_TO_LANG = { markup:'html', bash:'bash', docker:'dockerfile' };
const KNOWN = new Set(['javascript','typescript','python','java','c','cpp','csharp','go','rust','ruby','php','swift','kotlin','sql','css','json','yaml','markdown','graphql','r','scala','dart','lua','latex']);
const out = [];
for (const dir of fs.readdirSync(FIX).sort()) {
  const parts = dir.split('+'); const marked = parts.find(p => p.endsWith('!'));
  const main = (marked || parts[parts.length - 1]).replace('!', '');
  const lang = MAIN_TO_LANG[main] || (KNOWN.has(main) ? main : null);
  if (!lang) continue;
  for (const f of fs.readdirSync(path.join(FIX, dir)).filter(f => f.endsWith('.test')).sort()) {
    const code = fs.readFileSync(path.join(FIX, dir, f), 'utf8').replace(/\r\n?/g, '\n').split(/^-{10,}[ \t]*$/m, 3)[0].trim();
    out.push({ lang, source: `upstream:${dir}/${f}`, code });
  }
}
// Blok's own snippets
for (const file of ['test/unit/tools/code/prism-coverage.test.ts', 'test/unit/tools/code/prism-integration.test.ts']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of src.matchAll(/^\s+'?([\w-]+)'?:\s+('(?:[^'\\]|\\.)*'),?\s*$/gm)) {
    let code; try { code = new Function('return ' + m[2])(); } catch { continue; }
    if (m[1] === 'mermaid' || m[1] === 'plain text') continue;
    out.push({ lang: m[1], source: `blok:${path.basename(file)}`, code });
  }
}
out.push(...require('./extra.cjs'));
// Real files from this repo, capped
const take = (lang, rel, max = 160) => out.push({ lang, source: `repo:${rel}`, code: fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').slice(0, max).join('\n') });
take('typescript', 'src/tools/code/line-geometry.ts');
take('typescript', 'src/tools/code/code-keyboard.ts');
take('css', 'src/styles/colors.css');
take('markdown', 'README.md');
take('markdown', 'CONTRIBUTING.md');
take('json', 'tsconfig.json');
take('yaml', '.github/workflows/ci.yml');
take('html', 'index.html');
take('javascript', 'commitlint.config.js');
take('xml', 'index.html', 60);
fs.writeFileSync(process.argv[2], JSON.stringify(out));
const byLang = {}; for (const c of out) byLang[c.lang] = (byLang[c.lang] || 0) + 1;
console.log(out.length, JSON.stringify(byLang));
