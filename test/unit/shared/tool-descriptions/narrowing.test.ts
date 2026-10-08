import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS, COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from '../../../../src/shared/tool-descriptions';
import { describeHeader, HEADER_DATA } from '../../../../src/shared/tool-descriptions/header';
import { describeList, LIST_DATA } from '../../../../src/shared/tool-descriptions/list';
import { describeParagraph } from '../../../../src/shared/tool-descriptions/paragraph';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { DescribeBlockTool } from '../../../../types/tools/tool-description';
import { BLOCK_CLASSES } from './built-in-tools';

const hasDescribe = (tool: unknown): tool is { describe: DescribeBlockTool } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('header and list self-description through real tools', () => {
  it('header advertises a description that rejects a disallowed heading level', () => {
    const toolClass = BLOCK_CLASSES.header;

    expect(hasDescribe(toolClass)).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error('Header must expose describe.');
    }

    const description = toolClass.describe({ levels: [1, 2] });

    expect(validateAgainst(description.data, { text: [], level: 3 }).length).toBeGreaterThan(0);
    expect(validateAgainst(description.data, { text: [], level: 2 })).toEqual([]);
    expect(description.defaultData).toEqual({ text: [], level: 2 });
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.header).toBe(toolClass.describe);
  });

  it('list advertises a description that rejects a disallowed list style', () => {
    const toolClass = BLOCK_CLASSES.list;

    expect(hasDescribe(toolClass)).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error('List must expose describe.');
    }

    const description = toolClass.describe({ styles: ['checklist'] });

    expect(validateAgainst(description.data, { text: [], style: 'ordered' }).length).toBeGreaterThan(0);
    expect(validateAgainst(description.data, { text: [], style: 'checklist' })).toEqual([]);
    expect(description.defaultData).toEqual({ text: [], style: 'checklist' });
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.list).toBe(toolClass.describe);
  });
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const headerDefaults: Array<[Record<string, unknown>, number]> = [
  [{}, 2],
  [{ defaultLevel: 6 }, 6],
  [{ levels: [1, 2, 3], defaultLevel: 3 }, 3],
  [{ levels: [2, 4, 6] }, 4],
  [{ levels: [6, 1, 3] }, 1],
  [{ levels: [5] }, 5],
  [{ levels: [3, 5], defaultLevel: 6 }, 5],
  [{ levels: [3, 5], defaultLevel: '3' }, 5],
  [{ levels: [3, 5], defaultLevel: NaN }, 5],
  [{ levels: [], defaultLevel: 4 }, 4],
];

const listDefaults: Array<[Record<string, unknown>, string]> = [
  [{}, 'unordered'],
  [{ defaultStyle: 'ordered' }, 'ordered'],
  [{ styles: ['unordered', 'ordered'], defaultStyle: 'ordered' }, 'ordered'],
  [{ styles: ['ordered', 'unordered'] }, 'unordered'],
  [{ styles: ['checklist'] }, 'checklist'],
  [{ styles: ['ordered', 'checklist'] }, 'ordered'],
  [{ styles: ['ordered', 'checklist'], defaultStyle: 'unordered' }, 'ordered'],
  [{ styles: ['checklist'], defaultStyle: 1 }, 'checklist'],
  [{ defaultStyle: 'unknown' }, 'unordered'],
  [{ styles: [], defaultStyle: 'checklist' }, 'checklist'],
];

