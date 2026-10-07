import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INLINE_TEXT_SANITIZE } from '../../../../src/components/shared/inline-content-sanitize';
import { LinkInlineTool } from '../../../../src/components/inline-tools/inline-tool-link';
import { Paste } from '../../../../src/components/modules/paste';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import { clean, sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import { Header } from '../../../../src/tools/header';
import { ListItem } from '../../../../src/tools/list';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Quote } from '../../../../src/tools/quote';
import { Table } from '../../../../src/tools/table';
import { buildClipboardHtml, parseClipboardHtml, parseGenericHtmlTable } from '../../../../src/tools/table/table-cell-clipboard';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { SanitizerConfig } from '../../../../types';
import { htmlToBlocks } from '../../../../src/view/html-to-blocks';
import { sanitizeHtmlFragment } from '../../../../src/view/sanitize';

const pasteWithPageTool = async (
  html: string,
  entry: 'clipboard' | 'processText',
  sanitizer: SanitizerConfig = {}
): Promise<Array<{ tool: string; html: string }>> => {
  const pasted: Array<{ tool: string; html: string }> = [];
  const paragraph = {
    name: 'paragraph',
    pasteConfig: Paragraph.pasteConfig,
    baseSanitizeConfig: {},
    hasOnPasteHandler: true,
    isDefault: true,
  } as unknown as BlockToolAdapter;
  const page = {
    name: 'page',
    pasteConfig: false,
    baseSanitizeConfig: {},
    hasOnPasteHandler: false,
  } as unknown as BlockToolAdapter;
  const paste = new Paste({
    config: { defaultBlock: 'paragraph', sanitizer },
    eventsDispatcher: { on: vi.fn(), off: vi.fn() },
  } as unknown as ConstructorParameters<typeof Paste>[0]);

  paste.state = {
    BlockManager: {
      currentBlock: null,
      paste: vi.fn((tool: string, event: CustomEvent<{ data: HTMLElement }>) => {
        pasted.push({ tool, html: event.detail.data.innerHTML });

        return { id: `b${pasted.length}`, parentId: null };
      }),
      insert: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      setBlockParent: vi.fn(),
    },
    Caret: {
      positions: { END: 'end' },
      setToBlock: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
    },
    Tools: {
      blockTools: new Map<string, BlockToolAdapter>([['paragraph', paragraph], ['page', page]]),
      defaultTool: paragraph,
      getAllInlineToolsSanitizeConfig: () => ({}),
    },
    Toolbar: { close: vi.fn(), moveAndOpen: vi.fn() },
    YjsManager: { stopCapturing: vi.fn() },
    DragManager: { isDragging: false },
    UI: { nodes: { holder: document.createElement('div') } },
  } as unknown as BlokModules;

  await paste.prepare();

  if (entry === 'clipboard') {
    const data = { 'text/html': html, 'text/plain': '' };

    await paste.processDataTransfer({
      getData: (format: string): string => data[format as keyof typeof data] ?? '',
      types: Object.keys(data),
      files: [],
    } as unknown as DataTransfer);
  } else {
    await paste.processText(html, true);
  }

  return pasted;
};

