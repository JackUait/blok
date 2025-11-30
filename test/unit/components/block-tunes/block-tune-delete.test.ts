import { IconCross } from '../../../../src/components/icons';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DeleteTune from '../../../../src/components/block-tunes/block-tune-delete';
import type { API } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools/menu-config';

type BlocksMocks = {
  delete: Mock<() => void>;
};

type I18nMocks = {
  t: Mock<(text: string) => string>;
};

const createApiMocks = (): { api: API; blocks: BlocksMocks; i18n: I18nMocks } => {
  const blocks: BlocksMocks = {
    delete: vi.fn(),
  };

  const i18n: I18nMocks = {
    t: vi.fn((text: string) => text),
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders block tune config with translated labels and confirmation handler', () => {
    const { api, i18n } = createApiMocks();
    const tune = new DeleteTune({ api });
    const handleClickSpy = vi.spyOn(tune, 'handleClick').mockImplementation(() => {});

    type MenuConfigWithConfirmation = Extract<MenuConfig, { confirmation: unknown }>;

    const config = tune.render() as MenuConfigWithConfirmation;

    expect(i18n.t).toHaveBeenNthCalledWith(1, 'Delete');
    expect(i18n.t).toHaveBeenNthCalledWith(2, 'Click to delete');
    expect(config.icon).toBe(IconCross);
    expect(config.title).toBe('Delete');
    expect(config.name).toBe('delete');
    expect(config.confirmation?.title).toBe('Click to delete');

    config.confirmation?.onActivate?.(config);

    expect(handleClickSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes current block when handler is triggered', () => {
    const { api, blocks } = createApiMocks();
    const tune = new DeleteTune({ api });

    tune.handleClick();

    expect(blocks.delete).toHaveBeenCalledTimes(1);
  });
});
