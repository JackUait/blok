import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS, COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from '../../../../src/shared/tool-descriptions';
import { describeParagraph, PARAGRAPH_DATA } from '../../../../src/shared/tool-descriptions/paragraph';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { DescribeBlockTool } from '../../../../types/tools/tool-description';
import { BLOCK_CLASSES } from './built-in-tools';

const hasDescribe = (tool: unknown): tool is { describe: DescribeBlockTool } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

const isBlockName = (name: string): name is keyof typeof BLOCK_CLASSES =>
  Object.prototype.hasOwnProperty.call(BLOCK_CLASSES, name);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('built-in block descriptions', () => {
  const entries = Object.entries(BUILT_IN_BLOCK_DESCRIPTIONS);
  const names = entries.map(([name]) => name);

  it('has at least one entry', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it('registers the paragraph description', () => {
    expect(names).toContain('paragraph');
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.paragraph).toBe(describeParagraph);
  });

  it('registers every built-in class that advertises a description', () => {
    for (const [name, toolClass] of Object.entries(BLOCK_CLASSES)) {
      if ('describe' in toolClass) {
        expect(hasDescribe(toolClass), name).toBe(true);
        expect(names).toContain(name);
      }
    }
  });

  it.each(entries)('%s: data matches the published $defs entry', (name, describeTool) => {
    expect(isBlockName(name)).toBe(true);

    if (!isBlockName(name)) {
      throw new Error(`Unknown built-in block: ${name}`);
    }

    expect(describeTool({}).data).toEqual(blokDocumentSchema.$defs[name]);
  });

  it.each(entries)('%s: survives a JSON round trip', (_name, describeTool) => {
    const description = describeTool({});
    const roundTrip: unknown = JSON.parse(JSON.stringify(description));

    expect(roundTrip).toEqual(description);
  });

  it.each(entries)('%s: the class exposes the shared describe function', (name, describeTool) => {
    expect(isBlockName(name)).toBe(true);

    if (!isBlockName(name)) {
      throw new Error(`Unknown built-in block: ${name}`);
    }

    const toolClass = BLOCK_CLASSES[name];

    expect(hasDescribe(toolClass)).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error(`${name} must expose describe.`);
    }

    expect(toolClass.describe).toBe(describeTool);
    expect(toolClass.describe({})).toEqual(describeTool({}));
  });

  it.each(entries)('%s: defaultData and examples validate', (_name, describeTool) => {
    const { data, defaultData, examples = [] } = describeTool({});

    if (defaultData !== undefined) {
      expect(validateAgainst(data, defaultData)).toEqual([]);
    }

    for (const example of examples) {
      expect(validateAgainst(data, example)).toEqual([]);
    }
  });

  it('names the color presets the picker offers', () => {
    expect(COLOR_PRESET_NAMES).toBe(COLOR_PRESETS.map(preset => preset.name).join(', '));
  });
});

describe('paragraph self-description', () => {
  it('advertises its schema and valid starter content through the tool class', () => {
    const toolClass = BLOCK_CLASSES.paragraph;

    expect(hasDescribe(toolClass)).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error('Paragraph must expose describe.');
    }

    const description = toolClass.describe({});

    expect(description.data).toEqual(blokDocumentSchema.$defs.paragraph);
    expect(description.summary).toBe('A paragraph of rich text. The default block.');
    expect(description.defaultData).toEqual({ text: [] });
    expect(description.examples).toEqual([
      { text: [{ text: 'Ship it ' }, { text: 'today', marks: { bold: true } }] },
    ]);

    expect(validateAgainst(description.data, description.defaultData)).toEqual([]);

    for (const example of description.examples ?? []) {
      expect(validateAgainst(description.data, example)).toEqual([]);
    }
  });

  it('keeps the independently published paragraph schema', () => {
    const published: unknown = JSON.parse(readFileSync(
      resolve(__dirname, '../../view/__snapshots__/document-schema.json'),
      'utf8'
    ));

    if (!isRecord(published) || !isRecord(published.$defs)) {
      throw new Error('Published schema must expose $defs.');
    }

    expect(PARAGRAPH_DATA).toEqual(published.$defs.paragraph);
    expect(describeParagraph().data).toBe(PARAGRAPH_DATA);
    expect(blokDocumentSchema.$defs.paragraph).toBe(PARAGRAPH_DATA);
  });

  it('guides rich-text and color writes', () => {
    const description = describeParagraph();

    expect(RICH_TEXT_GUIDANCE).toContain('segments');
    expect(RICH_TEXT_GUIDANCE).toContain('Never write Markdown');
    expect(RICH_TEXT_GUIDANCE).toContain('markdown.insert');
    expect(description.guidance).toContain(RICH_TEXT_GUIDANCE);
    expect(description.guidance).toContain('textColor and backgroundColor');
    expect(description.guidance).toContain(COLOR_PRESET_NAMES);
  });

  it('does not change the schema or starter content for paragraph config', () => {
    expect(describeParagraph({ preserveBlank: true, placeholder: 'Write here' }))
      .toEqual(describeParagraph());
  });

  it.each([
    { text: [] },
    { text: '<b>Ship it</b>' },
    { text: [{ text: 'Ship it', marks: { bold: true } }], textColor: 'red', backgroundColor: 'blue' },
  ])('accepts published paragraph data: %j', (data) => {
    expect(validateAgainst(describeParagraph().data, data)).toEqual([]);
  });

  it.each([
    ['missing text', {}],
    ['unknown fields', { text: [], surprise: true }],
    ['malformed segments', { text: [{ markdown: '**not segments**' }] }],
    ['non-string colors', { text: [], textColor: 10 }],
  ])('rejects %s', (_name, data) => {
    expect(validateAgainst(describeParagraph().data, data).length).toBeGreaterThan(0);
  });
});
