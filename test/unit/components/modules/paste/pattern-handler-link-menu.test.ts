import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PatternHandler } from '../../../../../src/components/modules/paste/handlers/pattern-handler';
import type { LinkPasteMenu, PasteMenuOpenParams } from '../../../../../src/tools/link/paste-menu/controller';
import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { HandlerContext } from '../../../../../src/components/modules/paste/types';

/**
 * The opt-in paste menu intercepts a URL paste before the auto-claim path.
 * These tests pin the gating decision (menu vs auto-insert), not the popover UI.
 */
describe('PatternHandler — link paste menu gating', () => {
  const pasteMock = vi.fn();
  const insertMock = vi.fn();
  let menuOpen: PasteMenuOpenParams | null = null;

  const makeLinkHolder = (): HTMLElement => {
    const holder = document.createElement('div');
    const anchor = document.createElement('a');

    anchor.href = 'https://example.com/article';
    anchor.textContent = 'https://example.com/article';
    holder.appendChild(anchor);

    return holder;
  };

  const createBlok = (): BlokModules =>
    ({
      BlockManager: {
        paste: pasteMock.mockResolvedValue({ id: 'b1' }),
        insert: insertMock.mockReturnValue({ id: 'link1', holder: makeLinkHolder() }),
        currentBlock: { holder: document.createElement('div') },
        setCurrentBlockByChildNode: vi.fn(),
      },
      Caret: {
        setToBlock: vi.fn(),
        positions: { END: 'end' },
        insertContentAtCaretPosition: vi.fn(),
      },
      I18n: { t: (key: string): string => key },
    }) as unknown as BlokModules;

  const createRegistry = (): ToolRegistry =>
    ({
      findToolForPattern: vi.fn().mockReturnValue({
        key: 'bookmark',
        pattern: /https?:\/\/\S+/,
        tool: { name: 'bookmark' },
      }),
    }) as unknown as ToolRegistry;

  const fakeMenu: LinkPasteMenu = {
    open: vi.fn((params: PasteMenuOpenParams) => {
      menuOpen = params;
    }),
  };

  const sanitizerBuilder = {} as unknown as SanitizerConfigBuilder;

  const context: HandlerContext = {
    canReplaceCurrentBlock: true,
    currentBlock: undefined,
  };

  const makeHandler = (config: BlokConfig): PatternHandler =>
    new PatternHandler(createBlok(), createRegistry(), sanitizerBuilder, config, fakeMenu);

  beforeEach(() => {
    vi.clearAllMocks();
    menuOpen = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the menu instead of auto-inserting when linkPaste.menu is on', async () => {
    const handler = makeHandler({ linkPaste: { menu: true } });

    const handled = await handler.handle('https://example.com/article', context);

    expect(handled).toBe(true);
    expect(fakeMenu.open).toHaveBeenCalledTimes(1);
    expect(menuOpen?.url).toBe('https://example.com/article');
    expect(pasteMock).not.toHaveBeenCalled();
  });

  it('inserts the link immediately so it stays visible while the menu is open', async () => {
    const handler = makeHandler({ linkPaste: { menu: true } });

    await handler.handle('https://example.com/article', context);

    // The link is shown the moment the menu opens (Notion-style), not deferred to a pick.
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0][0] as { data: { text: string }; replace?: boolean };

    expect(inserted.data.text).toContain('href="https://example.com/article"');
    expect(inserted.replace).toBe(true);
  });

  it('keeps the already-shown link without re-inserting when dismissed', async () => {
    const handler = makeHandler({ linkPaste: { menu: true } });

    await handler.handle('https://example.com/article', context);
    expect(insertMock).toHaveBeenCalledTimes(1);

    menuOpen?.onDismiss();

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(pasteMock).not.toHaveBeenCalled();
  });

  it('keeps the already-shown link without re-inserting when Plain is chosen', async () => {
    const handler = makeHandler({ linkPaste: { menu: true } });

    await handler.handle('https://example.com/article', context);
    expect(insertMock).toHaveBeenCalledTimes(1);

    menuOpen?.onSelect('plain');
    await Promise.resolve();

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(pasteMock).not.toHaveBeenCalled();
  });

  it('auto-inserts (no menu) when linkPaste.menu is off', async () => {
    const handler = makeHandler({});

    const handled = await handler.handle('https://example.com/article', context);

    expect(handled).toBe(true);
    expect(fakeMenu.open).not.toHaveBeenCalled();
    expect(pasteMock).toHaveBeenCalledTimes(1);
  });

  it('auto-inserts even with menu on when the matched text is not an http URL', async () => {
    const handler = makeHandler({ linkPaste: { menu: true } });

    const handled = await handler.handle('ftp://nope', context);

    expect(handled).toBe(true);
    expect(fakeMenu.open).not.toHaveBeenCalled();
    expect(pasteMock).toHaveBeenCalledTimes(1);
  });

  it('routes the bookmark choice through a forced pattern paste', async () => {
    const handler = makeHandler({ linkPaste: { menu: true } });

    await handler.handle('https://example.com/article', context);
    menuOpen?.onSelect('bookmark');
    await Promise.resolve();

    expect(pasteMock).toHaveBeenCalledTimes(1);
    expect(pasteMock.mock.calls[0][0]).toBe('bookmark');
  });
});
