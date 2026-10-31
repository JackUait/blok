/**
 * Inputs for differential tests of src/html against parse5: real documents,
 * the html5lib inputs, rich fields from the repo's stored documents, and a
 * seeded grammar fuzz that leans on the inputs parsers get wrong.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = join(__dirname, '..', '..', '..');
const HTML5LIB = join(ROOT, 'test', 'fixtures', 'html5lib');

const listFiles = (dir: string, suffix: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return listFiles(path, suffix);
    }

    return entry.name.endsWith(suffix) ? [path] : [];
  });

/** Whole pages: pasted AI chats, a Notion clipboard, metadata pages, parse5's huge page. */
export const realDocuments = (): Array<{ name: string; html: string }> => [
  ...[join(ROOT, 'test', 'fixtures'), join(ROOT, 'test', 'unit', 'server-conformance', 'fixtures')]
    .flatMap((dir) => listFiles(dir, '.html'))
    .map((path) => ({ name: path.slice(ROOT.length + 1), html: readFileSync(path, 'utf8') })),
  { name: 'parse5 huge-page', html: gunzipSync(readFileSync(join(HTML5LIB, 'huge-page.html.gz'))).toString('utf8') },
];

/** Every `#data` input of the tree-construction suites. */
export const treeConstructionInputs = (): string[] =>
  ['tree-construction', 'tree-construction-fork'].flatMap((dir) =>
    listFiles(join(HTML5LIB, dir), '.dat').flatMap((path) =>
      readFileSync(path, 'utf8')
        .split(/^#data\n/m)
        .slice(1)
        .map((test) => test.slice(0, test.search(/^#errors/m)).replace(/\n$/, ''))
    )
  );

const collectStrings = (value: unknown, out: string[]): void => {
  if (typeof value === 'string') {
    out.push(value);

    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child) => collectStrings(child, out));
  }
};

/** String values holding markup or a reference, from the stored documents in the repo. */
export const storedFields = (): string[] => {
  const files = [
    join(ROOT, 'playground-document.json'),
    join(ROOT, 'playground-pages.json'),
    // unfurl-html.json holds a 10,000-deep nesting case for the unfurl scanner,
    // which overflows the recursive tree walks in these tests.
    ...listFiles(join(ROOT, 'test', 'unit', 'server-conformance', 'fixtures'), '.json')
      .filter((file) => !file.endsWith('unfurl-html.json')),
    ...listFiles(join(ROOT, 'test', 'fixtures', 'notion'), '.json'),
  ];
  const out: string[] = [];

  files.forEach((path) => collectStrings(JSON.parse(readFileSync(path, 'utf8')), out));

  return [...new Set(out.filter((text) => /[<&\r\0]/.test(text)))];
};

/** mulberry32: small, seeded, the same sequence on every run. */
const random = (seed: number): (() => number) => {
  const state = { value: seed >>> 0 };

  return () => {
    state.value = (state.value + 0x6d2b79f5) >>> 0;
    const a = Math.imul(state.value ^ (state.value >>> 15), state.value | 1);
    const b = (a + Math.imul(a ^ (a >>> 7), a | 61)) ^ a;

    return ((b ^ (b >>> 14)) >>> 0) / 4294967296;
  };
};

const TAGS = [
  'b', 'i', 'u', 's', 'a', 'span', 'code', 'mark', 'sup', 'sub', 'strong', 'em', 'p', 'div', 'br', 'img',
  'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'tbody', 'caption', 'h1', 'pre', 'blockquote', 'template',
  'svg', 'math', 'foreignObject', 'mi', 'desc', 'title', 'textarea', 'style', 'script', 'noscript', 'xmp',
  'iframe', 'plaintext', 'select', 'option', 'form', 'button', 'nobr', 'font', 'frameset', 'head', 'body',
  'html', 'x-custom', 'annotation-xml',
];
const ATTRS = ['href', 'style', 'class', 'data-blok-x', 'title', 'onclick', 'xlink:href', 'definitionURL', 'src', 'encoding'];
const TEXT = [
  'text', ' ', '\n', '\t', '\r\n', '\r', '\0', '&amp;', '&amp', '&ampx', '&notit;', '&#x41;', '&#0;', '&#128;',
  '&#x110000;', '&lt;', '&nbsp', '&', '<', '>', '"', "'", '=', ' ', '😀', '\ud800', '\udc00', '\udc00\udc00',
  '<!-- c -->', '<!--', '-->', '<![CDATA[x]]>', '<!DOCTYPE html>', '</', '<?php ?>', '</p>', '</b>', '</td>',
  '</svg>', '</textarea>', '</style>', '</script>', '<!--<script>', ' ',
];

/** One random fragment. Weighted toward markup a parser has to repair. */
export const fuzzHtml = (seed: number): string => {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const attr = (): string => {
    const quote = pick(['"', "'", '']);
    const value = Array.from({ length: Math.floor(next() * 3) }, () => pick(TEXT)).join('');

    const name = next() < 0.15 ? pick(ATTRS).toUpperCase() : pick(ATTRS);

    return next() < 0.2 ? ` ${name}` : ` ${name}=${quote}${quote === '' ? value.replace(/[\s>]/g, '') : value.replaceAll(quote, '')}${quote}`;
  };
  // Mostly none or one; sometimes past the tokenizer's 16-attribute dedupe threshold, with repeats.
  const attrs = (): string => {
    const roll = next();
    const many = roll < 0.85 ? 1 : Math.floor(next() * 20);
    const count = roll < 0.5 ? 0 : many;

    return Array.from({ length: count }, attr).join('');
  };
  const endTag = (tag: string): string =>
    `</${next() < 0.2 ? tag.toUpperCase() : tag}${pick(['', '', '', ' ', '\n', '\t', ' x=1', '/'])}>`;
  const node = (depth: number): string => {
    const roll = next();

    if (depth > 4 || roll < 0.45) {
      return pick(TEXT);
    }
    const tag = pick(TAGS);
    const open = `<${next() < 0.1 ? tag.toUpperCase() : tag}${attrs()}${next() < 0.05 ? '/' : ''}>`;
    const children = Array.from({ length: Math.floor(next() * 4) }, () => node(depth + 1)).join('');
    const close = next() < 0.75 ? endTag(tag) : '';

    return open + children + close;
  };

  return Array.from({ length: 1 + Math.floor(next() * 5) }, () => node(0)).join('');
};
