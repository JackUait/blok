/**
 * Blok's HTML parser: parse5's results, without the DOM and without parse5.
 */
import { Parser } from './parser';
import type { Document, DocumentFragment, Element } from './tree';

/** Parses a whole document, as parse5's `parse` does with its default options. */
export const parse = (html: string): Document => Parser.parse(html);

/**
 * Parses a fragment. Without a context element it parses inside a `<template>`,
 * as parse5's `parseFragment` does.
 */
export function parseFragment(html: string): DocumentFragment;
export function parseFragment(context: Element, html: string): DocumentFragment;
export function parseFragment(contextOrHtml: Element | string, html?: string): DocumentFragment {
  const context = typeof contextOrHtml === 'string' ? null : contextOrHtml;
  const parser = Parser.getFragmentParser(context);

  parser.tokenizer.write(typeof contextOrHtml === 'string' ? contextOrHtml : html ?? '');

  return parser.getFragment();
}

export * from './tree';
export { NS, DOCUMENT_MODE, TAG_ID, getTagID } from './tags';
export type { Attribute } from './token';
export { serialize, serializeOuter } from './serializer';
