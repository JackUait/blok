// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { htmlToSegmentsDom } from '../../../src/components/utils/rich-text-dom';
import { sanitizeBlocks } from '../../../src/components/utils/sanitizer';
import { INLINE_TEXT_SANITIZE } from '../../../src/shared/inline-text-sanitize';
import { PLAINTEXT } from '../../../src/shared/sanitize-rules';
import { segmentsToHtml } from '../../../src/shared/rich-text/segments-to-html';
import { createHeadlessPorts } from '../../../src/view/agent-runtime';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';

import type { SanitizerConfig, ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { RichText } from '../../../types/rich-text';

const rule: SanitizerConfig = { ...INLINE_TEXT_SANITIZE, u: false };
const cases: Array<{ name: string; input: RichText; expected: RichText }> = [
  { name: 'plain text', input: [{ text: 'plain' }], expected: [{ text: 'plain' }] },
  {
    name: 'bold and italic',
    input: [{ text: 'b', marks: { bold: true } }, { text: 'i', marks: { italic: true } }],
    expected: [{ text: 'b', marks: { bold: true } }, { text: 'i', marks: { italic: true } }],
  },
  { name: 'forbidden underline', input: [{ text: 'u', marks: { underline: true } }], expected: [{ text: 'u' }] },
  {
    name: 'safe link attributes',
    input: [{ text: 'link', marks: { link: { href: 'https://example.com', target: '_blank', rel: 'nofollow' } } }],
    expected: [{ text: 'link', marks: { link: { href: 'https://example.com', target: '_blank', rel: 'nofollow' } } }],
  },
  {
    name: 'unsafe link',
    input: [{ text: 'x', marks: { link: { href: 'javascript:alert(1)' } } }],
    expected: [{ text: 'x' }],
  },
  {
    name: 'highlight',
    input: [{ text: 'h', marks: { highlight: true } }],
    expected: [{ text: 'h', marks: { highlight: true } }],
  },
  {
    name: 'equation source',
    input: [{ embed: { equation: { expression: 'a < b & c' } } }],
    expected: [{ embed: { equation: { expression: 'a < b & c' } } }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless parser and editor sanitizer parity', () => {
  it('uses the real parse5 and DOM parsers for the same inline HTML', () => {
    const html = 'a <strong>b</strong><br>c';
    const ports = createHeadlessPorts({
      sanitizeFor: (): ToolSanitizerConfig => rule,
      richTextFieldsFor: () => ['text'],
    });
    const node = htmlToSegmentsNode(html);
    const editor = htmlToSegmentsDom(html);

    expect(ports.htmlToSegments(html)).toEqual(editor);
    expect(node).toEqual(editor);
    expect(node).toEqual([
      { text: 'a ' },
      { text: 'b', marks: { bold: true } },
      { text: '\nc' },
    ]);
  });

  it.each(cases)('matches the actual editor sanitizer for $name', ({ input, expected }) => {
    const [editorBlock] = sanitizeBlocks([
      { tool: 'paragraph', data: { text: segmentsToHtml(input) } },
    ], rule);

    if (editorBlock === undefined || typeof editorBlock.data.text !== 'string') {
      throw new Error('Expected one sanitized HTML text field');
    }

    const editor = htmlToSegmentsDom(editorBlock.data.text);
    const ports = createHeadlessPorts({
      sanitizeFor: (): ToolSanitizerConfig => rule,
      richTextFieldsFor: () => ['text'],
    });
    const headless = ports.sanitizeBlockData('paragraph', { text: input });

    expect(headless.text).toEqual(editor);
    expect(editor).toEqual(expected);
  });

  it('matches function-rule attribute overrides merged with global rules', () => {
    const toolRule: SanitizerConfig = {
      a: () => ({ href: true, target: '_blank', rel: 'nofollow' }),
    };
    const globalSanitizer: SanitizerConfig = { strong: true };
    const input: RichText = [
      { text: 'bold', marks: { bold: true } },
      { text: 'link', marks: { link: { href: '/page', target: '_self', rel: 'noopener' } } },
    ];
    const [editorBlock] = sanitizeBlocks([
      { tool: 'paragraph', data: { text: segmentsToHtml(input) } },
    ], toolRule, globalSanitizer);

    if (editorBlock === undefined || typeof editorBlock.data.text !== 'string') {
      throw new Error('Expected one sanitized HTML text field');
    }

    const editor = htmlToSegmentsDom(editorBlock.data.text);
    const ports = createHeadlessPorts({
      sanitizeFor: (): ToolSanitizerConfig => toolRule,
      richTextFieldsFor: () => ['text'],
      globalSanitizer,
    });

    expect(ports.sanitizeBlockData('paragraph', { text: input }).text).toEqual(editor);
    expect(editor).toEqual([
      { text: 'bold', marks: { bold: true } },
      { text: 'link', marks: { link: { href: '/page', target: '_blank', rel: 'nofollow' } } },
    ]);
  });

  it('matches typed rich-field rules and plaintext under global rules', () => {
    const toolRules: ToolSanitizerConfig = {
      text: { strong: true, a: { href: true } },
      source: PLAINTEXT,
    };
    const globalSanitizer: SanitizerConfig = { i: true };
    const text: RichText = [
      { text: 'bold', marks: { bold: true } },
      { text: 'italic', marks: { italic: true } },
      { text: 'link', marks: { link: { href: '/page', target: '_self', rel: 'noopener' } } },
    ];
    const source = 'a < b & c </tag> <a href="javascript:x">source</a>';
    const [editorBlock] = sanitizeBlocks([
      { tool: 'custom', data: { text: segmentsToHtml(text), source } },
    ], toolRules, globalSanitizer);

    if (editorBlock === undefined || typeof editorBlock.data.text !== 'string') {
      throw new Error('Expected one sanitized HTML text field');
    }

    const editor = { text: htmlToSegmentsDom(editorBlock.data.text), source: editorBlock.data.source };
    const ports = createHeadlessPorts({
      sanitizeFor: (): ToolSanitizerConfig => toolRules,
      richTextFieldsFor: () => ['text'],
      globalSanitizer,
    });

    expect(ports.sanitizeBlockData('custom', { text, source })).toEqual(editor);
    expect(editor).toEqual({
      text: [
        { text: 'bold', marks: { bold: true } },
        { text: 'italic', marks: { italic: true } },
        { text: 'link', marks: { link: { href: '/page' } } },
      ],
      source,
    });
  });
});
