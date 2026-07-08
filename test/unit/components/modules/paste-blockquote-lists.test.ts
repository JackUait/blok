/**
 * Regression: lists inside a pasted <blockquote> must not flatten.
 *
 * Quote is a LEAF tool — its onPaste stores `content.innerHTML` as rich text
 * and its sanitize config keeps only inline tags (br/b/i/a/mark). Before the
 * blockquote split pre-pass, a pasted `<blockquote>` carrying a `<ul>` (GFM
 * `> - item`, Notion quotes with nested bullets, any web page) kept the list
 * only until save, where the quote sanitizer mashed it into bare text
 * ("Wise wordsalphabeta") — the same container-flatten disease as pasted
 * table cells (db4c243d), in a different container.
 *
 * The pre-pass splits block-level lists out of blockquotes in document order:
 * quote(lead) → list items → quote(rest). These tests drive the real Paste
 * module with the real Quote/List pasteConfigs and assert what each tool's
 * onPaste receives.
 */
import { describe, expect, it, vi } from 'vitest';

import { Paste } from '../../../../src/components/modules/paste';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import { ListItem } from '../../../../src/tools/list';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Quote } from '../../../../src/tools/quote';

interface PasteMocks {
  BlockManager: {
    currentBlock: { tool: { isDefault: boolean }; isEmpty: boolean } | null;
    paste: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
    setBlockParent: ReturnType<typeof vi.fn>;
  };
  Caret: { positions: { END: string }; setToBlock: ReturnType<typeof vi.fn>; insertContentAtCaretPosition: ReturnType<typeof vi.fn> };
  Tools: {
    blockTools: Map<string, BlockToolAdapter>;
    defaultTool: BlockToolAdapter;
    getAllInlineToolsSanitizeConfig: ReturnType<typeof vi.fn>;
  };
  Toolbar: { close: ReturnType<typeof vi.fn>; moveAndOpen: ReturnType<typeof vi.fn> };
  UI: { nodes: { holder: HTMLElement; redactor: HTMLElement }; isMobile: boolean };
  ReadOnly: { isEnabled: boolean };
}

interface ToolCall {
  tool: string;
  html: string;
}

const pasteHtml = async (html: string): Promise<ToolCall[]> => {
  const mocks: PasteMocks = {
    BlockManager: {
      currentBlock: { tool: { isDefault: true }, isEmpty: true },
      paste: vi.fn().mockReturnValue({ id: 'block-id' }),
      insert: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      setBlockParent: vi.fn(),
    },
    Caret: { positions: { END: 'end' }, setToBlock: vi.fn(), insertContentAtCaretPosition: vi.fn() },
    Tools: {
      blockTools: new Map<string, BlockToolAdapter>(),
      defaultTool: null as unknown as BlockToolAdapter,
      getAllInlineToolsSanitizeConfig: vi.fn(() => ({})),
    },
    Toolbar: { close: vi.fn(), moveAndOpen: vi.fn() },
    UI: { nodes: { holder: document.createElement('div'), redactor: document.createElement('div') }, isMobile: false },
    ReadOnly: { isEnabled: false },
  };

  const paste = new Paste({
    config: { defaultBlock: 'paragraph' },
    eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  } as unknown as ConstructorParameters<typeof Paste>[0]);

  (paste as unknown as { Blok: PasteMocks }).Blok = mocks;
  (paste as unknown as { listeners: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } }).listeners = { on: vi.fn(), off: vi.fn() };

  // The real Paragraph pasteConfig registers the P tag — that registration is
  // what previously made blockquotes with <p> children descend into loose
  // paragraphs (containsAnotherToolTags), so the harness must carry it.
  mocks.Tools.defaultTool = {
    name: 'paragraph',
    pasteConfig: Paragraph.pasteConfig,
    baseSanitizeConfig: {},
    hasOnPasteHandler: true,
  } as unknown as BlockToolAdapter;
  mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);
  mocks.Tools.blockTools.set('quote', {
    name: 'quote',
    pasteConfig: Quote.pasteConfig,
    baseSanitizeConfig: {},
    hasOnPasteHandler: true,
  } as unknown as BlockToolAdapter);
  mocks.Tools.blockTools.set('list', {
    name: 'list',
    pasteConfig: ListItem.pasteConfig,
    baseSanitizeConfig: {},
    hasOnPasteHandler: true,
  } as unknown as BlockToolAdapter);

  await paste.prepare();
  await paste.processText(html, true);

  return mocks.BlockManager.paste.mock.calls.map(([tool, event]) => ({
    tool: typeof tool === 'string' ? tool : (tool as { name: string }).name,
    html: ((event as CustomEvent).detail as { data: HTMLElement }).data.outerHTML,
  }));
};

