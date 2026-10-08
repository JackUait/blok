import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_RUNTIME_PARTS, BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS, COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from '../../../../src/shared/tool-descriptions';
import { CALLOUT_DATA, describeCallout } from '../../../../src/shared/tool-descriptions/callout';
import { CODE_DATA, describeCode } from '../../../../src/shared/tool-descriptions/code';
import { describeParagraph } from '../../../../src/shared/tool-descriptions/paragraph';
import { describeQuote, QUOTE_DATA } from '../../../../src/shared/tool-descriptions/quote';
import { describeToggle, TOGGLE_DATA } from '../../../../src/shared/tool-descriptions/toggle';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { BlokSchema, DescribeBlockTool } from '../../../../types/tools/tool-description';
import { BLOCK_CLASSES } from './built-in-tools';

type TextBlockName = 'toggle' | 'callout' | 'quote' | 'code';

const TEXT_CLASSES: Array<{ name: TextBlockName; toolClass: unknown }> = [
  { name: 'toggle', toolClass: BLOCK_CLASSES.toggle },
  { name: 'callout', toolClass: BLOCK_CLASSES.callout },
  { name: 'quote', toolClass: BLOCK_CLASSES.quote },
  { name: 'code', toolClass: BLOCK_CLASSES.code },
];