describe('header and list config narrowing', () => {
  it('registers the shared functions without replacing paragraph', () => {
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.header).toBe(describeHeader);
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.list).toBe(describeList);
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.paragraph).toBe(describeParagraph);
  });

  it('keeps the independently published schemas and their shared identities', () => {
    const published: unknown = JSON.parse(readFileSync(
      resolve(__dirname, '../../view/__snapshots__/document-schema.json'),
      'utf8'
    ));

    if (!isRecord(published) || !isRecord(published.$defs)) {
      throw new Error('Published schema must expose $defs.');
    }

    expect(HEADER_DATA).toEqual(published.$defs.header);
    expect(LIST_DATA).toEqual(published.$defs.list);
    expect(describeHeader().data).toBe(HEADER_DATA);
    expect(describeList().data).toBe(LIST_DATA);
    expect(blokDocumentSchema.$defs.header).toBe(HEADER_DATA);
    expect(blokDocumentSchema.$defs.list).toBe(LIST_DATA);
  });

  it('narrows only the header level property and preserves configured order', () => {
    const { data } = describeHeader({ levels: [6, 1, 3] });

    expect(data).toEqual({
      ...HEADER_DATA,
      properties: { ...HEADER_DATA.properties, level: { type: 'integer', enum: [6, 1, 3] } },
    });

    for (const level of [1, 3, 6]) {
      expect(validateAgainst(data, { text: [], level })).toEqual([]);
    }

    for (const level of [0, 2, 4, 5, 7, 1.5, '1']) {
      expect(validateAgainst(data, { text: [], level }).length).toBeGreaterThan(0);
    }
  });

  it('filters malformed header config without coercing values', () => {
    const config = { levels: [3, '4', true, null, {}, [], 0, 7, 2.5, NaN, Infinity] };
    const description = describeHeader(config);

    expect(description.data).toEqual({
      ...HEADER_DATA,
      properties: { ...HEADER_DATA.properties, level: { type: 'integer', enum: [3] } },
    });
    expect(validateAgainst(description.data, { text: [], level: 4 }).length).toBeGreaterThan(0);
    expect(description.defaultData).toEqual({ text: [], level: 3 });
    expect(config.levels).toEqual([3, '4', true, null, {}, [], 0, 7, 2.5, NaN, Infinity]);
  });

  it.each([
    { levels: undefined },
    { levels: [] },
    { levels: ['2', 0, 7, 1.5, NaN, Infinity, null, {}] },
    { levels: null },
    { levels: '2' },
    { levels: 2 },
    { levels: {} },
  ])('does not narrow when header levels has no valid entries: %j', (config) => {
    expect(describeHeader(config).data).toBe(HEADER_DATA);
    expect(describeHeader(config).defaultData).toEqual({ text: [], level: 2 });
  });

  it.each(headerDefaults)('uses a valid header default and matching example for %j', (config, level) => {
    const description = describeHeader(config);

    expect(description.defaultData).toEqual({ text: [], level });
    expect(description.examples).toEqual([{ text: [{ text: 'Roadmap' }], level }]);
    expect(validateAgainst(description.data, description.defaultData)).toEqual([]);

    for (const example of description.examples ?? []) {
      expect(validateAgainst(description.data, example)).toEqual([]);
    }

    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
  });

  it('guards toggle conversion and marks personal open state', () => {
    const description = describeHeader({ levels: [1] });

    expect(description.guardedFields).toEqual({ isToggleable: 'block.convert' });
    expect(description.viewState).toEqual(['isOpen']);
    expect(description.summaryFields).toEqual(['level', 'isToggleable']);
    expect(description.guidance).toContain(RICH_TEXT_GUIDANCE);
    expect(description.guidance).toContain('block.convert');
    expect(description.guidance).toContain('release its children');
    expect(description.guidance).toContain(COLOR_PRESET_NAMES);
  });

  it('narrows only the list style property', () => {
    const { data } = describeList({ styles: ['ordered', 'checklist'] });

    expect(data).toEqual({
      ...LIST_DATA,
      properties: { ...LIST_DATA.properties, style: { type: 'string', enum: ['ordered', 'checklist'] } },
    });
    expect(validateAgainst(data, { text: [], style: 'unordered' }).length).toBeGreaterThan(0);

    for (const style of ['ordered', 'checklist']) {
      expect(validateAgainst(data, { text: [], style })).toEqual([]);
    }
  });

  it('filters malformed list config without coercing values', () => {
    const config = { styles: ['ordered', 'unknown', 1, true, null, {}, []] };
    const description = describeList(config);

    expect(description.data).toEqual({
      ...LIST_DATA,
      properties: { ...LIST_DATA.properties, style: { type: 'string', enum: ['ordered'] } },
    });
    expect(validateAgainst(description.data, { text: [], style: 'checklist' }).length).toBeGreaterThan(0);
    expect(description.defaultData).toEqual({ text: [], style: 'ordered' });
    expect(config.styles).toEqual(['ordered', 'unknown', 1, true, null, {}, []]);
  });

  it.each([
    { styles: undefined },
    { styles: [] },
    { styles: ['unknown', 1, true, null, {}] },
    { styles: null },
    { styles: 'ordered' },
    { styles: 1 },
    { styles: {} },
  ])('does not narrow when list styles has no valid entries: %j', (config) => {
    expect(describeList(config).data).toBe(LIST_DATA);
    expect(describeList(config).defaultData).toEqual({ text: [], style: 'unordered' });
  });

  it.each(listDefaults)('uses a valid list default and matching example for %j', (config, style) => {
    const description = describeList(config);
    const example = {
      text: [{ text: 'Buy milk' }],
      style,
      ...(style === 'checklist' ? { checked: false } : {}),
    };

    expect(description.defaultData).toEqual({ text: [], style });
    expect(description.examples).toEqual([example]);
    expect(validateAgainst(description.data, description.defaultData)).toEqual([]);

    for (const sample of description.examples ?? []) {
      expect(validateAgainst(description.data, sample)).toEqual([]);
    }

    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
  });

  it('keeps toolbox visibility separate from the list data contract', () => {
    expect(describeList({ toolboxStyles: ['checklist'] })).toEqual(describeList());
  });

  it('guides sibling items, structural nesting, and ordered starts', () => {
    const description = describeList({ styles: ['ordered'] });

    expect(description.summaryFields).toEqual(['style', 'checked', 'start']);
    expect(description.guidance).toContain(RICH_TEXT_GUIDANCE);
    expect(description.guidance).toContain('Insert one list block per item.');
    expect(description.guidance).toContain('inserting it as a child of the item above');
    expect(description.guidance).toContain('For rendered, structurally nested items, depth is derived from nesting on save.');
    expect(description.guidance).toContain('Set start only on the first item of an ordered run.');
  });

  it('does not mutate the unrestricted schemas when narrowing', () => {
    const headerBefore = JSON.stringify(HEADER_DATA);
    const listBefore = JSON.stringify(LIST_DATA);

    describeHeader({ levels: [6] });
    describeList({ styles: ['checklist'] });

    expect(JSON.stringify(HEADER_DATA)).toBe(headerBefore);
    expect(JSON.stringify(LIST_DATA)).toBe(listBefore);
    expect(describeHeader().data).toBe(HEADER_DATA);
    expect(describeList().data).toBe(LIST_DATA);
  });
});
