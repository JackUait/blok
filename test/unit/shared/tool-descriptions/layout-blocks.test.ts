import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unknownKeywords, validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS, COLOR_PRESET_NAMES } from '../../../../src/shared/tool-descriptions';
import { COLUMN_DATA, describeColumn } from '../../../../src/shared/tool-descriptions/column';
import { COLUMN_LIST_DATA, describeColumnList } from '../../../../src/shared/tool-descriptions/column-list';
import { describeDivider, DIVIDER_DATA } from '../../../../src/shared/tool-descriptions/divider';
import { describeSpacer, SPACER_DATA } from '../../../../src/shared/tool-descriptions/spacer';
import { describeTab, TAB_DATA } from '../../../../src/shared/tool-descriptions/tab';
import { describeTableOfContents, TABLE_OF_CONTENTS_DATA } from '../../../../src/shared/tool-descriptions/table-of-contents';
import { describeTabs, TABS_DATA } from '../../../../src/shared/tool-descriptions/tabs';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { BlokSchema, BlockToolDescription, DescribeBlockTool } from '../../../../types/tools/tool-description';
import { BLOCK_CLASSES } from './built-in-tools';

type LayoutName = 'divider' | 'spacer' | 'table_of_contents' | 'column_list' | 'column' | 'tabs' | 'tab';

const LAYOUT_CLASSES: Array<{ name: LayoutName; toolClass: unknown }> = [
  { name: 'divider', toolClass: BLOCK_CLASSES.divider },
  { name: 'spacer', toolClass: BLOCK_CLASSES.spacer },
  { name: 'table_of_contents', toolClass: BLOCK_CLASSES.table_of_contents },
  { name: 'column_list', toolClass: BLOCK_CLASSES.column_list },
  { name: 'column', toolClass: BLOCK_CLASSES.column },
  { name: 'tabs', toolClass: BLOCK_CLASSES.tabs },
  { name: 'tab', toolClass: BLOCK_CLASSES.tab },
];