const hasDescribe = (tool: unknown): tool is { describe: DescribeBlockTool } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('text block descriptions', () => {
  it.each(TEXT_CLASSES)('$name is registered for agent discovery', ({ name }) => {
    expect(typeof BUILT_IN_BLOCK_DESCRIPTIONS[name], name).toBe('function');
  });

  it.each(TEXT_CLASSES)('$name exposes its registry description through the real class', ({ name, toolClass }) => {
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

  it('a callout runtime seeds exactly one empty body paragraph', () => {
    expect(BUILT_IN_TOOL_RUNTIMES.get('callout')?.defaultChildren).toEqual([
      { type: 'paragraph', data: { text: [] } },
    ]);
    expect(BUILT_IN_RUNTIME_PARTS.callout?.defaultChildren).toEqual([
      { type: 'paragraph', data: { text: [] } },
    ]);
  });
});

const DESCRIPTIONS: Array<{
  name: TextBlockName;
  describeTool: DescribeBlockTool;
  data: BlokSchema;
  defaultData: Record<string, unknown>;
}> = [
  { name: 'toggle', describeTool: describeToggle, data: TOGGLE_DATA, defaultData: { text: [] } },
  { name: 'callout', describeTool: describeCallout, data: CALLOUT_DATA, defaultData: { emoji: '💡' } },
  { name: 'quote', describeTool: describeQuote, data: QUOTE_DATA, defaultData: { text: [] } },
  { name: 'code', describeTool: describeCode, data: CODE_DATA, defaultData: { code: '', language: 'plain text' } },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('text block description contracts', () => {
  it.each(DESCRIPTIONS)('$name uses one shared factory for the registry and real class', ({ name, describeTool }) => {
    const toolClass: unknown = BLOCK_CLASSES[name];

    expect(BUILT_IN_BLOCK_DESCRIPTIONS[name], name).toBe(describeTool);
    expect(hasDescribe(toolClass), name).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error(`${name} must expose describe.`);
    }

    expect(toolClass.describe).toBe(describeTool);
  });

  it.each(DESCRIPTIONS)('$name keeps its independently published schema and shared data identity', ({ name, describeTool, data }) => {
    const published: unknown = JSON.parse(readFileSync(
      resolve(__dirname, '../../view/__snapshots__/document-schema.json'),
      'utf8'
    ));

    if (!isRecord(published) || !isRecord(published.$defs)) {
      throw new Error('Published schema must expose $defs.');
    }

    const publishedData = published.$defs[name];

    if (!isRecord(publishedData)) {
      throw new Error(`Missing published schema for ${name}.`);
    }

    expect(data, name).toEqual(publishedData);
    expect(describeTool({}).data, name).toBe(data);
    expect(blokDocumentSchema.$defs[name], name).toBe(data);
  });

  it.each(DESCRIPTIONS)('$name advertises valid starter content and examples', ({ name, describeTool, defaultData }) => {
    const description = describeTool({});

    expect(description.defaultData, name).toEqual(defaultData);

    if (description.defaultData === undefined) {
      throw new Error(`${name} must advertise starter data.`);
    }

    expect(validateAgainst(description.data, description.defaultData), name).toEqual([]);

    for (const example of description.examples ?? []) {
      expect(validateAgainst(description.data, example), `${name}: ${JSON.stringify(example)}`).toEqual([]);
    }
  });

  it.each(DESCRIPTIONS)('$name describes JSON without changing data for unrelated config', ({ name, describeTool }) => {
    const description = describeTool({});
    const roundTrip: unknown = JSON.parse(JSON.stringify(description));

    expect(roundTrip, name).toEqual(description);
    expect(describeTool({ placeholder: 'Write here', unrelated: true }), name).toEqual(description);
  });

  it('toggle keeps the body in children and marks open state personal', () => {
    const description = describeToggle();

    expect(description.viewState).toEqual(['isOpen']);
    expect(description.defaultData).toEqual({ text: [] });
    expect(description.guidance).toContain(RICH_TEXT_GUIDANCE);
    expect(description.guidance).toMatch(/child blocks/);
    expect(description.guidance).toMatch(/per person|personal/);
    expect(description.guidance).toMatch(/never saved/);
  });

  it('callout describes a textless panel with body children and optional colors', () => {
    const description = describeCallout();

    expect(description.defaultData).toEqual({ emoji: '💡' });
    expect(description.summaryFields).toEqual(['emoji']);
    expect(description.guidance).toMatch(/holds no text|no text itself/);
    expect(description.guidance).toMatch(/child blocks/);
    expect(description.guidance).toContain('emoji');
    expect(description.guidance).toMatch(/hide/);
    expect(description.guidance).toContain('textColor and backgroundColor');
    expect(description.guidance).toContain(COLOR_PRESET_NAMES);
    expect(description.guidance).toContain('null');
  });

  it('quote summarizes size and guides rich-text content', () => {
    const description = describeQuote();

    expect(description.summaryFields).toEqual(['size']);
    expect(description.defaultData).toEqual({ text: [] });
    expect(description.guidance).toContain(RICH_TEXT_GUIDANCE);
    expect(description.guidance).toContain('"default"');
    expect(description.guidance).toContain('"large"');
  });

  it('code summarizes language and filename and advertises an unfenced raw-text example', () => {
    const description = describeCode();

    expect(description.summaryFields).toEqual(['language', 'filename']);
    expect(description.defaultData).toEqual({ code: '', language: 'plain text' });
    expect(description.examples).toEqual([
      { code: 'const a = 1;', language: 'javascript', filename: 'a.js' },
    ]);
    expect(description.guidance).toMatch(/raw text/);
    expect(description.guidance).toMatch(/never HTML/);
    expect(description.guidance).toMatch(/never a Markdown fence|never.*Markdown fences?/);
    expect(description.guidance).toMatch(/lowercase/);
    expect(description.guidance).toContain('javascript');
    expect(description.guidance).toContain('plain text');
  });

  it('callout seed data validates as a paragraph with segments', () => {
    const runtime = BUILT_IN_TOOL_RUNTIMES.get('callout');

    expect(runtime?.defaultChildren).toEqual([{ type: 'paragraph', data: { text: [] } }]);

    if (runtime === undefined || runtime.defaultChildren === undefined) {
      throw new Error('Callout must declare its body seed.');
    }

    expect(runtime.defaultChildren).toBe(BUILT_IN_RUNTIME_PARTS.callout?.defaultChildren);

    for (const child of runtime.defaultChildren) {
      expect(child.type).toBe('paragraph');
      expect(validateAgainst(describeParagraph().data, child.data)).toEqual([]);
    }
  });
});

const ACCEPTED_DATA: Array<{ name: TextBlockName; scenario: string; data: Record<string, unknown> }> = [
  { name: 'toggle', scenario: 'empty summary', data: { text: [] } },
  { name: 'toggle', scenario: 'formatted summary', data: { text: [{ text: 'Summary', marks: { bold: true } }] } },
  { name: 'toggle', scenario: 'legacy HTML summary', data: { text: '<b>Summary</b>' } },
  { name: 'toggle', scenario: 'deprecated legacy open state', data: { text: [], isOpen: false } },
  { name: 'callout', scenario: 'hidden emoji with inherited colors', data: { emoji: '', textColor: null, backgroundColor: null } },
  { name: 'callout', scenario: 'preset colors', data: { emoji: '💡', textColor: 'red', backgroundColor: 'blue' } },
  { name: 'quote', scenario: 'default size', data: { text: [], size: 'default' } },
  { name: 'quote', scenario: 'large formatted quote', data: { text: [{ text: 'Wise words', marks: { italic: true } }], size: 'large' } },
  { name: 'quote', scenario: 'legacy inline HTML', data: { text: '<i>Wise words</i>' } },
  { name: 'code', scenario: 'empty raw text', data: { code: '', language: 'plain text' } },
  { name: 'code', scenario: 'HTML source as raw code', data: { code: '<div>hello</div>', language: 'html' } },
  { name: 'code', scenario: 'multiline source with filename and hidden line numbers', data: { code: 'const a = 1;\nconsole.log(a);', language: 'javascript', filename: 'a.js', lineNumbers: false } },
  { name: 'code', scenario: 'published unrestricted language string', data: { code: 'print(1)', language: 'Python' } },
];

const REJECTED_DATA: Array<{ name: TextBlockName; scenario: string; data: Record<string, unknown> }> = [
  { name: 'toggle', scenario: 'missing summary', data: {} },
  { name: 'toggle', scenario: 'malformed segments', data: { text: [{ markdown: '**summary**' }] } },
  { name: 'toggle', scenario: 'non-boolean legacy open state', data: { text: [], isOpen: 'open' } },
  { name: 'toggle', scenario: 'unknown field', data: { text: [], surprise: true } },
  { name: 'callout', scenario: 'missing emoji', data: {} },
  { name: 'callout', scenario: 'body text in panel data', data: { emoji: '💡', text: [] } },
  { name: 'callout', scenario: 'numeric emoji', data: { emoji: 1 } },
  { name: 'callout', scenario: 'numeric color', data: { emoji: '💡', textColor: 1 } },
  { name: 'quote', scenario: 'missing text', data: {} },
  { name: 'quote', scenario: 'unsupported size', data: { text: [], size: 'small' } },
  { name: 'quote', scenario: 'malformed segments', data: { text: [{ marks: { bold: true } }] } },
  { name: 'quote', scenario: 'unknown field', data: { text: [], surprise: true } },
  { name: 'code', scenario: 'missing raw text', data: { language: 'plain text' } },
  { name: 'code', scenario: 'missing language', data: { code: '' } },
  { name: 'code', scenario: 'segments instead of raw text', data: { code: [{ text: 'const a = 1;' }], language: 'javascript' } },
  { name: 'code', scenario: 'non-boolean line numbers', data: { code: '', language: 'plain text', lineNumbers: 'yes' } },
  { name: 'code', scenario: 'non-string filename', data: { code: '', language: 'plain text', filename: false } },
  { name: 'code', scenario: 'unknown field', data: { code: '', language: 'plain text', surprise: true } },
];

describe('published text block data boundaries', () => {
  it.each(ACCEPTED_DATA)('$name accepts $scenario', ({ name, data }) => {
    const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    if (describeTool === undefined) {
      throw new Error(`Missing description for ${name}.`);
    }

    expect(validateAgainst(describeTool({}).data, data)).toEqual([]);
  });

  it.each(REJECTED_DATA)('$name rejects $scenario', ({ name, data }) => {
    const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    if (describeTool === undefined) {
      throw new Error(`Missing description for ${name}.`);
    }

    expect(validateAgainst(describeTool({}).data, data).length).toBeGreaterThan(0);
  });
});
