import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PatternHandler } from '../../../../../src/components/modules/paste/handlers/pattern-handler';
import { CHECK_EMBED_TIMEOUT_MS } from '../../../../../src/tools/link/check-embed';
import type { LinkPasteMenu, PasteMenuOpenParams } from '../../../../../src/tools/link/paste-menu/controller';
import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { HandlerContext } from '../../../../../src/components/modules/paste/types';

type Verdict = 'allowed' | 'blocked' | 'insecure' | 'unknown';

const GENERIC_URL = 'https://dash.example.org/q3';
const REGISTRY_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const pasteMock = vi.fn();
const notifyMock = vi.fn();
const state: { menu: PasteMenuOpenParams | null; holder: HTMLElement | null } = { menu: null, holder: null };

const createBlok = (): BlokModules => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  state.holder = holder;

  return {
    BlockManager: {
      paste: pasteMock.mockResolvedValue({ id: 'b1' }),
      insert: vi.fn().mockReturnValue({ id: 'link1', holder, dispatchChange: vi.fn() }),
      currentBlock: { holder: document.createElement('div'), dispatchChange: vi.fn() },
      setCurrentBlockByChildNode: vi.fn(),
      beginToolTransaction: vi.fn(),
      endToolTransaction: vi.fn(),
    },
    Caret: { setToBlock: vi.fn(), positions: { END: 'end' }, insertContentAtCaretPosition: vi.fn() },
    I18n: { t: (key: string): string => key },
    NotifierAPI: { show: notifyMock },
  } as unknown as BlokModules;
};

const registry = {
  findToolForPattern: (): unknown => ({ key: 'bookmark', pattern: /https?:\/\/\S+/, tool: { name: 'bookmark' } }),
} as unknown as ToolRegistry;

const menu: LinkPasteMenu = {
  open: (params: PasteMenuOpenParams): void => {
    state.menu = params;
  },
};

const context: HandlerContext = { canReplaceCurrentBlock: true, currentBlock: undefined };

const pickEmbed = async (url: string, linkPaste: NonNullable<BlokConfig['linkPaste']>): Promise<void> => {
  const handler = new PatternHandler(createBlok(), registry, {} as SanitizerConfigBuilder, { linkPaste }, menu);

  await handler.handle(url, context);
  state.menu?.onSelect('embed');
  await vi.advanceTimersByTimeAsync(CHECK_EMBED_TIMEOUT_MS + 10);
};

const insertedTool = (): unknown => pasteMock.mock.calls[0]?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  state.menu = null;
});

afterEach(() => {
  state.holder?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PatternHandler — the host frame check before a generic embed', () => {
  it.each<Verdict>(['blocked', 'insecure'])('inserts a bookmark with a notice on %s', async (verdict) => {
    const checkEmbed = vi.fn(async () => ({ verdict }));

    await pickEmbed(GENERIC_URL, { allowGenericEmbed: true, checkEmbed });

    expect(checkEmbed).toHaveBeenCalledTimes(1);
    expect(checkEmbed).toHaveBeenCalledWith(GENERIC_URL);
    expect(pasteMock).toHaveBeenCalledTimes(1);
    expect(insertedTool()).toBe('bookmark');
    expect(notifyMock).toHaveBeenCalledWith({ message: 'tools.embed.checkBlocked' });
  });

  it.each<Verdict>(['allowed', 'unknown'])('inserts the embed on %s', async (verdict) => {
    await pickEmbed(GENERIC_URL, { allowGenericEmbed: true, checkEmbed: async () => ({ verdict }) });

    expect(insertedTool()).toBe('embed');
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('inserts the embed when the check fails or never answers', async () => {
    await pickEmbed(GENERIC_URL, { allowGenericEmbed: true, checkEmbed: () => Promise.reject(new Error('down')) });
    expect(insertedTool()).toBe('embed');

    pasteMock.mockClear();
    await pickEmbed(GENERIC_URL, { allowGenericEmbed: true, checkEmbed: () => new Promise(() => undefined) });
    expect(insertedTool()).toBe('embed');
  });

  it('never asks about a registry provider', async () => {
    const checkEmbed = vi.fn(async () => ({ verdict: 'blocked' as const }));

    await pickEmbed(REGISTRY_URL, { checkEmbed });

    expect(checkEmbed).not.toHaveBeenCalled();
    expect(insertedTool()).toBe('embed');
  });

  it('inserts nothing when the link block is gone by the time the check answers', async () => {
    const checkEmbed = vi.fn(async () => {
      state.holder?.remove();

      return { verdict: 'blocked' as const };
    });

    await pickEmbed(GENERIC_URL, { allowGenericEmbed: true, checkEmbed });

    expect(pasteMock).not.toHaveBeenCalled();
  });

});
