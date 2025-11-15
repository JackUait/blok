import { IconChevronUp } from '@codexteam/icons';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MoveUpTune from '../../../../src/components/block-tunes/block-tune-move-up';
import type { API } from '../../../../types';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

type BlocksMocks = {
  getCurrentBlockIndex: Mock<[], number>;
  getBlockByIndex: Mock<[number], { holder: HTMLElement } | undefined>;
  move: Mock<[number], void>;
};

type ToolbarMocks = {
  toggleBlockSettings: Mock<[boolean], void>;
};

type I18nMocks = {
  t: Mock<[string], string>;
};

const createApiMocks = (): {
  api: API;
  blocks: BlocksMocks;
  toolbar: ToolbarMocks;
  i18n: I18nMocks;
} => {
  const blocks: BlocksMocks = {
    getCurrentBlockIndex: vi.fn<[], number>().mockReturnValue(0),
    getBlockByIndex: vi.fn<[number], { holder: HTMLElement } | undefined>(),
    move: vi.fn<[number], void>(),
  };

  const toolbar: ToolbarMocks = {
    toggleBlockSettings: vi.fn<[boolean], void>(),
  };

  const i18n: I18nMocks = {
    t: vi.fn<[string], string>().mockImplementation((text) => text),
  };

  const api = {
    blocks: blocks as unknown as API['blocks'],
    toolbar: toolbar as unknown as API['toolbar'],
    i18n: i18n as unknown as API['i18n'],
  } as unknown as API;

  return {
    api,
    blocks,
    toolbar,
    i18n,
  };
};

const createBlockElement = (top: number, height: number): HTMLDivElement => {
  const element = document.createElement('div');

  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    top,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);

  return element;
};

describe('MoveUpTune', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders block tune config with translated title and handler', () => {
    const { api, i18n } = createApiMocks();
    const tune = new MoveUpTune({ api });
    const handleClickSpy = vi.spyOn(tune, 'handleClick').mockImplementation(() => {});

    const config = tune.render() as PopoverItemDefaultBaseParams;

    expect(i18n.t).toHaveBeenCalledWith('Move up');
    expect(config.icon).toBe(IconChevronUp);
    expect(config.title).toBe('Move up');
    expect(config.name).toBe('move-up');

    config.onActivate(config);

    expect(handleClickSpy).toHaveBeenCalledTimes(1);
  });

  it('moves the block up and scrolls relative to blocks when previous block is visible', () => {
    const { api, blocks, toolbar } = createApiMocks();
    const tune = new MoveUpTune({ api });

    blocks.getCurrentBlockIndex.mockReturnValue(2);

    const currentBlockElement = createBlockElement(500, 180);
    const previousBlockElement = createBlockElement(200, 160);

    blocks.getBlockByIndex.mockImplementation((index) => {
      if (index === 2) {
        return { holder: currentBlockElement };
      }

      if (index === 1) {
        return { holder: previousBlockElement };
      }

      return undefined;
    });

    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    tune.handleClick();

    expect(blocks.getBlockByIndex).toHaveBeenCalledWith(1);
    expect(scrollBySpy).toHaveBeenCalledWith(0, -(Math.abs(500) - Math.abs(200)));
    expect(blocks.move).toHaveBeenCalledWith(1);
    expect(toolbar.toggleBlockSettings).toHaveBeenCalledWith(true);
  });

  it('moves the block up and scrolls by delta when previous block is above the viewport', () => {
    const { api, blocks, toolbar } = createApiMocks();
    const tune = new MoveUpTune({ api });

    blocks.getCurrentBlockIndex.mockReturnValue(3);

    const currentBlockElement = createBlockElement(400, 160);
    const previousBlockElement = createBlockElement(-150, 120);

    blocks.getBlockByIndex.mockImplementation((index) => {
      if (index === 3) {
        return { holder: currentBlockElement };
      }

      if (index === 2) {
        return { holder: previousBlockElement };
      }

      return undefined;
    });

    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    tune.handleClick();

    expect(blocks.getBlockByIndex).toHaveBeenCalledWith(2);
    expect(scrollBySpy).toHaveBeenCalledWith(0, -(Math.abs(400) + 120));
    expect(blocks.move).toHaveBeenCalledWith(2);
    expect(toolbar.toggleBlockSettings).toHaveBeenCalledWith(true);
  });

  it('throws when block is already the first or previous block is missing', () => {
    const { api, blocks, toolbar } = createApiMocks();
    const tune = new MoveUpTune({ api });

    blocks.getCurrentBlockIndex.mockReturnValue(0);
    blocks.getBlockByIndex.mockReturnValue(undefined);

    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    expect(() => tune.handleClick()).toThrowError(
      'Unable to move Block up since it is already the first'
    );
    expect(blocks.move).not.toHaveBeenCalled();
    expect(toolbar.toggleBlockSettings).not.toHaveBeenCalled();
    expect(scrollBySpy).not.toHaveBeenCalled();
  });
});

