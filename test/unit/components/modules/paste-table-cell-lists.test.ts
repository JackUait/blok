/**
 * Regression: lists inside pasted table cells must survive the paste
 * sanitizer INCLUDING their metadata — <ul>/<ol>/<li> structure, the
 * aria-level / data-list-style stamps the paste pre-pass adds (nesting depth
 * and ordered context), list-style-type styles, and checkbox inputs
 * (checklist state). Losing any of these silently flattens cell lists
 * (root cause of "pasted table loses bullet points").
 */
import { describe, expect, it, vi } from 'vitest';

import { Paste } from '../../../../src/components/modules/paste';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import { Table } from '../../../../src/tools/table';

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

const createPaste = (): { paste: Paste; mocks: PasteMocks } => {
  const listeners = { on: vi.fn(), off: vi.fn() };
  const mocks: PasteMocks = {
    BlockManager: {
      currentBlock: null,
      paste: vi.fn(),
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
  (paste as unknown as { listeners: typeof listeners }).listeners = listeners;

  return { paste, mocks };
};

const pasteTable = async (html: string): Promise<HTMLElement> => {
  const { paste, mocks } = createPaste();

  const tableTool = {
    name: 'table',
    pasteConfig: Table.pasteConfig,
    baseSanitizeConfig: {},
    hasOnPasteHandler: true,
  } as unknown as BlockToolAdapter;

  mocks.Tools.defaultTool = {
    name: 'paragraph',
    pasteConfig: {},
    baseSanitizeConfig: {},
  } as unknown as BlockToolAdapter;

  mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);
  mocks.Tools.blockTools.set('table', tableTool);

  await paste.prepare();

  mocks.BlockManager.currentBlock = { tool: { isDefault: true }, isEmpty: true };
  mocks.BlockManager.paste.mockReturnValue({ id: 'table-block' });

  await paste.processText(html, true);

  expect(mocks.BlockManager.paste).toHaveBeenCalled();

  const [, event] = mocks.BlockManager.paste.mock.calls[0];

  return (event.detail as { data: HTMLElement }).data;
};

describe('table paste: lists inside cells survive sanitization', () => {
  it('keeps ul/ol/li structure inside cells', async () => {
    const data = await pasteTable(
      '<table><tr><td><ul><li>alpha</li><li>beta</li></ul></td><td><ol><li>one</li></ol></td></tr></table>'
    );

    expect(data.querySelectorAll('td')[0].querySelectorAll('ul > li')).toHaveLength(2);
    expect(data.querySelectorAll('td')[1].querySelectorAll('ol > li')).toHaveLength(1);
  });

  it('keeps the aria-level depth stamp and list-style metadata on li', async () => {
    const data = await pasteTable(
      '<table><tr><td>'
      + '<ul><li>root<ul><li>nested</li></ul></li></ul>'
      + '</td></tr></table>'
    );

    // The paste pre-pass stamps aria-level on every li BEFORE sanitization;
    // the table sanitize pass must not strip it — it carries nesting depth.
    const items = Array.from(data.querySelectorAll('li'));
    const levels = items.map(li => li.getAttribute('aria-level'));

    expect(levels).toEqual(['1', '2']);
  });

  it('keeps data-list-style stamped on ordered items', async () => {
    const data = await pasteTable(
      '<table><tr><td><ol><li>one</li></ol></td></tr></table>'
    );

    expect(data.querySelector('li')?.getAttribute('data-list-style')).toBe('ordered');
  });

  it('keeps checkbox inputs (checklist state) inside cells', async () => {
    const data = await pasteTable(
      '<table><tr><td><ul><li><input type="checkbox" checked>done</li></ul></td></tr></table>'
    );

    const input = data.querySelector('input');

    expect(input).not.toBeNull();
    expect(input?.getAttribute('type')).toBe('checkbox');
    expect(input?.hasAttribute('checked')).toBe(true);
  });
});
