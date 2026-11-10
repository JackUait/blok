import { IconTrash } from '../../../../src/components/icons';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteTune } from '../../../../src/components/block-tunes/block-tune-delete';
import { beautifyShortcut } from '../../../../src/components/utils/string';
import { announce } from '../../../../src/components/utils/announcer';
import type * as StringModule from '../../../../src/components/utils/string';
import type { API } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools/menu-config';

vi.mock('../../../../src/components/utils/announcer', () => ({ announce: vi.fn() }));

vi.mock('../../../../src/components/utils/string', async (importOriginal) => {
  const actual = await importOriginal<typeof StringModule>();

  return {
    ...actual,
    beautifyShortcut: vi.fn(actual.beautifyShortcut),
  };
});

type BlocksMocks = {
  delete: Mock<() => Promise<void>>;
  getCurrentBlockIndex: Mock<() => number>;
  getBlockByIndex: Mock<(index: number) => { id: string } | undefined>;
  getById: Mock<(id: string) => { id: string } | null>;
};

type I18nMocks = {
  t: Mock<(text: string, vars?: Record<string, string | number>) => string>;
};

const createApiMocks = (): { api: API; blocks: BlocksMocks; i18n: I18nMocks } => {
  const blocks: BlocksMocks = {
    delete: vi.fn(() => Promise.resolve()),
    getCurrentBlockIndex: vi.fn(() => 0),
    getBlockByIndex: vi.fn(() => ({ id: 'b1' })),
    getById: vi.fn(() => null),
  };

  const i18n: I18nMocks = {
    t: vi.fn((text: string, vars?: Record<string, string | number>) => (vars?.count === undefined ? text : `${text}:${vars.count}`)),
  };

  return {
    api: {
      blocks: blocks as unknown as API['blocks'],
      i18n: i18n as unknown as API['i18n'],
    } as API,
    blocks,
    i18n,
  };
};

describe('DeleteTune', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders block tune config with translated label and direct handler', () => {
    const { api, i18n } = createApiMocks();
    const tune = new DeleteTune({ api });
    const handleClickSpy = vi.spyOn(tune, 'handleClick').mockResolvedValue();

    type MenuConfigWithActivate = Extract<MenuConfig, { onActivate: unknown }>;

    const config = tune.render() as MenuConfigWithActivate;

    expect(i18n.t).toHaveBeenCalledWith('blockSettings.delete');
    expect(config.icon).toBe(IconTrash);
    expect(config.title).toBe('blockSettings.delete');
    expect(config.name).toBe('delete');
    expect(config.isDestructive).toBe(true);

    config.onActivate?.(config);

    expect(handleClickSpy).toHaveBeenCalledTimes(1);
  });

  it('routes the shortcut hint through the shared beautifyShortcut helper', () => {
    const { api } = createApiMocks();
    const tune = new DeleteTune({ api });

    const config = tune.render() as MenuConfig & { secondaryLabel?: string };

    expect(vi.mocked(beautifyShortcut)).toHaveBeenCalledWith('DELETE');
    expect(config.secondaryLabel).toBe('Del');
  });

  it('deletes current block when handler is triggered', async () => {
    const { api, blocks } = createApiMocks();
    const tune = new DeleteTune({ api });

    await tune.handleClick();

    // Verify the blocks.delete method was called with no arguments
    expect(blocks.delete).toHaveBeenCalledWith();
  });

  // Notion U104: Delete from the block menu says 1 block deleted.
  it('announces one deleted block once the block is gone', async () => {
    const { api } = createApiMocks();
    const tune = new DeleteTune({ api });

    await tune.handleClick();

    expect(vi.mocked(announce)).toHaveBeenCalledWith('a11y.blocksDeleted:1');
  });

  it('says nothing when the block is still there', async () => {
    const { api, blocks } = createApiMocks();
    const tune = new DeleteTune({ api });

    blocks.getById.mockReturnValue({ id: 'b1' });
    await tune.handleClick();

    expect(vi.mocked(announce)).not.toHaveBeenCalled();
  });
});