const LAYOUT_DESCRIPTIONS: Array<{
  name: LayoutName;
  describeTool: (config?: Record<string, unknown>) => BlockToolDescription;
  data: BlokSchema;
  toolClass: unknown;
  expected: Omit<BlockToolDescription, 'data'>;
}> = [
  {
    name: 'divider',
    describeTool: describeDivider,
    data: DIVIDER_DATA,
    toolClass: BLOCK_CLASSES.divider,
    expected: { summary: 'A horizontal rule.', defaultData: {} },
  },
  {
    name: 'spacer',
    describeTool: describeSpacer,
    data: SPACER_DATA,
    toolClass: BLOCK_CLASSES.spacer,
    expected: {
      summary: 'Vertical whitespace.',
      guidance: 'height is pixels, 38 to 600.',
      defaultData: { height: 38 },
      summaryFields: ['height'],
    },
  },
  {
    name: 'table_of_contents',
    describeTool: describeTableOfContents,
    data: TABLE_OF_CONTENTS_DATA,
    toolClass: BLOCK_CLASSES.table_of_contents,
    expected: {
      summary: 'An outline of the page headings, read from the document each time.',
      guidance: `It stores no headings: add or edit header blocks instead. textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
      defaultData: {},
    },
  },
  {
    name: 'column_list',
    describeTool: describeColumnList,
    data: COLUMN_LIST_DATA,
    toolClass: BLOCK_CLASSES.column_list,
    expected: {
      summary: 'A row of columns. The columns are its children.',
      guidance: 'Create one with column_list.create, which makes the columns too. Move an existing block into a column with block.move. The toolbox columnCount value is not saved data; never write it.',
      inputFields: [],
      defaultData: {},
    },
  },
  {
    name: 'column',
    describeTool: describeColumn,
    data: COLUMN_DATA,
    toolClass: BLOCK_CLASSES.column,
    expected: {
      summary: 'One column of a column_list. Its content is its children.',
      guidance: 'Change widths with column_list.setWidths on the list, not by writing widthRatio on one column.',
      inputFields: [],
      defaultData: {},
      summaryFields: ['widthRatio'],
    },
  },
  {
    name: 'tabs',
    describeTool: describeTabs,
    data: TABS_DATA,
    toolClass: BLOCK_CLASSES.tabs,
    expected: {
      summary: 'A set of tabs. Each tab is a child tab block.',
      guidance: 'Create one with tabs.create. Add and delete tabs with tabs.addTab and tabs.deleteTab. Which tab is open is per person and never saved.',
      inputFields: [],
      defaultData: {},
    },
  },
  {
    name: 'tab',
    describeTool: describeTab,
    data: TAB_DATA,
    toolClass: BLOCK_CLASSES.tab,
    expected: {
      summary: 'One tab of a tabs block. Its content is its children.',
      guidance: 'title is plain text, not HTML. icon is one emoji, or omit it.',
      inputFields: [],
      defaultData: { title: '' },
      summaryFields: ['title', 'icon'],
    },
  },
];

const acceptedData: Array<{ name: LayoutName; label: string; data: Record<string, unknown> }> = [
  { name: 'divider', label: 'empty data', data: {} },
  { name: 'spacer', label: 'omitted height', data: {} },
  { name: 'spacer', label: 'minimum height', data: { height: 38 } },
  { name: 'spacer', label: 'maximum height', data: { height: 600 } },
  { name: 'spacer', label: 'fractional height', data: { height: 38.5 } },
  { name: 'spacer', label: 'interior height', data: { height: 150 } },
  { name: 'table_of_contents', label: 'no colors', data: {} },
  { name: 'table_of_contents', label: 'preset colors', data: { textColor: 'red', backgroundColor: 'blue' } },
  { name: 'table_of_contents', label: 'empty color strings', data: { textColor: '', backgroundColor: '' } },
  { name: 'table_of_contents', label: 'color strings without an enum', data: { textColor: 'host-ink', backgroundColor: '#123456' } },
  { name: 'column_list', label: 'empty data', data: {} },
  { name: 'column', label: 'omitted ratio', data: {} },
  { name: 'column', label: 'explicit even split', data: { widthRatio: 1 } },
  { name: 'column', label: 'larger relative width', data: { widthRatio: 2 } },
  { name: 'column', label: 'fractional ratio', data: { widthRatio: 0.25 } },
  { name: 'column', label: 'ratio without an upper bound', data: { widthRatio: 1000000 } },
  { name: 'tabs', label: 'empty data', data: {} },
  { name: 'tab', label: 'untitled tab', data: { title: '' } },
  { name: 'tab', label: 'named tab', data: { title: 'Overview' } },
  { name: 'tab', label: 'emoji icon', data: { title: 'Overview', icon: '📋' } },
  { name: 'tab', label: 'empty icon string', data: { title: 'Overview', icon: '' } },
  { name: 'tab', label: 'icon string without an emoji validator', data: { title: 'Overview', icon: 'not-an-emoji' } },
  { name: 'tab', label: 'icon string without a one-emoji limit', data: { title: 'Overview', icon: '📋🚀' } },
  { name: 'tab', label: 'markup characters in a plain string', data: { title: '<b>Overview</b>' } },
];

const rejectedData: Array<{ name: LayoutName; label: string; data: unknown }> = [
  { name: 'divider', label: 'text data', data: { text: [] } },
  { name: 'divider', label: 'children in data', data: { children: [] } },
  { name: 'divider', label: 'non-object data', data: false },
  { name: 'spacer', label: 'height 20 from the brief', data: { height: 20 } },
  { name: 'spacer', label: 'height just below the minimum', data: { height: 37.999 } },
  { name: 'spacer', label: 'height just above the maximum', data: { height: 600.001 } },
  { name: 'spacer', label: 'string height', data: { height: '38' } },
  { name: 'spacer', label: 'null height', data: { height: null } },
  { name: 'spacer', label: 'infinite height', data: { height: Infinity } },
  { name: 'spacer', label: 'NaN height', data: { height: NaN } },
  { name: 'spacer', label: 'extra size field', data: { height: 38, size: 38 } },
  { name: 'table_of_contents', label: 'saved heading list', data: { headings: [] } },
  { name: 'table_of_contents', label: 'saved outline text', data: { text: [] } },
  { name: 'table_of_contents', label: 'null text color', data: { textColor: null } },
  { name: 'table_of_contents', label: 'numeric background color', data: { backgroundColor: 1 } },
  { name: 'table_of_contents', label: 'saved depth setting', data: { depth: 2 } },
  { name: 'column_list', label: 'transient columnCount seed', data: { columnCount: 3 } },
  { name: 'column_list', label: 'transient noSeed flag', data: { noSeed: true } },
  { name: 'column_list', label: 'children in data', data: { children: [] } },
  { name: 'column_list', label: 'widths in data', data: { widths: [1, 1] } },
  { name: 'column', label: 'zero width ratio', data: { widthRatio: 0 } },
  { name: 'column', label: 'negative width ratio', data: { widthRatio: -1 } },
  { name: 'column', label: 'string width ratio', data: { widthRatio: '2' } },
  { name: 'column', label: 'null width ratio', data: { widthRatio: null } },
  { name: 'column', label: 'transient noSeed flag', data: { noSeed: true } },
  { name: 'column', label: 'transient noFocus flag', data: { noFocus: true } },
  { name: 'column', label: 'children in data', data: { children: [] } },
  { name: 'tabs', label: 'ad-hoc active tab field', data: { activeTab: 'tab-1' } },
  { name: 'tabs', label: 'ad-hoc open tab field', data: { openTab: 'tab-1' } },
  { name: 'tabs', label: 'transient noSeed flag', data: { noSeed: true } },
  { name: 'tabs', label: 'children in data', data: { children: [] } },
  { name: 'tab', label: 'missing title', data: {} },
  { name: 'tab', label: 'numeric title', data: { title: 1 } },
  { name: 'tab', label: 'null title', data: { title: null } },
  { name: 'tab', label: 'null icon', data: { title: '', icon: null } },
  { name: 'tab', label: 'array icon', data: { title: '', icon: ['📋'] } },
  { name: 'tab', label: 'children in data', data: { title: '', children: [] } },
];

const hasDescribe = (tool: unknown): tool is { describe: DescribeBlockTool } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const descriptionFor = (name: LayoutName): BlockToolDescription => {
  const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

  if (describeTool === undefined) {
    throw new Error(`Missing description for ${name}.`);
  }

  return describeTool({});
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('layout block descriptions', () => {
  it.each(LAYOUT_CLASSES)('$name is registered for agent discovery', ({ name }) => {
    expect(typeof BUILT_IN_BLOCK_DESCRIPTIONS[name], name).toBe('function');
  });

  it.each(LAYOUT_CLASSES)('$name exposes its registry description through the real class', ({ name, toolClass }) => {
    expect(hasDescribe(toolClass), name).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error(`${name} must expose describe.`);
    }

    const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    expect(typeof describeTool, name).toBe('function');

    if (describeTool === undefined) {
      throw new Error(`Missing description for ${name}.`);
    }

    expect(toolClass.describe).toBe(describeTool);
    expect(toolClass.describe({})).toEqual(describeTool({}));
  });

  it.each(LAYOUT_DESCRIPTIONS)('$name keeps the independently published schema and shared identities', ({ name, describeTool, data }) => {
    const published: unknown = JSON.parse(readFileSync(
      resolve(__dirname, '../../view/__snapshots__/document-schema.json'),
      'utf8'
    ));

    if (!isRecord(published) || !isRecord(published.$defs)) {
      throw new Error('Published schema must expose $defs.');
    }

    expect(BUILT_IN_BLOCK_DESCRIPTIONS[name], name).toBe(describeTool);
    expect(data).toEqual(published.$defs[name]);
    expect(JSON.stringify(data, null, 2)).toBe(JSON.stringify(published.$defs[name], null, 2));
    expect(describeTool().data).toBe(data);
    expect(blokDocumentSchema.$defs[name]).toBe(data);
  });

  it.each(LAYOUT_DESCRIPTIONS)('$name advertises exactly the brief metadata and starter', ({ describeTool, data, expected }) => {
    expect(describeTool()).toEqual({ ...expected, data });
  });

  it.each(LAYOUT_DESCRIPTIONS)('$name returns schema-profile data and valid JSON starter content', ({ describeTool }) => {
    const description = describeTool();
    const roundTrip: unknown = JSON.parse(JSON.stringify(description));

    expect(unknownKeywords(description.data)).toEqual([]);
    expect(validateAgainst(description.data, description.defaultData)).toEqual([]);
    expect(roundTrip).toEqual(description);
  });

  it.each(LAYOUT_DESCRIPTIONS)('$name ignores unrelated config without mutating it', ({ describeTool }) => {
    const config = {
      height: 80,
      columnCount: 5,
      widthRatio: 3,
      title: 'Host title',
      icon: '🚀',
      activeTab: 'tab-2',
      noSeed: true,
    };
    const before = JSON.stringify(config);

    expect(describeTool(config)).toEqual(describeTool());
    expect(JSON.stringify(config)).toBe(before);
  });

  it.each(LAYOUT_DESCRIPTIONS)('$name rejects unknown saved fields', ({ describeTool }) => {
    const description = describeTool();

    expect(validateAgainst(description.data, {
      ...description.defaultData,
      unexpected: true,
    }).length).toBeGreaterThan(0);
  });

  it('preserves the full published schema serialization bytes', () => {
    const published = readFileSync(
      resolve(__dirname, '../../view/__snapshots__/document-schema.json'),
      'utf8'
    );

    expect(JSON.stringify(blokDocumentSchema, null, 2)).toBe(published);
  });

  it.each(acceptedData)('$name accepts $label in the saved schema', ({ name, data }) => {
    expect(validateAgainst(descriptionFor(name).data, data)).toEqual([]);
  });

  it.each(rejectedData)('$name rejects $label in the saved schema', ({ name, data }) => {
    expect(validateAgainst(descriptionFor(name).data, data).length).toBeGreaterThan(0);
  });
});
