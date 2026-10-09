// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { htmlToSegmentsDom } from '../../../src/components/utils/rich-text-dom';
import { sanitizeBlocks } from '../../../src/components/utils/sanitizer';
import { segmentsToHtml } from '../../../src/shared/rich-text/segments-to-html';
import { createHeadlessPorts } from '../../../src/view/agent-runtime';

import type { ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { RichText } from '../../../types/rich-text';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless page-reference sanitizer parity', () => {
  it('keeps a page embed under an allowed anchor attribute map without changing the rule', () => {
    const page: RichText = [{ embed: { page: { id: 'page-1' } } }];
    const rules: ToolSanitizerConfig = { text: { a: { href: true } } };
    const before: ToolSanitizerConfig = { text: { a: { href: true } } };
    const ports = createHeadlessPorts({
      sanitizeFor: () => rules,
      richTextFieldsFor: () => ['text'],
    });
    const headless = ports.sanitizeBlockData('paragraph', { text: page });

    expect(headless.text).toEqual([{ embed: { page: { id: 'page-1' } } }]);
    expect(rules).toEqual(before);

    const [editorBlock] = sanitizeBlocks([
      { tool: 'paragraph', data: { text: segmentsToHtml(page) } },
    ], rules);

    if (editorBlock === undefined || typeof editorBlock.data.text !== 'string') {
      throw new Error('Expected one sanitized HTML text field');
    }

    const editor = htmlToSegmentsDom(editorBlock.data.text);

    expect(headless.text).toEqual(editor);
    expect(editor).toEqual([{ embed: { page: { id: 'page-1' } } }]);
  });

  it('does not preserve a page embed when anchors are denied', () => {
    const page: RichText = [{ embed: { page: { id: 'page-1' } } }];
    const rules: ToolSanitizerConfig = { text: { a: false } };
    const ports = createHeadlessPorts({
      sanitizeFor: () => rules,
      richTextFieldsFor: () => ['text'],
    });
    const headless = ports.sanitizeBlockData('paragraph', { text: page });

    expect(headless.text).toEqual([{ text: 'Page' }]);

    const [editorBlock] = sanitizeBlocks([
      { tool: 'paragraph', data: { text: segmentsToHtml(page) } },
    ], rules);

    if (editorBlock === undefined || typeof editorBlock.data.text !== 'string') {
      throw new Error('Expected one sanitized HTML text field');
    }

    const editor = htmlToSegmentsDom(editorBlock.data.text);

    expect(headless.text).toEqual(editor);
    expect(editor).toEqual([{ text: 'Page' }]);
  });
});
