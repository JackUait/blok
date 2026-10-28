// Builds oracle fixtures from the real Prism 1.30.0 (node_modules/prismjs).
// Usage: node oracle.cjs <corpus.json>. Needs prismjs@1.30.0 installed (temporarily).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const COMP = path.join(ROOT, 'node_modules/prismjs/components');
const OUT = path.join(ROOT, 'test/fixtures/prism-upstream');

const ORDER = ['markup','css','clike','javascript','markup-templating','typescript','python','java','c','cpp','csharp','go','rust','ruby','php','swift','kotlin','sql','json','yaml','markdown','bash','docker','graphql','r','scala','dart','lua','latex'];
const REQ = { javascript:['clike'], 'markup-templating':['markup'], typescript:['javascript'], java:['clike'], c:['clike'], cpp:['c'], csharp:['clike'], go:['clike'], ruby:['clike'], php:['markup-templating'], kotlin:['clike'], markdown:['markup'], scala:['java'], dart:['clike'] };
const OPT = { markdown:['yaml'], graphql:['markdown'] };
const BASE = ['markup','css','clike','javascript'];

function freshPrism() {
  const mod = { exports: {} };
  const src = fs.readFileSync(path.join(COMP, 'prism-core.js'), 'utf8');
  new Function('module', 'self', 'window', 'document', 'global', src)(mod, undefined, undefined, undefined, {});
  const Prism = mod.exports;
  const loaded = new Set();
  const load = (id) => {
    if (loaded.has(id)) return;
    const deps = [...(BASE.includes(id) ? BASE.slice(0, BASE.indexOf(id)) : BASE), ...(REQ[id] || []), ...(OPT[id] || [])];
    for (const d of deps) load(d);
    new Function('Prism', fs.readFileSync(path.join(COMP, `prism-${id}.js`), 'utf8'))(Prism);
    loaded.add(id);
  };
  return { Prism, load };
}

// ---- structure snapshot (everything loaded, production order)
function serialize(languages, skip) {
  const seen = new Map();
  const walk = (v, p) => {
    if (v instanceof RegExp) return { $re: v.source, flags: v.flags };
    if (v === undefined) return { $undefined: true };
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (seen.has(v)) return { $ref: seen.get(v) };
    seen.set(v, p);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    const o = {};
    for (const k of Object.keys(v)) { if (skip && skip(k)) continue; const w = walk(v[k], `${p}.${k}`); if (w !== undefined) o[k] = w; }
    return o;
  };
  return walk(languages, '$');
}
{
  const { Prism, load } = freshPrism();
  for (const id of ORDER) load(id);
  const top = new Set(['plain','plaintext','text','txt','extend','insertBefore','DFS']);
  const snap = serialize(Prism.languages, null);
  for (const k of top) delete snap[k];
  fs.writeFileSync(path.join(OUT, 'grammar-structure.json'), JSON.stringify(snap));
  console.log('structure keys', Object.keys(snap).length);
}

// ---- golden HTML corpus
const LANG_MAP = { javascript:'javascript', typescript:'typescript', python:'python', java:'java', c:'c', cpp:'cpp', csharp:'csharp', go:'go', rust:'rust', ruby:'ruby', php:'php', swift:'swift', kotlin:'kotlin', sql:'sql', html:'markup', css:'css', json:'json', yaml:'yaml', markdown:'markdown', bash:'bash', shell:'bash', dockerfile:'docker', xml:'markup', graphql:'graphql', r:'r', scala:'scala', dart:'dart', lua:'lua', latex:'latex' };
const corpus = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); // [{lang, source, code}]
const cases = corpus.map(({ lang, source, code }) => {
  const g = LANG_MAP[lang];
  const { Prism, load } = freshPrism();
  load(g); load('javascript'); // a base grammar is only complete with the whole base
  return { lang, source, code, html: Prism.highlight(code, Prism.languages[g], g) };
});
fs.writeFileSync(path.join(OUT, 'golden-html.json'), JSON.stringify(cases, null, 0).replace(/\},\{/g, '},\n{'));
console.log('golden cases', cases.length, 'bytes', fs.statSync(path.join(OUT, 'golden-html.json')).size);
