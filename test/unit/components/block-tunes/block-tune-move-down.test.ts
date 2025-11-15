import { IconChevronDown } from '@codexteam/icons';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MoveDownTune from '../../../../src/components/block-tunes/block-tune-move-down';
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

  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    value: height,
  });

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

describe('MoveDownTune', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders block tune config with translated title and handler', () => {
    const { api, i18n } = createApiMocks();
    const tune = new MoveDownTune({ api });
    const handleClickSpy = vi.spyOn(tune, 'handleClick').mockImplementation(() => {});

    const config = tune.render() as PopoverItemDefaultBaseParams;

    expect(i18n.t).toHaveBeenCalledWith('Move down');
    expect(config.icon).toBe(IconChevronDown);
    expect(config.title).toBe('Move down');
    expect(config.name).toBe('move-down');

    config.onActivate(config);

    expect(handleClickSpy).toHaveBeenCalledTimes(1);
  });

  it('moves the block down and scrolls relative to current position when next block is visible', () => {
    const { api, blocks, toolbar } = createApiMocks();
    const tune = new MoveDownTune({ api });

    blocks.getCurrentBlockIndex.mockReturnValue(2);

    const nextBlockElement = createBlockElement(400, 180);

    blocks.getBlockByIndex.mockReturnValue({
      holder: nextBlockElement,
    });

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(150);

    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    tune.handleClick();

    expect(blocks.getBlockByIndex).toHaveBeenCalledWith(3);
    expect(scrollToSpy).toHaveBeenCalledWith(0, 330);
    expect(blocks.move).toHaveBeenCalledWith(3);
    expect(toolbar.toggleBlockSettings).toHaveBeenCalledWith(true);
  });

  it('moves the block down and scrolls by viewport delta when next block is below the fold', () => {
    const { api, blocks, toolbar } = createApiMocks();
    const tune = new MoveDownTune({ api });

    blocks.getCurrentBlockIndex.mockReturnValue(0);

    const nextBlockElement = createBlockElement(1_000, 200);

    blocks.getBlockByIndex.mockReturnValue({
      holder: nextBlockElement,
    });

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(50);

    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    tune.handleClick();

    expect(blocks.getBlockByIndex).toHaveBeenCalledWith(1);
    expect(scrollToSpy).toHaveBeenCalledWith(0, 400);
    expect(blocks.move).toHaveBeenCalledWith(1);
    expect(toolbar.toggleBlockSettings).toHaveBeenCalledWith(true);
  });

  it('throws when there is no block below the current one', () => {
    const { api, blocks, toolbar } = createApiMocks();
    const tune = new MoveDownTune({ api });

    blocks.getCurrentBlockIndex.mockReturnValue(5);
    blocks.getBlockByIndex.mockReturnValue(undefined);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    expect(() => tune.handleClick()).toThrowError('Unable to move Block down since it is already the last');
    expect(blocks.move).not.toHaveBeenCalled();
    expect(toolbar.toggleBlockSettings).not.toHaveBeenCalled();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

