import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clean } from '../../../../src/components/utils/sanitizer';
import { BUILT_IN_BLOCK_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import {
  Audio, Bookmark, Callout, Code, Column, ColumnList, Database, DatabaseRow, Divider, Embed, File as FileTool,
  Header, Image as ImageTool, List, Page, PageLink, Paragraph, Quote, Spacer, Table, TableOfContents,
  TabTool, TabsTool, Toggle, Video,
} from '../../../../src/tools';

import type { SanitizerConfig, ToolSanitizerConfig } from '../../../../types';

const GET_CONFIG: Record<string, () => ToolSanitizerConfig> = {
  paragraph: () => Paragraph.sanitize,
  header: () => Header.sanitize,
  list: () => List.sanitize,
  toggle: () => Toggle.sanitize,
  callout: () => Callout.sanitize,
  quote: () => Quote.sanitize,
  code: () => Code.sanitize,
  table_of_contents: () => TableOfContents.sanitize,
  spacer: () => Spacer.sanitize,
  divider: () => Divider.sanitize,
  image: () => ImageTool.sanitize,
  video: () => Video.sanitize,
  audio: () => Audio.sanitize,
  file: () => FileTool.sanitize,
  embed: () => Embed.sanitize,
  bookmark: () => Bookmark.sanitize,
  page: () => Page.sanitize,
  'page-link': () => PageLink.sanitize,
  database: () => Database.sanitize,
  'database-row': () => DatabaseRow.sanitize,
  tab: () => TabTool.sanitize,
  column_list: () => ({}),
  column: () => ({}),
  tabs: () => ({}),
  table: () => Table.sanitize,
};

const shapes = (configs: Record<string, () => ToolSanitizerConfig>): string => JSON.stringify(
  Object.fromEntries(Object.entries(configs).map(([name, getConfig]) => [name, getConfig()])),
  (_key, value: unknown) => typeof value === 'function' ? `[fn ${value.name}]` : value,
  2
);

const isTagMap = (rule: unknown): rule is SanitizerConfig =>
  typeof rule === 'object' && rule !== null && !Array.isArray(rule);

const textConfig = (config: ToolSanitizerConfig): SanitizerConfig => {
  const rule = config.text;

  if (!isTagMap(rule)) {
    throw new Error('Expected a text sanitizer config');
  }

  return rule;
};

const TEXT_HTML = '<strong>s</strong><i>i</i><u>u</u><s>x</s><code>c</code>'
  + '<mark style="color: red; position: fixed">m</mark>'
  + '<a data-blok-page-id="p1" href="/p/1">Cached title</a>'
  + '<span data-latex="x^2"><b>rendered cache</b></span>'
  + '<img src="https://x.y/i.png" alt="alt" style="width: 8px">'
  + '<p>p</p><ul><li>l</li></ul>';

const TEXT_TOOLS = ['paragraph', 'header', 'list', 'toggle', 'quote'];

const textResults = (configs: Record<string, () => ToolSanitizerConfig>): string => JSON.stringify(
  Object.fromEntries(TEXT_TOOLS.map((name) => {
    const getConfig = configs[name];

    if (getConfig === undefined) {
      throw new Error(`Missing sanitizer for ${name}`);
    }

    return [name, clean(TEXT_HTML, textConfig(getConfig()))];
  })),
  null,
  2
);

describe('block tools own sanitize rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the pre-extraction config shapes', async () => {
    await expect(shapes(GET_CONFIG)).toMatchFileSnapshot('./__snapshots__/block-sanitize.json');
  });

  it('matches the pre-extraction text sanitizer output', async () => {
    await expect(textResults(GET_CONFIG)).toMatchFileSnapshot('./__snapshots__/block-text-sanitize.json');
  });

  it('containers without own rules keep the adapter empty-config fallback', () => {
    for (const tool of [ColumnList, Column, TabsTool]) {
      expect('sanitize' in tool).toBe(false);
    }
  });
});

describe('shared block sanitize factories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the independent pre-extraction config shapes', async () => {
    await expect(shapes(BUILT_IN_BLOCK_SANITIZE)).toMatchFileSnapshot('./__snapshots__/block-sanitize.json');
  });

  it('matches the independent pre-extraction text sanitizer output', async () => {
    await expect(textResults(BUILT_IN_BLOCK_SANITIZE)).toMatchFileSnapshot('./__snapshots__/block-text-sanitize.json');
  });

  it('registers exactly the original built-in tool keys', () => {
    expect(Object.keys(BUILT_IN_BLOCK_SANITIZE).sort()).toEqual(Object.keys(GET_CONFIG).sort());
  });

  it.each(Object.entries(GET_CONFIG))('%s keeps its getter shape and fresh objects', (name, getConfig) => {
    const factory = BUILT_IN_BLOCK_SANITIZE[name];

    if (factory === undefined) {
      throw new Error(`Missing shared sanitizer for ${name}`);
    }

    const first = factory();
    const second = factory();

    expect(shapes({ tool: factory })).toBe(shapes({ tool: getConfig }));
    expect(first).not.toBe(second);

    for (const [field, rule] of Object.entries(first)) {
      if (typeof rule === 'object' && rule !== null) {
        expect(rule).not.toBe(second[field]);
      }
    }
  });
});
