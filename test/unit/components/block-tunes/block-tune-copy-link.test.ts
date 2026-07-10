import { IconLink } from '../../../../src/components/icons';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyLinkTune } from '../../../../src/components/block-tunes/block-tune-copy-link';
import type * as BrowserModule from '../../../../src/components/utils/browser';

const osState = vi.hoisted(() => ({
  os: { win: false, mac: true, x11: false, linux: false } as Record<string, boolean>,
}));

vi.mock('../../../../src/components/utils/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof BrowserModule>();

  return {
    ...actual,
    getUserOS: (): Record<string, boolean> => osState.os,
  };
});
import type { API, BlockAPI } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools/menu-config';

type MenuConfigItem = Extract<MenuConfig, { onActivate: unknown }>;

type NotifierMocks = {
  show: Mock<(options: Record<string, unknown>) => void>;
};

type I18nMocks = {
  t: Mock<(text: string) => string>;
};

const createMocks = (
  { readOnly = false }: { readOnly?: boolean } = {}
): { api: API; block: BlockAPI; notifier: NotifierMocks; i18n: I18nMocks } => {
  const notifier: NotifierMocks = { show: vi.fn() };
  const i18n: I18nMocks = { t: vi.fn((text: string) => text) };

  return {
    api: {
      notifier: notifier as unknown as API['notifier'],
      i18n: i18n as unknown as API['i18n'],
      readOnly: { isEnabled: readOnly } as unknown as API['readOnly'],
    } as API,
    block: { id: 'abc123XYZ0' } as unknown as BlockAPI,
    notifier,
    i18n,
  };
};

describe('CopyLinkTune', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    osState.os = { win: false, mac: true, x11: false, linux: false };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is marked as a tune', () => {
    expect(CopyLinkTune.isTune).toBe(true);
  });

  it('renders block tune config with translated label and link icon', () => {
    const { api, block, i18n } = createMocks();
    const tune = new CopyLinkTune({ api, block });

    const config = tune.render() as MenuConfigItem;

    expect(i18n.t).toHaveBeenCalledWith('blockSettings.copyLink');
    expect(config.icon).toBe(IconLink);
    expect(config.title).toBe('blockSettings.copyLink');
    expect(config.name).toBe('copy-link');
    expect(config.isDestructive).toBeUndefined();
  });

  it('renders the ⌃ + ⌘ + L shortcut hint on mac via beautifyShortcut', () => {
    osState.os = { win: false, mac: true, x11: false, linux: false };

    const { api, block } = createMocks();
    const tune = new CopyLinkTune({ api, block });

    const config = tune.render() as MenuConfigItem;

    expect((config as { secondaryLabel?: string }).secondaryLabel).toBe('⌃ + ⌘ + L');
  });

  it('does not show mac-only glyphs in the shortcut hint on Windows', () => {
    osState.os = { win: true, mac: false, x11: false, linux: false };

    const { api, block } = createMocks();
    const tune = new CopyLinkTune({ api, block });

    const config = tune.render() as MenuConfigItem;
    const label = (config as { secondaryLabel?: string }).secondaryLabel ?? '';

    expect(label).not.toContain('⌃');
    expect(label).not.toContain('⌘');
    expect(label).toBe('Ctrl + Win + L');
  });

  it('omits the shortcut hint in read-only mode', () => {
    const { api, block } = createMocks({ readOnly: true });
    const tune = new CopyLinkTune({ api, block });

    const config = tune.render() as MenuConfigItem;

    expect((config as { secondaryLabel?: string }).secondaryLabel).toBeUndefined();
    expect(config.title).toBe('blockSettings.copyLink');
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

  it('triggers handleClick via Cmd+Ctrl+L keydown when the block is focused', async () => {
    const { api, block, notifier } = createMocks();
    const focusedBlock = { ...block, selected: true } as unknown as BlockAPI;
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/' },
      writable: true,
    });

    const _tune = new CopyLinkTune({ api, block: focusedBlock });

    const event = new KeyboardEvent('keydown', { metaKey: true, ctrlKey: true, code: 'KeyL' });

    document.dispatchEvent(event);

    // Give async handleClick a tick to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notifier.show).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'success' })
    );
  });

  it('percent-encodes the block id when it contains URL-unsafe characters', async () => {
    const { api, notifier } = createMocks();
    const blockWithUnsafeId = { id: 'Hello World & More' } as unknown as BlockAPI;
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/page' },
      writable: true,
    });

    const tune = new CopyLinkTune({ api, block: blockWithUnsafeId });
    const config = tune.render() as MenuConfigItem;

    await config.onActivate?.(config);

    expect(writeTextMock).toHaveBeenCalledWith(
      'https://example.com/page#Hello%20World%20%26%20More'
    );

    void notifier;
  });

  it('does not alter a valid nanoid block id in the URL', async () => {
    const { api, block } = createMocks(); // block.id = 'abc123XYZ0'
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/' },
      writable: true,
    });

    const tune = new CopyLinkTune({ api, block });
    const config = tune.render() as MenuConfigItem;

    await config.onActivate?.(config);

    // nanoid chars are all URL-safe — encodeURIComponent must not alter them
    expect(writeTextMock).toHaveBeenCalledWith('https://example.com/#abc123XYZ0');
  });

  it('does not trigger handleClick via Cmd+Ctrl+L when block is not focused', async () => {
    const { api, block, notifier } = createMocks();
    const unfocusedBlock = { ...block, selected: false } as unknown as BlockAPI;

    const _tune = new CopyLinkTune({ api, block: unfocusedBlock });

    const event = new KeyboardEvent('keydown', { metaKey: true, ctrlKey: true, code: 'KeyL' });

    document.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notifier.show).not.toHaveBeenCalled();
  });

  it('removes the Cmd+Ctrl+L keydown listener when destroy() is called', async () => {
    const { api, block, notifier } = createMocks();
    const focusedBlock = { ...block, selected: true } as unknown as BlockAPI;
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    const tune = new CopyLinkTune({ api, block: focusedBlock });

    tune.destroy();

    const event = new KeyboardEvent('keydown', { metaKey: true, ctrlKey: true, code: 'KeyL' });

    document.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notifier.show).not.toHaveBeenCalled();
  });
});