describe('paste: lists inside blockquotes are split out instead of flattened', () => {
  it('splits a trailing list out of the quote and keeps the quote lead', async () => {
    const calls = await pasteHtml(
      '<blockquote><p>Wise words</p><ul><li>alpha</li><li>beta</li></ul></blockquote>'
    );

    expect(calls.map((call) => call.tool)).toEqual(['quote', 'list', 'list']);
    expect(calls[0].html).toContain('Wise words');
    expect(calls[0].html).not.toContain('<ul');
    expect(calls[1].html).toContain('alpha');
    expect(calls[2].html).toContain('beta');
  });

  it('preserves document order when the list sits mid-quote', async () => {
    const calls = await pasteHtml(
      '<blockquote><p>lead</p><ol><li>one</li></ol><p>tail</p></blockquote>'
    );

    expect(calls.map((call) => call.tool)).toEqual(['quote', 'list', 'quote']);
    expect(calls[0].html).toContain('lead');
    expect(calls[1].html).toContain('one');
    expect(calls[1].html).toContain('data-list-style="ordered"');
    expect(calls[2].html).toContain('tail');
  });

  it('emits no empty quote when the blockquote contains only a list', async () => {
    const calls = await pasteHtml(
      '<blockquote><ul><li>only</li></ul></blockquote>'
    );

    expect(calls.map((call) => call.tool)).toEqual(['list']);
    expect(calls[0].html).toContain('only');
  });

  it('keeps a paragraph-wrapped quote as ONE quote block (Notion/GDocs shape)', async () => {
    // <p> children previously tripped containsAnotherToolTags, so the
    // blockquote descended into loose paragraphs and lost quote-ness.
    const calls = await pasteHtml('<blockquote><p>only</p></blockquote>');

    expect(calls.map((call) => call.tool)).toEqual(['quote']);
    expect(calls[0].html).toContain('only');
    expect(calls[0].html).not.toContain('<p>');
  });

  it('joins multi-paragraph quotes with <br> inside a single quote block', async () => {
    const calls = await pasteHtml('<blockquote><p>first</p><p>second</p></blockquote>');

    expect(calls.map((call) => call.tool)).toEqual(['quote']);
    expect(calls[0].html).toContain('first<br>second');
  });

  it('splits the list AND keeps both quote fragments as quote blocks', async () => {
    const calls = await pasteHtml(
      '<blockquote><p>lead</p><ul><li>item</li></ul><p>tail</p></blockquote>'
    );

    expect(calls.map((call) => call.tool)).toEqual(['quote', 'list', 'quote']);
    expect(calls[0].html).toContain('lead');
    expect(calls[2].html).toContain('tail');
  });

  it('preserves nesting depth stamps on lists hoisted out of blockquotes', async () => {
    const calls = await pasteHtml(
      '<blockquote><p>q</p><ul><li>root<ul><li>nested</li></ul></li></ul></blockquote>'
    );

    const listCalls = calls.filter((call) => call.tool === 'list');
    const levels = listCalls.map((call) => /aria-level="(\d)"/.exec(call.html)?.[1]);

    expect(levels).toEqual(['1', '2']);
  });
});
