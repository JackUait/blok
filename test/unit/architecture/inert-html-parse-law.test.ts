import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';

/**
 * LAW: untrusted markup is parsed into an INERT document.
 *
 * An element that belongs to the live document starts the resource loads its
 * markup asks for the moment it is filled — `<img src=x onerror=…>` runs its
 * handler right there, before `clean()` has stripped anything. Everything in
 * SCOPE handles clipboard HTML before sanitization, so every live parse in it
 * is a pre-sanitization sink. `parseUntrustedHtml` parses into a document with
 * no browsing context instead.
 *
 * `<template>` and `DOMParser` are inert and stay allowed.
 *
 * Scope is DIRECTORY-based on purpose: the first version of this law listed
 * exactly the files the fix had touched, so a brand-new paste preprocessor
 * could reintroduce the bug verbatim and stay green.
 */
const ROOT = resolve(__dirname, '../../..');

const SCOPE = [
  'src/components/modules/paste',
  'src/components/dom.ts',
  'src/components/utils/inline-normalization.ts',
  'src/components/utils/inert-html.ts',
  'src/tools/table/table-cell-clipboard.ts',
];

const collect = (target: string): string[] => {
  const absolute = resolve(ROOT, target);

  if (statSync(absolute).isFile()) {
    return [target];
  }

  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);

    if (statSync(child).isDirectory()) {
      return collect(relative(ROOT, child));
    }

    return child.endsWith('.ts') ? [relative(ROOT, child)] : [];
  });
};

const SCOPED_FILES = SCOPE.flatMap(collect).sort();

const INNER_HTML_WRITE = /(\w+)\.innerHTML\s*=[^=]/g;
/**
 * Receivers bound from the global `document` — including aliases such as
 * `document.querySelector(…)`, not just `createElement` — are live.
 */
const LIVE_RECEIVER = /(?:const|let|var)\s+(\w+)\s*=\s*(?:document\.|dom\$\.make|Dom\.make)/g;
/**
 * Sinks with no inert form. `document.createRange()` anchors the range in the
 * live document, so the fragment it parses loads too; `outerHTML`, `srcdoc`,
 * `insertAdjacentHTML` and `document.write` parse into a live tree by
 * definition. Take the range from the parsed node's own `ownerDocument`.
 */
const BANNED_SINKS: Array<[string, RegExp]> = [
  // No /g: `test()` on a global regex carries lastIndex between files and
  // would skip every other match.
  ['document.createRange()', /document\.createRange\(\)/],
  ['insertAdjacentHTML', /\.insertAdjacentHTML\(/],
  ['outerHTML assignment', /\.outerHTML\s*=[^=]/],
  ['srcdoc assignment', /\.srcdoc\s*=[^=]/],
  ['document.write', /document\.write(?:ln)?\(/],
];

describe('inert HTML parse law', () => {
  it('covers every file in scope', () => {
    expect(SCOPED_FILES.length).toBeGreaterThan(10);
    expect(SCOPED_FILES).toContain('src/tools/table/table-cell-clipboard.ts');
  });

  it.each(SCOPED_FILES)('%s never writes innerHTML on a live-document element', (relativePath) => {
    const source = readFileSync(resolve(ROOT, relativePath), 'utf-8');
    const liveReceivers = new Set(Array.from(source.matchAll(LIVE_RECEIVER)).map((match) => match[1]));
    const offenders = Array.from(source.matchAll(INNER_HTML_WRITE))
      .map((match) => match[1])
      .filter((receiver) => liveReceivers.has(receiver));

    expect(offenders).toEqual([]);
  });

  it.each(SCOPED_FILES)('%s uses no sink that parses into the live document', (relativePath) => {
    const source = readFileSync(resolve(ROOT, relativePath), 'utf-8');
    const offenders = BANNED_SINKS
      .filter(([, pattern]) => pattern.test(source))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });
});
