import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clean, sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import { Table } from '../../../../src/tools';
import { ALLOWED_MARK_STYLE_PROPS, CELL_BLOCK_TAGS_SANITIZE } from '../../../../src/shared/table/cell-sanitize';
import { BUILT_IN_BLOCK_SANITIZE, tableSanitize } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import { ALLOWED_MARK_STYLE_PROPS as oldAllowedProps } from '../../../../src/tools/table/table-cell-clipboard';
import { CELL_BLOCK_TAGS_SANITIZE as oldCellTags } from '../../../../src/tools/table/table-cell-paste';

import type { SanitizerConfig, ToolSanitizerConfig } from '../../../../types';

const CASES: Array<[string, string]> = [
  ['mark keeps color only', '<mark style="color: red; font-size: 9px; position: fixed">x</mark>'],
  ['mark keeps background color', '<mark style="background-color: white; padding: 5px">x</mark>'],
  ['mark without colors loses style', '<mark style="font-size: 9px">x</mark>'],
  ['plain link gets target and rel', '<a href="https://a.b" onclick="x()" target="_self" rel="author">a</a>'],
  ['page reference keeps its id', '<a href="/p/1" data-blok-page-id="p1" class="cached">Cached title</a>'],
  ['nested list keeps depth and style', '<ul><li aria-level="2" data-list-style="ordered" style="list-style-type: decimal" onclick="x()">i<ol><li aria-level="3">j</li></ol></li></ul>'],
  ['checkbox input survives', '<li><input type="checkbox" checked onclick="x()">t</li>'],
  ['paragraph and div survive', '<p>a</p><div>b</div>'],
  ['inline aliases and equations survive', '<b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u><s>s</s><del>d</del><code>c</code><sup>1</sup><sub>2</sub><span data-latex="x^2"><b>cache</b></span>'],
];

const isTagMap = (rule: unknown): rule is SanitizerConfig =>
  typeof rule === 'object' && rule !== null && !Array.isArray(rule);

const contentConfig = (config: ToolSanitizerConfig): SanitizerConfig => {
  const rule = config.content;

  if (!isTagMap(rule)) {
    throw new Error('Expected a table content sanitizer config');
  }

  return rule;
};

const results = (config: ToolSanitizerConfig): string => JSON.stringify(
  Object.fromEntries(CASES.map(([label, html]) => [label, clean(html, contentConfig(config))])),
  null,
  2
);

const ordinaryLinkContent = (config: ToolSanitizerConfig): unknown => {
  const [block] = sanitizeBlocks([{ tool: 'table', data: {
    content: [['<a href="https://example.test" target="_self" rel="friend">Site</a>']],
  } }], config);

  return block?.data.content;
};

describe('table sanitize behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the real sanitizer output captured before extraction', async () => {
    await expect(results(Table.sanitize)).toMatchFileSnapshot('./__snapshots__/table-sanitize.json');
  });

  it('applies ordinary link overrides in the block sanitizer', () => {
    expect(ordinaryLinkContent(Table.sanitize)).toEqual([
      ['<a href="https://example.test" target="_blank" rel="nofollow">Site</a>'],
    ]);
  });
});

describe('shared table sanitize factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the independent pre-extraction real sanitizer output', async () => {
    await expect(results(tableSanitize())).toMatchFileSnapshot('./__snapshots__/table-sanitize.json');
  });

  it('preserves the independent ordinary link block-pipeline output', () => {
    expect(ordinaryLinkContent(tableSanitize())).toEqual([
      ['<a href="https://example.test" target="_blank" rel="nofollow">Site</a>'],
    ]);
  });

  it('is the registered table factory', () => {
    expect(BUILT_IN_BLOCK_SANITIZE.table).toBe(tableSanitize);
    expect(Object.keys(tableSanitize())).toEqual(['content']);
  });

  it('keeps old import paths bound to the same cell constants', () => {
    expect(oldAllowedProps).toBe(ALLOWED_MARK_STYLE_PROPS);
    expect(oldCellTags).toBe(CELL_BLOCK_TAGS_SANITIZE);
    expect(ALLOWED_MARK_STYLE_PROPS).toEqual(new Set(['color', 'background-color']));
    expect(CELL_BLOCK_TAGS_SANITIZE).toEqual({
      ul: true,
      ol: true,
      li: { style: true, 'aria-level': true, 'data-list-style': true },
      input: { type: true, checked: true },
      p: {},
      div: {},
    });
  });

  it.each(CASES)('%s matches the existing getter', (_label, html) => {
    expect(clean(html, contentConfig(tableSanitize()))).toBe(clean(html, contentConfig(Table.sanitize)));
  });
});
