import { IconCopy } from '../../../../src/components/icons';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyLinkTune } from '../../../../src/components/block-tunes/block-tune-copy-link';
import type { API, BlockAPI } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools/menu-config';

type MenuConfigItem = Extract<MenuConfig, { onActivate: unknown }>;

type NotifierMocks = {
  show: Mock<(options: Record<string, unknown>) => void>;
};

type I18nMocks = {
  t: Mock<(text: string) => string>;
};

const createMocks = (): { api: API; block: BlockAPI; notifier: NotifierMocks; i18n: I18nMocks } => {
  const notifier: NotifierMocks = { show: vi.fn() };
  const i18n: I18nMocks = { t: vi.fn((text: string) => text) };

  return {
    api: {
      notifier: notifier as unknown as API['notifier'],
      i18n: i18n as unknown as API['i18n'],
    } as API,
    block: { id: 'abc123XYZ0' } as unknown as BlockAPI,
    notifier,
    i18n,
  };
};

describe('CopyLinkTune', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is marked as a tune', () => {
    expect(CopyLinkTune.isTune).toBe(true);
  });

  it('renders block tune config with translated label and copy icon', () => {
    const { api, block, i18n } = createMocks();
    const tune = new CopyLinkTune({ api, block });

    const config = tune.render() as MenuConfigItem;

    expect(i18n.t).toHaveBeenCalledWith('blockSettings.copyLink');
    expect(config.icon).toBe(IconCopy);
    expect(config.title).toBe('blockSettings.copyLink');
    expect(config.name).toBe('copy-link');
    expect(config.isDestructive).toBeUndefined();
  });

  it('copies the correct URL to clipboard and shows success notification when activated', async () => {
    const { api, block, notifier } = createMocks();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    // Simulate being on a page with a hash already present — only the base URL should be used
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/page#oldHash' },
      writable: true,
    });

    const tune = new CopyLinkTune({ api, block });
    const config = tune.render() as MenuConfigItem;

    await config.onActivate?.(config);

    expect(writeTextMock).toHaveBeenCalledWith('https://example.com/page#abc123XYZ0');
    expect(notifier.show).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'success' })
    );
  });

  it('shows error notification when clipboard write fails', async () => {
    const { api, block, notifier } = createMocks();
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Permission denied'));

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    const tune = new CopyLinkTune({ api, block });
    const config = tune.render() as MenuConfigItem;

    await config.onActivate?.(config);

    expect(notifier.show).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'error' })
    );
  });
});
