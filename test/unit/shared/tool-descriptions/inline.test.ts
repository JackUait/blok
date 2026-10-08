import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyLinkTune } from '../../../../src/components/block-tunes/block-tune-copy-link';
import { DeleteTune } from '../../../../src/components/block-tunes/block-tune-delete';
import { ConvertInlineTool } from '../../../../src/components/inline-tools/inline-tool-convert';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_INLINE_DESCRIPTIONS, BUILT_IN_TUNE_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions/inline';
import { RICH_TEXT_MARKS } from '../../../../src/shared/tool-descriptions/rich-text';
import type { RichTextMarks } from '../../../../types/rich-text';
import type { ToolConfig } from '../../../../types/tools/tool-config';
import type { InlineToolDescription } from '../../../../types/tools/tool-description';
import { INLINE_CLASSES } from './built-in-tools';

const INLINE_TOOL_CLASSES = { ...INLINE_CLASSES, convertTo: ConvertInlineTool };
const TUNE_CLASSES = { delete: DeleteTune, copyLink: CopyLinkTune };

type InlineName = keyof typeof INLINE_TOOL_CLASSES;

const hasDescribe = (tool: unknown): tool is { describe: (config: ToolConfig) => unknown } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

const describeInline = (name: InlineName): InlineToolDescription => {
  const factory = BUILT_IN_INLINE_DESCRIPTIONS[name];

  if (typeof factory !== 'function') {
    throw new Error(`Missing description for ${name}.`);
  }

  return factory();
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

describe('built-in inline and tune descriptions', () => {
  it('covers the exported inline tools, internal conversion tool and built-in tunes', () => {
    expect(Object.keys(BUILT_IN_INLINE_DESCRIPTIONS).sort()).toEqual(Object.keys(INLINE_TOOL_CLASSES).sort());
    expect(Object.keys(BUILT_IN_TUNE_DESCRIPTIONS).sort()).toEqual(Object.keys(TUNE_CLASSES).sort());
  });

  it.each(Object.entries(INLINE_TOOL_CLASSES))('%s owns the shared inline description factory', (name, toolClass) => {
    const factory = BUILT_IN_INLINE_DESCRIPTIONS[name];
    const candidate: unknown = toolClass;

    expect(typeof factory, name).toBe('function');
    expect(hasDescribe(candidate), name).toBe(true);

    if (typeof factory !== 'function' || !hasDescribe(candidate)) {
      throw new Error(`${name} must expose its shared description.`);
    }

    expect(candidate.describe).toBe(factory);
    expect(Object.getOwnPropertyNames(candidate)).toContain('describe');

    const description = factory();
    const roundTrip: unknown = JSON.parse(JSON.stringify(description));

    expect(candidate.describe({})).toEqual(description);
    expect(roundTrip).toEqual(description);
    expect(description.summary.trim().length).toBeGreaterThan(0);
  });

  it.each(Object.entries(TUNE_CLASSES))('%s owns the shared tune factory and saves no tune data', (name, toolClass) => {
    const factory = BUILT_IN_TUNE_DESCRIPTIONS[name];
    const candidate: unknown = toolClass;

    expect(typeof factory, name).toBe('function');
    expect(hasDescribe(candidate), name).toBe(true);

    if (typeof factory !== 'function' || !hasDescribe(candidate)) {
      throw new Error(`${name} must expose its shared description.`);
    }

    const description = factory();
    const roundTrip: unknown = JSON.parse(JSON.stringify(description));

    expect(description.data).toBeNull();
    expect(candidate.describe).toBe(factory);
    expect(Object.getOwnPropertyNames(candidate)).toContain('describe');
    expect(candidate.describe({})).toEqual(description);
    expect(roundTrip).toEqual(description);
    expect(description.summary.trim().length).toBeGreaterThan(0);

    if (name === 'copyLink') {
      expect(description.summary).toBe("Copies the block's link target. Changes nothing in the document.");
    }
  });
});

const BOOLEAN_MARKS: Array<{ name: InlineName; mark: keyof RichTextMarks }> = [
  { name: 'bold', mark: 'bold' },
  { name: 'italic', mark: 'italic' },
  { name: 'underline', mark: 'underline' },
  { name: 'strikethrough', mark: 'strikethrough' },
  { name: 'inlineCode', mark: 'code' },
];

describe('inline rich-text effects', () => {
  it.each(BOOLEAN_MARKS)('$name names its own boolean mark', ({ name, mark }) => {
    expect(describeInline(name).effect).toEqual({ mark, value: { const: true } });
    expect(Object.keys(RICH_TEXT_MARKS.properties)).toContain(mark);
  });

  it('marker advertises text color, background color and plain highlight', () => {
    expect(describeInline('marker').effect).toEqual({
      marks: ['color', 'background', 'highlight'],
      value: { type: ['string', 'boolean'] },
    });
  });

  it('link uses the shared link-object schema, not a URL string', () => {
    const { effect } = describeInline('link');

    expect(effect).toEqual({ mark: 'link', value: RICH_TEXT_MARKS.properties.link });

    if (!('mark' in effect)) {
      throw new Error('Link must describe a single mark.');
    }

    expect(effect.value).toBe(RICH_TEXT_MARKS.properties.link);
    expect(validateAgainst(effect.value, { href: 'https://example.test', target: '_self', rel: 'noopener' })).toEqual([]);
    expect(validateAgainst(effect.value, {}).length).toBeGreaterThan(0);
    expect(validateAgainst(effect.value, { href: 3 }).length).toBeGreaterThan(0);
  });

  it('equation is an embed with a required string expression, not a mark', () => {
    const { effect } = describeInline('equation');

    expect(effect).toEqual({
      embed: 'equation',
      value: {
        type: 'object',
        required: ['expression'],
        properties: { expression: { type: 'string' } },
      },
    });

    if (!('embed' in effect)) {
      throw new Error('Equation must describe an embed.');
    }

    expect(validateAgainst(effect.value, { expression: 'x^2' })).toEqual([]);
    expect(validateAgainst(effect.value, {}).length).toBeGreaterThan(0);
    expect(validateAgainst(effect.value, { expression: 2 }).length).toBeGreaterThan(0);
  });

  it('supSub names both script marks and describes their exclusivity', () => {
    const description = describeInline('supSub');

    expect(description.effect).toEqual({ marks: ['sup', 'sub'], value: { const: true } });
    expect(description.summary).toMatch(/never both|mutually exclusive|removes? the other/i);
  });

  it('clearFormat identifies mark clearing without claiming every mark is removed', () => {
    const description = describeInline('clearFormat');

    expect(description.summary).toBe(
      'Removes bold, italic, underline, strikethrough, inline code and marker formatting. Keeps links, superscript and subscript.'
    );
    expect(description.effect).toEqual({ clears: 'marks' });
  });

  it('convertTo has no text-mark effect and points to block conversion', () => {
    const description = describeInline('convertTo');

    expect(description.effect).toEqual({ marks: [], value: { const: true } });
    expect(description.summary).toContain('block.convert');
    expect(description.summary).toMatch(/block.*another type/i);
    expect(description.summary).not.toMatch(/clear.*format|removes?.*marks/i);
  });
});

describe('clearFormat summary boundary through the real tool', () => {
  it('keeps links and script marks while removing supported formatting', () => {
    const host = document.createElement('div');

    host.innerHTML = '<a href="https://example.test"><b>Link</b></a><sup><i>2</i></sup><sub><u>3</u></sub><code>Code</code><mark>Color</mark>';
    document.body.appendChild(host);

    try {
      const selection = window.getSelection();

      if (selection === null) {
        throw new Error('Selection must be available.');
      }

      const range = document.createRange();

      range.selectNodeContents(host);
      selection.removeAllRanges();
      selection.addRange(range);

      const config = new INLINE_CLASSES.clearFormat().render();

      if (Array.isArray(config) || !('onActivate' in config) || typeof config.onActivate !== 'function') {
        throw new Error('Clear format must expose an action item.');
      }

      config.onActivate(config);

      expect(host.innerHTML).toBe('<a href="https://example.test">Link</a><sup>2</sup><sub>3</sub>CodeColor');
    } finally {
      host.remove();
    }
  });
});
