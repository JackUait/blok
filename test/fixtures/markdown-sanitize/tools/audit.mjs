// Safety audit of golden.json.gz. Reparses every output in jsdom and lists
// anything a safe sanitizer must never emit. Any line it prints is a bug in
// the sanitizer that recorded the golden.
// Usage: node tools/audit.mjs [golden-file]
import path from 'node:path';
import { FIXTURE_DIR, README_BASE, bundle, installDom, readGz } from './lib.mjs';

// Frozen copy of the DOMPurify-era allowlist in src/markdown/sanitize-html.ts,
// so the audit keeps its meaning after that file is rewritten.
const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'a', 'img', 'picture', 'source',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'abbr',
  'code', 'pre', 'kbd', 'samp', 'br', 'hr', 'sub', 'sup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'figure', 'figcaption', 'details', 'summary',
]);
const ALLOWED_ATTR = new Set([
  'href', 'src', 'alt', 'title', 'align', 'width', 'height',
  'colspan', 'rowspan', 'start', 'open',
]);
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const BAD_SCHEME = /^(javascript|vbscript):|^data:text/;

const window = installDom();
// The sanitizer in src/ today; after the rewrite this checks the new one.
const { sanitizeBlockHtml } = await bundle("export { sanitizeBlockHtml } from './src/markdown/sanitize-html';");
const { cases } = readGz(process.argv[2] ?? path.join(FIXTURE_DIR, 'golden.json.gz'));

// Browsers drop ASCII whitespace and C0 controls anywhere in a URL scheme.
const schemeOf = (value) => value.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();

const violations = [];
const notes = {};

const audit = (row, field, html) => {
  const report = (rule, detail) => violations.push({ id: row.id, kind: row.kind, field, rule, detail, input: row.input, output: html });
  const template = window.document.createElement('template');

  template.innerHTML = html;
  if (template.innerHTML !== html) {
    report('reparse', template.innerHTML);
  }

  for (const el of template.content.querySelectorAll('*')) {
    const tag = el.localName;

    if (el.namespaceURI !== HTML_NS || !ALLOWED_TAGS.has(tag)) {
      report('tag', `${el.namespaceURI} ${tag}`);
    }
    for (const { name, value } of [...el.attributes]) {
      if (name.startsWith('on')) {
        report('on-attr', `${tag} ${name}`);
      } else if (name === 'style') {
        report('style', tag);
      } else if (name.startsWith('data-')) {
        report('data-attr', `${tag} ${name}`);
      } else if (!ALLOWED_ATTR.has(name) && !(tag === 'a' && (name === 'target' || name === 'rel'))) {
        const key = name.startsWith('aria-') ? 'aria-*' : name;

        notes[key] = (notes[key] ?? 0) + 1;
      }
      if (['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href'].includes(name) && BAD_SCHEME.test(schemeOf(value))) {
        report('url', `${tag} ${name}=${value}`);
      }
    }
    if (tag === 'a' && el.hasAttribute('href')) {
      if (el.getAttribute('target') !== '_blank' || el.getAttribute('rel') !== 'noopener noreferrer nofollow') {
        report('anchor', el.outerHTML.slice(0, 200));
      }
    }
  }
};

for (const row of cases) {
  audit(row, 'output', row.output);
  audit(row, 'outputWithBase', row.outputWithBase);

  const again = await sanitizeBlockHtml(row.output);
  const againWithBase = await sanitizeBlockHtml(row.outputWithBase, README_BASE);

  if (again !== row.output) {
    violations.push({ id: row.id, kind: row.kind, field: 'output', rule: 'unstable', detail: again, input: row.input, output: row.output });
  }
  if (againWithBase !== row.outputWithBase) {
    violations.push({ id: row.id, kind: row.kind, field: 'outputWithBase', rule: 'unstable', detail: againWithBase, input: row.input, output: row.outputWithBase });
  }
}

console.log(JSON.stringify({ cases: cases.length, violations: violations.length, attributesOutsideAllowlist: notes }, null, 1));
for (const v of violations) {
  console.log(JSON.stringify(v));
}
process.exitCode = violations.length === 0 ? 0 : 1;