describe('inline page-reference mark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const staleReference = '<a data-blok-page-id="p1" href="https://example.test/old-title" title="Old title" target="_blank" rel="nofollow"><strong>Old title</strong></a>';
  const savedReference = '<a data-blok-page-id="p1">Page</a>';

  it('keeps the target ID but not a stale URL or title in the editor sanitizer', () => {
    expect(clean(staleReference, INLINE_TEXT_SANITIZE)).toBe(savedReference);
  });

  it('keeps the target ID but not a stale URL or title in the view sanitizer', () => {
    expect(sanitizeHtmlFragment(staleReference, INLINE_TEXT_SANITIZE)).toBe(savedReference);
  });

  it('keeps ordinary URL links in both sanitizers', () => {
    const ordinaryLink = '<a href="https://example.test" target="_blank" rel="nofollow">Site</a>';

    expect(clean(ordinaryLink, INLINE_TEXT_SANITIZE)).toBe(ordinaryLink);
    expect(sanitizeHtmlFragment(ordinaryLink, INLINE_TEXT_SANITIZE)).toBe(ordinaryLink);
  });

  it('keeps the page ID when a host overrides the anchor sanitizer', () => {
    const [block] = sanitizeBlocks(
      [{ tool: 'paragraph', data: { text: staleReference } }],
      Paragraph.sanitize,
      { a: { href: true } }
    );

    expect(block?.data.text).toBe(savedReference);
  });

  it('still applies a host anchor override to ordinary links', () => {
    const [block] = sanitizeBlocks(
      [{ tool: 'paragraph', data: { text: '<a href="https://example.test" target="_blank">Site</a>' } }],
      Paragraph.sanitize,
      { a: { href: true } }
    );

    expect(block?.data.text).toBe('<a href="https://example.test">Site</a>');
  });

  it('keeps two adjacent references to the same page through save and view sanitization', () => {
    const adjacent = `${savedReference}${savedReference}`;
    const [block] = sanitizeBlocks([{ tool: 'paragraph', data: { text: adjacent } }], Paragraph.sanitize);

    expect(block?.data.text).toBe(adjacent);
    expect(sanitizeHtmlFragment(adjacent, INLINE_TEXT_SANITIZE)).toBe(adjacent);
  });

  it('does not treat an empty page ID as a page reference', () => {
    const emptyReference = '<a data-blok-page-id="" href="https://example.test">Site</a>';
    const ordinaryLink = '<a href="https://example.test">Site</a>';

    expect(clean(emptyReference, INLINE_TEXT_SANITIZE)).toBe(ordinaryLink);
    expect(sanitizeHtmlFragment(emptyReference, INLINE_TEXT_SANITIZE)).toBe(ordinaryLink);
  });

  it('saves a paragraph text field with only the page ID and neutral label', () => {
    const [block] = sanitizeBlocks(
      [{ tool: 'paragraph', data: { text: staleReference } }],
      Paragraph.sanitize
    );

    expect(block?.data.text).toBe(savedReference);
  });

  it('imports a page reference into a paragraph without stale metadata', () => {
    const [block] = htmlToBlocks(`<p>See ${staleReference}</p>`);

    expect(block?.data.text).toEqual([{ text: 'See ' }, { embed: { page: { id: 'p1' } } }]);
  });

  it('keeps the ID through the Link inline tool sanitizer', () => {
    expect(clean(staleReference, LinkInlineTool.sanitize)).toBe(savedReference);
  });

  it.each([
    ['header', Header.sanitize],
    ['toggle', ToggleItem.sanitize],
    ['list', ListItem.sanitize],
    ['quote', Quote.sanitize],
  ])('saves a %s text field with only the page ID and neutral label', (tool, config) => {
    const [block] = sanitizeBlocks([{ tool, data: { text: staleReference } }], config);

    expect(block?.data.text).toBe(savedReference);
  });

  it('saves a legacy table-cell HTML string with only the page ID and neutral label', () => {
    const [block] = sanitizeBlocks([{ tool: 'table', data: { content: [[staleReference]] } }], Table.sanitize);
    const content = block?.data.content as string[][] | undefined;

    expect(content?.[0]?.[0]).toBe(savedReference);
  });

  it('keeps the ID in generic pasted table-cell HTML', () => {
    const payload = parseGenericHtmlTable(`<table><tr><td>${staleReference}</td></tr></table>`);

    expect(payload?.cells[0]?.[0]?.blocks[0]?.data.text).toBe(savedReference);
  });

  it('keeps the ID in a pasted table-cell child block', () => {
    const html = buildClipboardHtml({
      rows: 1,
      cols: 1,
      cells: [[{ blocks: [{ tool: 'paragraph', data: { text: staleReference } }] }]],
    });
    const payload = parseClipboardHtml(html, () => Paragraph.sanitize as SanitizerConfig);

    expect(payload?.cells[0]?.[0]?.blocks[0]?.data.text).toBe(savedReference);
  });

  it.each(['clipboard', 'processText'] as const)('keeps a page reference through %s paste without the Link inline tool', async (entry) => {
    const pasted = await pasteWithPageTool(`<p>See ${staleReference}</p>`, entry);
    const [saved] = sanitizeBlocks([{ tool: 'paragraph', data: { text: pasted[0]?.html } }], Paragraph.sanitize);

    expect(pasted).toEqual([{ tool: 'paragraph', html: `See ${savedReference}` }]);
    expect(saved?.data.text).toBe(`See ${savedReference}`);
  });

  it('keeps a page reference through paste when a host overrides the anchor sanitizer', async () => {
    const pasted = await pasteWithPageTool(`<p>${staleReference}</p>`, 'clipboard', { a: { href: true } });

    expect(pasted).toEqual([{ tool: 'paragraph', html: savedReference }]);
  });

  it('keeps two adjacent references to the same page through paste', async () => {
    const adjacent = `${savedReference}${savedReference}`;
    const pasted = await pasteWithPageTool(`<p>${adjacent}</p>`, 'clipboard');

    expect(pasted).toEqual([{ tool: 'paragraph', html: adjacent }]);
  });

  it.each(['clipboard', 'processText'] as const)('keeps an empty page-reference anchor through %s paste', async (entry) => {
    const pasted = await pasteWithPageTool('<p><a data-blok-page-id="p1"></a></p>', entry);

    expect(pasted).toEqual([{ tool: 'paragraph', html: savedReference }]);
  });

  it('does not substitute an ordinary pasted link into a page block', async () => {
    const pasted = await pasteWithPageTool('<p><a href="https://example.test">Site</a></p>', 'clipboard');

    expect(pasted).toEqual([{ tool: 'paragraph', html: '<a href="https://example.test">Site</a>' }]);
  });
});
