// @vitest-environment node
/**
 * parse5 8.0.1 throws a RangeError on some lone-surrogate input, and Blok's
 * call sites repair the field and parse again when it does. The own parser
 * throws on exactly the same input, so that path stays byte-identical. parse5
 * is the oracle here, for all three ways Blok calls it.
 */
import { parse, parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { describe, expect, it } from 'vitest';

import * as own from '../../../src/html';
import { fuzzHtml } from './corpus';

type Entry = 'fragment' | 'div' | 'document';

const DIV = parseFragment('<div></div>').childNodes[0] as DefaultTreeAdapterMap['element'];
const OWN_DIV = own.parseFragment('<div></div>').childNodes[0] as own.Element;

const ORACLE: Record<Entry, (html: string) => unknown> = {
  fragment: (html) => parseFragment(html),
  div: (html) => parseFragment(DIV, html, {}),
  document: (html) => parse(html),
};

const OWN: Record<Entry, (html: string) => unknown> = {
  fragment: (html) => own.parseFragment(html),
  div: (html) => own.parseFragment(OWN_DIV, html),
  document: (html) => own.parse(html),
};

const runThrows = (run: (html: string) => unknown, html: string): boolean => {
  try {
    run(html);

    return false;
  } catch (error) {
    if (error instanceof RangeError) {
      return true;
    }
    throw error;
  }
};

const throwsOn = (entry: Entry, html: string): boolean => runThrows(ORACLE[entry], html);

const ownThrows = (entry: Entry, html: string): boolean => runThrows(OWN[entry], html);

const ENTRIES = Object.keys(ORACLE) as Entry[];
const L = '\uDC00';
const H = '\uD800';
const LL = `${L}${L}`;

/** Each pins one way the tokenizer reaches, or skips, two low surrogates. */
const HAND_CASES = [
  '',
  'plain',
  `a${LL}b`,
  `a${L}b${L}`,
  `${H}${L}${L}`,
  `${H}${H}${L}${L}`,
  `${L}${H}${L}`,
  `${L}${L}${L}`,
  `${H}${LL}${L}`,
  `<a href="${LL}">x</a>`,
  `<a href='${LL}'>x</a>`,
  `<a href=${LL}>x</a>`,
  `<a ${LL}=1>x</a>`,
  `<${LL}>`,
  `<a${LL}>`,
  `</${LL}>`,
  `</a${LL}>`,
  `<!-- ${LL} -->`,
  `<!--${LL}`,
  `<!${LL}>`,
  `<?${LL}>`,
  `<![CDATA[${LL}]]>`,
  `<svg><![CDATA[${LL}]]></svg>`,
  `<svg><![CDATA[ > <!doctype x ${LL}> ]]></svg>`,
  `<![CDATA[ > <!doctype x ${LL}> ]]>`,
  `&${LL}`,
  `&amp${LL}`,
  `&#${LL}`,
  `<p title="&${LL}">`,
  `<!DOCTYPE${LL}>`,
  `<!DOCTYPE ${LL}>`,
  `<!DOCTYPE html${LL}>`,
  `<!DOCTYPE html ${LL}>`,
  `<!DOCTYPE html ${LL}`,
  `<!doctype html PUBLIC ${LL}>`,
  `<!doctype html PUBLIC "${LL}">`,
  `<!doctype html PUBLIC '${LL}'>`,
  `<!doctype html PUBLIC "x" ${LL}>`,
  `<!doctype html PUBLIC "x" "${LL}">`,
  `<!doctype html SYSTEM ${LL}>`,
  `<!doctype html SYSTEM "${LL}">`,
  `<!doctype html SYSTEM "x" ${LL}>`,
  `<!doctype html PUBLIC${LL}>`,
  `<!doctype html PUBLICx${LL}>`,
  `<!doctype html x ${LL} y "${LL}">`,
  `<!doctype html x> ${LL}`,
  `<style><!DOCTYPE x ${LL}></style>`,
  `<svg><style><!DOCTYPE x ${LL}></style></svg>`,
  `<svg><foreignObject><style><!DOCTYPE x ${LL}>`,
  `<svg><title><style><!DOCTYPE x ${LL}>`,
  `<svg><desc><textarea><!DOCTYPE x ${LL}>`,
  `<svg><plaintext><!DOCTYPE x ${LL}>`,
  `<svg><p><style><!DOCTYPE x ${LL}>`,
  `<svg><font color=red><style><!DOCTYPE x ${LL}>`,
  `<svg><font><style><!DOCTYPE x ${LL}>`,
  `<svg></svg><style><!DOCTYPE x ${LL}>`,
  `<math><mi><style><!DOCTYPE x ${LL}>`,
  `<math><mi><mglyph><style><!DOCTYPE x ${LL}>`,
  `<math><annotation-xml><style><!DOCTYPE x ${LL}>`,
  `<math><annotation-xml encoding="text/html"><style><!DOCTYPE x ${LL}>`,
  `<math><annotation-xml encoding="TEXT/HTML"><style><!DOCTYPE x ${LL}>`,
  `<math><annotation-xml><svg><style><!DOCTYPE x ${LL}>`,
  `<noscript><!DOCTYPE x ${LL}>`,
  `<noembed><!DOCTYPE x ${LL}>`,
  `<noframes><!DOCTYPE x ${LL}>`,
  `<iframe><!DOCTYPE x ${LL}>`,
  `<xmp><!DOCTYPE x ${LL}>`,
  `<title><!DOCTYPE x ${LL}>`,
  `<textarea><!DOCTYPE x ${LL}>`,
  `<plaintext><!DOCTYPE x ${LL}>`,
  `<script><!DOCTYPE x ${LL}></script>`,
  `<script><!--<script></script><!DOCTYPE x ${LL}>`,
  `<script><!--<script></script></script><!DOCTYPE x ${LL}>`,
  `<style></style><!DOCTYPE x ${LL}>`,
  `<style></styles><!DOCTYPE x ${LL}>`,
  `<!-- <!DOCTYPE x ${LL}> -->`,
  `<!-- --!><!DOCTYPE x ${LL}>`,
  `<a title="<!DOCTYPE x ${LL}>">`,
  `<select><style><!DOCTYPE x ${LL}>`,
  `<select><script><!DOCTYPE x ${LL}>`,
  `<select><textarea><!DOCTYPE x ${LL}>`,
  `<select></select><style><!DOCTYPE x ${LL}>`,
  `<table><select><style><!DOCTYPE x ${LL}>`,
  `<table><select><td><style><!DOCTYPE x ${LL}>`,
  `<frameset><style><!DOCTYPE x ${LL}>`,
  `<frameset><noframes><!DOCTYPE x ${LL}>`,
  `<p><frameset><style><!DOCTYPE x ${LL}>`,
  `x<frameset><style><!DOCTYPE x ${LL}>`,
  `<frameset></frameset><style><!DOCTYPE x ${LL}>`,
  `<template><style><!DOCTYPE x ${LL}>`,
  `<\r><!DOCTYPE x\r${LL}>`,
];

const random = (seed: number): (() => number) => {
  const state = { value: seed >>> 0 };

  return () => {
    state.value = (state.value + 0x6d2b79f5) >>> 0;
    const a = Math.imul(state.value ^ (state.value >>> 15), state.value | 1);
    const b = (a + Math.imul(a ^ (a >>> 7), a | 61)) ^ a;

    return ((b ^ (b >>> 14)) >>> 0) / 4294967296;
  };
};

const SURROGATES = [L, H, LL, `${H}${L}`, '\uDBFF', '\uDFFF', `${LL}${L}`, `${H}${H}`, `a${L}`, `${L}${H}${L}`];
const MARKUP = [
  '<!DOCTYPE', '<!doctype', '<!DoCtYpE ', ' ', 'html', ' PUBLIC', ' SYSTEM', 'PUBLIC', '"', "'", '>', ' x', '<!DOCTYPE html ',
  '<style>', '</style>', '<script>', '</script>', '<textarea>', '</textarea>', '<title>', '</title>', '<xmp>', '<iframe>',
  '<noscript>', '<noembed>', '<noframes>', '<plaintext>', '<svg>', '</svg>', '<math>', '</math>', '<mi>', '<mglyph>',
  '<annotation-xml encoding="text/html">', '<annotation-xml>', '<foreignObject>', '<desc>', '<font color=x>', '<font>',
  '<frameset>', '</frameset>', '<select>', '</select>', '<template>', '</template>', '<table>', '<td>', '<p>', '</p>',
  '<div>', '</div>', '<b>', '<br>', '<![CDATA[', ']]>', '<!--', '-->', '--!>', '&', '&#', '&#x', '&amp', '<!--<script>',
  '</', '<', '<a b="', '<a b=\'', '<a b=', '=', '<!', '<?', '/>', 'p', '\r', '\n', '\0', '<html>', '<body>', '<head>',
  '</html>', '</body>', '<input type=hidden>', '<option>',
];

/** Surrogates spliced into markup that changes tokenizer state, plus some of the shared fuzz. */
const surrogateHtml = (seed: number): string => {
  const next = random(seed);
  const pick = (list: readonly string[]): string => list[Math.floor(next() * list.length)];

  return Array.from({ length: 2 + Math.floor(next() * 24) }, (_, index) => {
    const roll = next();

    if (roll < 0.3) {
      return pick(SURROGATES);
    }

    return roll < 0.92 ? pick(MARKUP) : fuzzHtml(seed * 31 + index).slice(0, 48);
  }).join('');
};

/** Markup before a DOCTYPE that decides whether the tokenizer reads it as one. */
const CONTEXTS = [
  '<frameset>', '</frameset>', '<frame>', '<p>', '</p>', 'x', ' ', '<select>', '</select>', '<option>', '<input>',
  '<table>', '<td>', '<svg>', '</svg>', '<math>', '</math>', '<mi>', '<annotation-xml encoding="text/html">',
  '<annotation-xml>', '<foreignObject>', '<desc>', '<template>', '</template>', '<head>', '<body>', '</body>', '<html>',
  '</html>', '<style>', '</style>', '<textarea>', '</textarea>', '<noframes>', '</noframes>', '<script>', '</script>',
  '<!--<script>', '<!--', '-->', '<div>', '</div>', '<li>', '</li>', '<h1>', '</h2>', '<b>', '</b>', '<font size=1>',
  '<font>', '<br>', '</br>', '<plaintext>', '<title>', '<xmp>', '<noscript>', '<![CDATA[', ']]>', '<a href="', '">',
];

/** A DOCTYPE with two low surrogates somewhere inside, after markup that may hide it. */
const doctypeHtml = (seed: number): string => {
  const next = random(seed);
  const pick = (list: readonly string[]): string => list[Math.floor(next() * list.length)];
  const prefix = Array.from({ length: Math.floor(next() * 6) }, () => pick(CONTEXTS)).join('');
  const parts = [
    pick(['<!DOCTYPE', '<!doctype']), pick(['', ' ']), pick(['html', 'x', LL, '']), pick([' ', '', '\t']),
    pick(['', 'PUBLIC', 'SYSTEM', 'junk', LL]), pick([' ', '']), pick(['"', "'", '']), pick([LL, 'id', '']),
    pick(['"', "'", '']), pick([' ', '']), pick([LL, '', 'tail', '"x"']), pick(['>', '>', '']),
  ];
  const doctype = parts.join('');
  const suffix = Array.from({ length: Math.floor(next() * 4) }, () => pick([...SURROGATES, ...MARKUP])).join('');

  return `${prefix}${doctype.includes(LL) ? doctype : `${doctype}${LL}`}${suffix}`;
};

const SOUP_TAGS = [
  'a', 'b', 'i', 'em', 'nobr', 'font', 'p', 'div', 'li', 'ul', 'ol', 'dd', 'dt', 'h1', 'h2', 'form', 'table', 'tbody', 'tr',
  'td', 'th', 'caption', 'col', 'colgroup', 'select', 'option', 'optgroup', 'input', 'keygen', 'textarea', 'svg', 'math',
  'mi', 'mo', 'mtext', 'annotation-xml', 'foreignObject', 'desc', 'title', 'g', 'template', 'frameset', 'frame', 'body',
  'head', 'html', 'button', 'object', 'applet', 'marquee', 'pre', 'listing', 'span', 'br', 'hr', 'img', 'image', 'iframe',
  'xmp', 'noembed', 'noframes', 'noscript', 'style', 'script', 'plaintext', 'address', 'section', 'center', 'dl', 'menu',
  'summary', 'details', 'ruby', 'rt', 'rp', 'rb', 'mglyph', 'malignmark', 'x', 'nav',
];
const SOUP_ATTRS = ['', '', '', ' color=red', ' encoding="text/html"', ' encoding="application/xhtml+xml"', ' type=hidden', ' face=x', ' size=2'];
const PROBES = ['<style>', '', '<noframes>', '<textarea>', '<script>', '<![CDATA[ > ', '<title>', '<plaintext>', '<noscript>']
  .map((open) => `${open}<!DOCTYPE x ${LL}>`);

/** Tag soup that drives the tree builder's modes, then a DOCTYPE behind a tag that may switch the tokenizer. */
const soupHtml = (seed: number): string => {
  const next = random(seed);
  const pick = (list: readonly string[]): string => list[Math.floor(next() * list.length)];
  const tokens = Array.from({ length: 1 + Math.floor(next() * 10) }, () => {
    const tag = pick(SOUP_TAGS);
    const roll = next();

    if (roll < 0.62) {
      return `<${tag}${pick(SOUP_ATTRS)}${next() < 0.1 ? '/' : ''}>`;
    }

    return roll < 0.92 ? `</${tag}>` : pick(['x', ' ', '<!--c-->', '&amp;']);
  });

  return `${tokens.join('')}${pick(PROBES)}`;
};

const GENERATORS = [surrogateHtml, doctypeHtml, soupHtml];

/** Found by soup fuzz: the tree builder decides here whether the tokenizer reads a DOCTYPE at all. */
const TREE_BUILDER_CORNERS = [
  `<svg encoding="application/xhtml+xml"></option><object encoding="application/xhtml+xml"><optgroup color=red><noembed encoding="application/xhtml+xml"><foreignObject><nobr face=x></foreignObject><mo><script><!DOCTYPE x ${LL}>`,
  `<colgroup></span></font><svg></colgroup><script><!DOCTYPE x ${LL}>`,
  `<colgroup><math encoding="text/html"><option encoding="application/xhtml+xml"></xmp></colgroup><textarea color=red/><th size=2><frame encoding="application/xhtml+xml"><plaintext><!DOCTYPE x ${LL}>`,
];

const FUZZ_INPUTS = 120_000;

describe('the own parser throws on lone surrogates exactly where parse5 does', () => {
  it.each([...HAND_CASES, ...TREE_BUILDER_CORNERS].map((html) => [JSON.stringify(html), html]))('matches parse5 on %s', (_, html) => {
    expect(ENTRIES.map((entry) => ownThrows(entry, html))).toEqual(ENTRIES.map((entry) => throwsOn(entry, html)));
  });

  it(`matches parse5 on ${FUZZ_INPUTS} surrogate-heavy inputs`, () => {
    const tally = { throws: 0, lowRunsRead: 0, entriesDisagree: 0 };
    const mismatches: Array<{ html: string; entry: Entry; parse5: boolean }> = [];

    Array.from({ length: FUZZ_INPUTS }, (_, seed) => GENERATORS[seed % GENERATORS.length](seed)).forEach((html) => {
      const verdicts = ENTRIES.map((entry) => throwsOn(entry, html));

      tally.throws += Number(verdicts[0]);
      tally.entriesDisagree += Number(new Set(verdicts).size > 1);
      // Two lows in a row parse5 still reads: paired after a high, or skipped inside a doctype.
      tally.lowRunsRead += Number(/[\uDC00-\uDFFF]{2}/.test(html) && !verdicts[0]);
      ENTRIES.forEach((entry, index) => {
        if (ownThrows(entry, html) !== verdicts[index]) {
          mismatches.push({ html: JSON.stringify(html), entry, parse5: verdicts[index] });
        }
      });
    });

    expect({ count: mismatches.length, first: mismatches.slice(0, 5) }).toEqual({ count: 0, first: [] });
    // The fuzz has to reach the hard cases, or agreeing on it proves little.
    expect(tally.throws).toBeGreaterThan(FUZZ_INPUTS / 4);
    expect(tally.lowRunsRead).toBeGreaterThan(5_000);
    expect(tally.entriesDisagree).toBeGreaterThan(20);
  }, 600_000);
});
