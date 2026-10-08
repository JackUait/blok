import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clean } from '../../../../src/components/utils/sanitizer';
import { preserveColorStyles } from '../../../../src/shared/inline-text-sanitize';
import { preservePageReferenceAnchor } from '../../../../src/shared/page-reference';
import { BUILT_IN_INLINE_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/inline';
import {
  Bold, ClearFormat, Equation, InlineCode, Italic, Link, Marker, Strikethrough, SupSub, Underline,
} from '../../../../src/tools';

import type { SanitizerConfig } from '../../../../types';

const GET_CONFIG: Record<string, () => SanitizerConfig> = {
  marker: () => Marker.sanitize,
  bold: () => Bold.sanitize,
  italic: () => Italic.sanitize,
  underline: () => Underline.sanitize,
  clearFormat: () => ClearFormat.sanitize,
  link: () => Link.sanitize,
  strikethrough: () => Strikethrough.sanitize,
  inlineCode: () => InlineCode.sanitize,
  equation: () => Equation.sanitize,
  supSub: () => SupSub.sanitize,
};

const CASES: Array<[string, string]> = [
  ['all marks and aliases', '<b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u><s>s</s><del>d</del><strike>t</strike><code>c</code><sup>1</sup><sub>2</sub><mark style="color: red; font-size: 3px">m</mark><a href="https://x.y">l</a><span data-latex="x^2" class="cache">x2</span>'],
  ['color without background', '<mark style="color: red; position: fixed; font-size: 3px">m</mark>'],
  ['transparent background', '<mark style="background-color: transparent">m</mark>'],
  ['near white background', '<mark style="background-color: rgb(252, 252, 250)">m</mark>'],
  ['dark page background', '<mark style="background-color: rgb(25, 25, 24)">m</mark>'],
  ['visible pale gray highlight', '<mark style="background-color: rgb(241, 241, 239)">m</mark>'],
  ['color with invisible background', '<mark style="color: blue; background-color: white">m</mark>'],
  ['plain link preserves target and rel', '<a href="https://x.y" target="_self" rel="author" onclick="x()">l</a>'],
  ['page reference drops cached title', '<a href="/p/1" data-blok-page-id="p1" class="cached">Cached title</a>'],
  ['equation keeps source attribute', '<span data-latex="x^2" class="katex" style="color: red"><i>rendered cache</i></span>'],
];

const results = (configs: Record<string, () => SanitizerConfig>): string => JSON.stringify(
  Object.fromEntries(Object.entries(configs).map(([name, getConfig]) => [name,
    Object.fromEntries(CASES.map(([label, html]) => [label, clean(html, getConfig())])),
  ])),
  null,
  2
);

describe('inline tools sanitize rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the real sanitizer output captured before extraction', async () => {
    await expect(results(GET_CONFIG)).toMatchFileSnapshot('./__snapshots__/inline-sanitize.json');
  });
});

describe('shared inline sanitize factories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the independent pre-extraction real sanitizer output', async () => {
    await expect(results(BUILT_IN_INLINE_SANITIZE)).toMatchFileSnapshot('./__snapshots__/inline-sanitize.json');
  });

  it('registers exactly the original inline tool keys', () => {
    expect(Object.keys(BUILT_IN_INLINE_SANITIZE)).toEqual(Object.keys(GET_CONFIG));
  });

  it.each(Object.entries(GET_CONFIG))('%s keeps its real sanitizer output and fresh objects', (name, getConfig) => {
    const factory = BUILT_IN_INLINE_SANITIZE[name];

    if (factory === undefined) {
      throw new Error(`Missing shared sanitizer for ${name}`);
    }

    const first = factory();
    const second = factory();

    for (const [, html] of CASES) {
      expect(clean(html, first)).toBe(clean(html, getConfig()));
    }

    expect(first).not.toBe(second);

    for (const [tag, rule] of Object.entries(first)) {
      if (typeof rule === 'object' && rule !== null) {
        expect(rule).not.toBe(second[tag]);
      }
    }
  });

  it('keeps the link function binding and the separate marker arrow', () => {
    const link = BUILT_IN_INLINE_SANITIZE.link;
    const marker = BUILT_IN_INLINE_SANITIZE.marker;

    if (link === undefined || marker === undefined) {
      throw new Error('Missing link or marker factory');
    }

    expect(link().a).toBe(preservePageReferenceAnchor);
    expect(typeof marker().mark).toBe('function');
    expect(marker().mark).not.toBe(preserveColorStyles);
    expect(marker().mark).not.toBe(marker().mark);
  });
});
