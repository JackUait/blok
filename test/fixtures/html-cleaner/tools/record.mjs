#!/usr/bin/env node
// Records golden.json.gz: what html-janitor 2.0.4 returns for every corpus input.
// Run from the repo root: node --max-old-space-size=4096 test/fixtures/html-cleaner/tools/record.mjs
// Needs html-janitor@2.0.4, jsdom and esbuild in node_modules. Once html-janitor
// is gone from package.json, install it first (`yarn add -D html-janitor@2.0.4`),
// record, then remove it again (keep package.json and yarn.lock unchanged).
// Output depends on jsdom (style rules go through its CSSStyleDeclaration) and
// on Node (thrown messages come from V8); both versions are stored in `meta`.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '..');
const ROOT = resolve(FIXTURE, '../../..');
const req = createRequire(join(ROOT, 'package.json'));

const SEED = 0x6a616e69;
const FUZZ_COUNT = 15000;

/* ---------- configs.ts, bundled in memory ---------- */
const bundle = req('esbuild').buildSync({
  entryPoints: [join(FIXTURE, 'configs.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});
const { GOLDEN_CONFIGS, GOLDEN_ODD_CONFIGS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

/* ---------- engine ---------- */
const { JSDOM } = req('jsdom');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// html-janitor reads these globals when clean() runs.
Object.assign(globalThis, { window, document: window.document, Node: window.Node, NodeFilter: window.NodeFilter });
if (typeof globalThis.define !== 'undefined') throw new Error('a global define would hijack the UMD loader');
const HTMLJanitor = req('html-janitor/src/html-janitor.js');

const tagsFor = (key) => {
  if (Object.hasOwn(GOLDEN_CONFIGS, key)) return GOLDEN_CONFIGS[key];
  if (Object.hasOwn(GOLDEN_ODD_CONFIGS, key)) return GOLDEN_ODD_CONFIGS[key];
  throw new Error(`unknown config ${key}`);
};

const run = (config, input, options) => {
  try {
    return { output: new HTMLJanitor({ tags: tagsFor(config), ...options }).clean(input) };
  } catch (error) {
    return { throws: `${error.constructor.name}: ${error.message}` };
  }
};

/* ---------- hazards ---------- */
// One inert document for every parse: a fresh jsdom document per call made the run slow down as it went.
const parseDoc = window.document.implementation.createHTMLDocument('');
const parse = (html) => {
  const root = parseDoc.createElement('div');
  root.innerHTML = html;
  return root;
};
// Only an HTML <template> has .content; a <template> inside <svg> or <math> does not.
const isHtmlTemplate = (el) => el.localName === 'template' && el.content !== undefined;
// Includes elements inside <template> content, nested templates too.
const elementsOf = (root) => {
  const out = [];
  const visit = (scope) => {
    for (const el of scope.querySelectorAll('*')) {
      out.push(el);
      if (isHtmlTemplate(el)) visit(el.content);
    }
  };
  visit(root);
  return out;
};
const textOf = (root) => elementsOf(root).filter(isHtmlTemplate)
  .reduce((text, tpl) => text + tpl.content.textContent, root.textContent);

const hazardsOf = (input, result) => {
  if ('throws' in result) return ['throws'];
  const tags = [];
  const out = parse(result.output);
  const outEls = elementsOf(out);
  if (outEls.some((el) => Array.from(el.attributes).some((a) => a.name.toLowerCase().startsWith('on')))) tags.push('on-handler');
  // The string test catches attributes on tags a reparse drops (a lone <td> outside a table).
  if (outEls.some((el) => el.localName === 'constructor'
    || Array.from(el.attributes).some((a) => a.name === 'constructor' || a.name === '__proto__'))
    || /\s(constructor|__proto__)=/.test(result.output)) tags.push('proto-key');
  if (outEls.some((el) => isHtmlTemplate(el) && el.content.childNodes.length > 0)) tags.push('template-content');
  // Input-based: the old engine keeps whatever sits inside a foreign script/style
  // (text or child elements), so any output there may differ on purpose.
  const hasForeignRawText = elementsOf(parse(input))
    .filter((el) => el.localName === 'svg' || el.localName === 'math')
    .some((el) => el.querySelector('script, style') !== null);
  if (hasForeignRawText) tags.push('foreign-script-text');
  // Input-based: a <form> whose controls (name or id) shadow one of its members.
  // jsdom does not shadow them, browsers do; the new engine drops such forms whole.
  const isClobberingForm = (form) => Array.from(form.querySelectorAll('[name], [id]'))
    .some((control) => [control.getAttribute('name'), control.getAttribute('id')]
      .some((name) => name !== null && name in Object.getPrototypeOf(form)));
  if (elementsOf(parse(input)).some((el) => el.localName === 'form' && isClobberingForm(el))) tags.push('clobbering-form');
  return tags;
};

/* ---------- seeded fuzz ---------- */
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

const BLOCK = ['P', 'LI', 'TD', 'TH', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
const INLINE = ['A', 'B', 'STRONG', 'I', 'EM', 'SUB', 'SUP', 'U', 'STRIKE'];
const OTHER = ['span', 'mark', 'code', 's', 'del', 'ul', 'ol', 'table', 'tr', 'blockquote', 'img', 'br', 'font', 'figure',
  'aside', 'script', 'style', 'template', 'noscript', 'svg', 'math', 'constructor', 'custom-x', 'input', 'hr', 'details'];
const VOID = new Set(['img', 'br', 'input', 'hr']);
const RAW_TEXT = new Set(['script', 'style']);
const WORDS = ['a', 'Hello', 'world', 'x y', '1 < 2', 'Tom & Jerry', '"q"', "it's", 'ünï', '😀', 'E=mc^2'];
const ENTITIES = ['&amp;', '&lt;', '&gt;', '&nbsp;', '&quot;', '&#39;', '&#x1F600;', '&copy;', '&foo;', '&lt;script&gt;'];
const WHITESPACE = [' ', '\n', ' ', '  \n  ', '\t'];
const ATTRS = [
  ['class', ['keep', 'x y', '']],
  ['style', ['color: red', 'background-color: #fff', 'font-weight:700; color: rgb(1, 2, 3)', 'color: #f00; font-size: 20px', 'background-color: transparent', 'background-color: rgb(25,25,24)']],
  ['href', ['http://example.com/a?b=1&c=2', 'javascript:alert(1)', 'mailto:a@b.c', '/relative', '#frag', 'JaVaScRiPt:x']],
  ['onclick', ['alert(1)']],
  ['onerror', ['alert(2)']],
  ['data-x', ['1', 'y']],
  ['target', ['_blank', '_self']],
  ['rel', ['nofollow', 'noopener']],
  ['colspan', ['2', 'x']],
  ['id', ['h']],
  ['title', ['t', 'a "b"']],
  ['constructor', ['1']],
  ['__proto__', ['1']],
  ['data-latex', ['E=mc^2', 'x']],
  ['data-blok-page-id', ['pg1', '']],
  ['aria-level', ['2']],
  ['data-list-style', ['ordered']],
  ['type', ['checkbox', 'text']],
  ['checked', ['']],
  ['src', ['https://i.example/x.png', 'javascript:alert(1)']],
  ['alt', ['pic']],
  ['width', ['10']],
  ['height', ['9', '11']],
];

const attrString = (noAttrs) => {
  if (noAttrs || rand() < 0.45) return '';
  const used = new Set();
  let out = '';
  for (let n = int(1, 3); n > 0; n -= 1) {
    const [name, values] = pick(ATTRS);
    if (used.has(name)) continue;
    used.add(name);
    out += rand() < 0.1 ? ` ${name}` : ` ${name}="${pick(values).replace(/"/g, '&quot;')}"`;
  }
  return out;
};

const leaf = () => {
  const r = rand();
  if (r < 0.4) return pick(WORDS);
  if (r < 0.6) return pick(WHITESPACE);
  if (r < 0.75) return pick(ENTITIES);
  if (r < 0.88) return pick(['<!-- c -->', '<!---->', '<!-- <b>x</b> -->']);
  return `${pick(WORDS)}${pick(ENTITIES)}`;
};

const removableRun = () => {
  const items = [];
  for (let n = int(50, 300); n > 0; n -= 1) {
    items.push(pick(['<!-- r -->', '<x-junk>j</x-junk>', '<unknown-tag></unknown-tag>', ' ', '<aside></aside>', '<p></p> ']));
  }
  return items.join('');
};

const element = (depth, state) => {
  const r = rand();
  const raw = r < 0.35 ? pick(BLOCK) : r < 0.65 ? pick(INLINE) : pick(OTHER);
  const tag = rand() < 0.5 ? raw.toLowerCase() : raw.toUpperCase();
  const name = tag.toLowerCase();
  const open = `<${tag}${attrString(state.noAttrs)}>`;
  if (VOID.has(name)) return open;
  let inner;
  if (RAW_TEXT.has(name)) inner = pick(['alert(1)', '.x{color:red}', '</b>x', '']);
  else if (name === 'svg' || name === 'math') {
    inner = pick(['<script>alert("svg")</script>', '<style>.s{}</style>', '<title>t</title>', '<mi>x</mi>', '<foreignObject><p>f</p></foreignObject>'])
      + (depth < 5 && rand() < 0.5 ? children(depth + 1, state) : '');
  } else inner = depth >= 5 ? leaf() : children(depth + 1, state);
  return `${open}${inner}</${tag}>`;
};

const children = (depth, state) => {
  let out = '';
  const count = int(0, 6);
  const runAt = !state.runUsed && state.wantRun && (depth >= state.runDepth || count === 0) ? int(0, count) : -1;
  for (let i = 0; i <= count; i += 1) {
    if (i === runAt) {
      state.runUsed = true;
      out += removableRun();
    }
    if (i === count) break;
    if (depth < 5 && state.budget > 0 && rand() < 0.55) {
      state.budget -= 1;
      out += element(depth, state);
    } else out += leaf();
  }
  return out;
};

const fuzzInput = (noAttrs) => {
  // The budget caps elements per input: each removal restarts its parent, so cost grows with the square of a sibling list.
  const state = { noAttrs, wantRun: rand() < 0.05, runDepth: int(0, 3), runUsed: false, budget: int(1, 40) };
  return children(0, state);
};

/* ---------- corpus ---------- */
const sources = JSON.parse(gunzipSync(readFileSync(join(HERE, 'sources.json.gz'))).toString('utf8'));
const entries = [];
const add = (source, id, config, input, options) => {
  const result = run(config, input, options);
  const hazards = hazardsOf(input, result);
  entries.push({ id, source, config, ...(options ? { options } : {}), input, ...result, ...(hazards.length ? { hazard: hazards } : {}) });
  return result;
};

const mismatches = [];
for (const c of sources.upstream) {
  const result = add('upstream', `upstream:${c.id}`, c.config, c.input, c.options);
  const expected = 'threw' in c ? { throws: `Error: ${c.threw}` } : { output: c.actual };
  if (JSON.stringify(result) !== JSON.stringify(expected)) mismatches.push(`upstream:${c.id}`);
}
sources.probes.forEach((p, i) => {
  const result = add('probe', `probe:${String(i + 1).padStart(2, '0')}`, p.config, p.input, p.options);
  const same = 'threw' in p ? result.throws === p.threw : result.output === p.output;
  if (!same) mismatches.push(`probe:${i + 1} ${p.name}`);
});
if (mismatches.length) throw new Error(`harness disagrees with the earlier harvest: ${mismatches.join(', ')}`);

const PURIFY_CONFIGS = ['blok:empty', 'blok:inline-text', 'blok:pasted-cell', 'blok:paste-first-pass', 'syn:true-heavy'];
for (const p of sources.purify) for (const config of PURIFY_CONFIGS) add('purify', `purify:${p.id}:${config}`, config, p.payload);

const REALISTIC_CONFIGS = ['blok:inline-text-saved', 'blok:paragraph-text-saved', 'blok:pasted-cell', 'blok:paste-first-pass', 'blok:paste-handler-table'];
sources.realistic.forEach((r, i) => {
  for (const config of REALISTIC_CONFIGS) add(`realistic:${r.source}`, `realistic:${i}:${config}`, config, r.html);
});

const FUZZ_CONFIGS = [...Object.keys(GOLDEN_CONFIGS).filter((key) => key.startsWith('blok:') || key.startsWith('syn:')), 'upstream:spec'];
for (let i = 0; i < FUZZ_COUNT; i += 1) {
  const config = FUZZ_CONFIGS[i % FUZZ_CONFIGS.length];
  const noAttrs = config === 'syn:function-null' && rand() < 0.5;
  add('fuzz', `fuzz:${i}`, config, fuzzInput(noAttrs));
}

/* ---------- write ---------- */
const golden = {
  meta: {
    library: `html-janitor@${req('html-janitor/package.json').version}`,
    jsdom: req('jsdom/package.json').version,
    node: process.version,
    seed: SEED,
    call: 'new HTMLJanitor({ tags: GOLDEN_CONFIGS[config] ?? GOLDEN_ODD_CONFIGS[config], ...options }).clean(input)',
  },
  entries,
};
writeFileSync(join(FIXTURE, 'golden.json.gz'), gzipSync(JSON.stringify(golden), { level: 9 }));

const count = (key) => entries.reduce((acc, e) => {
  const values = key === 'hazard' ? e.hazard ?? [] : [key === 'source' ? e.source.split(':')[0] : e[key]];
  values.forEach((v) => { acc[v] = (acc[v] ?? 0) + 1; });
  return acc;
}, {});
console.log(JSON.stringify({ entries: entries.length, configs: Object.keys(GOLDEN_CONFIGS).length + Object.keys(GOLDEN_ODD_CONFIGS).length, bySource: count('source'), byHazard: count('hazard') }, null, 1));
