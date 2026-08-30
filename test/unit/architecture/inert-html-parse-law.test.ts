import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * LAW: untrusted markup is parsed into an INERT document.
 *
 * Assigning `innerHTML` on an element that belongs to the live document starts
 * the resource loads the markup asks for — `<img src=x onerror=…>` runs its
 * handler right there, before `clean()` has stripped anything. The paste
 * preprocessors all run BEFORE sanitization, so each one was such a sink.
 * `parseUntrustedHtml` parses into a document with no browsing context instead.
 *
 * `<template>` and `DOMParser` are already inert and stay allowed.
 */
const ROOT = resolve(__dirname, '../../..');

const GUARDED_FILES = [
  'src/components/dom.ts',
  'src/components/utils/inline-normalization.ts',
  'src/components/modules/paste/ai-chat-preprocessor.ts',
  'src/components/modules/paste/google-docs-preprocessor.ts',
  'src/components/modules/paste/notion-preprocessor.ts',
  'src/components/modules/paste/gfm-toggle-recovery.ts',
  'src/components/modules/paste/handlers/html-handler.ts',
];

const INNER_HTML_WRITE = /(\w+)\.innerHTML\s*=/g;
/** Elements minted against the LIVE document, which loads what it is given. */
const LIVE_ELEMENT = /(?:const|let|var)\s+(\w+)\s*=\s*(?:document\.createElement|dom\$\.make|Dom\.make)\(/g;
/**
 * `document.createRange()` anchors the range in the LIVE document, so the
 * fragment it parses loads too — same sink as a live `innerHTML` write.
 */
const LIVE_FRAGMENT_PARSE = /document\.createRange\(\)\s*\.createContextualFragment\(/g;
const ADJACENT_HTML = /\.insertAdjacentHTML\(/g;

describe('inert HTML parse law', () => {
  it.each(GUARDED_FILES)('%s never writes innerHTML on a live-document element', (relative) => {
    const source = readFileSync(resolve(ROOT, relative), 'utf-8');
    const liveElements = new Set(Array.from(source.matchAll(LIVE_ELEMENT)).map((match) => match[1]));
    const offenders = Array.from(source.matchAll(INNER_HTML_WRITE))
      .map((match) => match[1])
      .filter((receiver) => liveElements.has(receiver));

    expect(offenders).toEqual([]);
  });

  it.each(GUARDED_FILES)('%s never parses a fragment against the live document', (relative) => {
    const source = readFileSync(resolve(ROOT, relative), 'utf-8');

    expect(Array.from(source.matchAll(LIVE_FRAGMENT_PARSE))).toEqual([]);
    expect(Array.from(source.matchAll(ADJACENT_HTML))).toEqual([]);
  });

  it('routes every guarded file through the inert parser', () => {
    const missing = GUARDED_FILES.filter((relative) => {
      const source = readFileSync(resolve(ROOT, relative), 'utf-8');

      return !source.includes('parseUntrustedHtml');
    });

    expect(missing).toEqual([]);
  });
});
