import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CopyLinkTune } from '../../../../src/components/block-tunes/block-tune-copy-link';
import type { API, BlockAPI } from '../../../../types';

/**
 * Mutation coverage for CopyLinkTune.
 *
 * Two mechanics make the recorded mutants observable:
 *
 * 1. The shortcut guard `metaKey && ctrlKey && code === 'KeyL' && selected`
 *    only shows its shape under combinations that are FALSE today. Each
 *    negative test below flips exactly the sub-terms that one boolean mutant
 *    would rewrite to true, so a rewrite fires the clipboard write that the
 *    original refuses. A positive control sits next to them, otherwise a
 *    listener that never attached would pass every negative test vacuously.
 * 2. `handleClick` calls `navigator.clipboard.writeText` synchronously — the
 *    call expression is evaluated before the `await` suspends — so the spy is
 *    already settled the moment `dispatchEvent` returns. No tick needed.
 *
 * The notifier assertions compare the WHOLE payload, not `objectContaining`
 * a style: the i18n key is what the string mutants blank out, and a partial
 * match cannot see it.
 *
 * All seven recorded mutants are killable; no equivalent mutants in this file.
 */
type NotifierMock = { show: Mock<(options: Record<string, unknown>) => void> };
type I18nMock = { t: Mock<(key: string) => string> };

type Harness = {
  api: API;
  notifier: NotifierMock;
  i18n: I18nMock;
  writeText: Mock<(text: string) => Promise<void>>;
};

describe('CopyLinkTune mutants', () => {
  const openTunes: CopyLinkTune[] = [];

  const createHarness = ({ clipboardFails = false }: { clipboardFails?: boolean } = {}): Harness => {
    const notifier: NotifierMock = { show: vi.fn() };
    const i18n: I18nMock = { t: vi.fn((key: string) => key) };
    const writeText: Mock<(text: string) => Promise<void>> = clipboardFails
      ? vi.fn(() => Promise.reject(new Error('denied')))
      : vi.fn(() => Promise.resolve());

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const api = {
      notifier: notifier as unknown as API['notifier'],
      i18n: i18n as unknown as API['i18n'],
      readOnly: { isEnabled: false } as unknown as API['readOnly'],
    } as API;

    return { api,
      notifier,
      i18n,
      writeText };
  };

  const createTune = (api: API, selected: boolean): CopyLinkTune => {
    const block = { id: 'abc123XYZ0',
      selected } as unknown as BlockAPI;
    const tune = new CopyLinkTune({ api,
      block });

    openTunes.push(tune);

    return tune;
  };

  const pressShortcut = (init: KeyboardEventInit): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', init));
  };

  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com/page' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // A surviving listener answers the next test's keydown and hides a mutant.
    while (openTunes.length > 0) {
      openTunes.pop()?.destroy();
    }

    vi.restoreAllMocks();
  });

  it('copies on the full Ctrl+Cmd+L combo while the block is selected', () => {
    const { api, writeText } = createHarness();

    createTune(api, true);

    pressShortcut({ metaKey: true,
      ctrlKey: true,
      code: 'KeyL' });

    expect(writeText).toHaveBeenCalledWith('https://example.com/page#abc123XYZ0');
  });

  it('ignores a bare key press on a selected block', () => {
    const { api, writeText } = createHarness();

    createTune(api, true);

    pressShortcut({ metaKey: false,
      ctrlKey: false,
      code: 'KeyA' });

    expect(writeText).not.toHaveBeenCalled();
  });

  it('ignores Ctrl+Cmd on a key other than L', () => {
    const { api, writeText } = createHarness();

    createTune(api, true);

    pressShortcut({ metaKey: true,
      ctrlKey: true,
      code: 'KeyA' });

    expect(writeText).not.toHaveBeenCalled();
  });

  it('ignores an unmodified L on a selected block', () => {
    const { api, writeText } = createHarness();

    createTune(api, true);

    pressShortcut({ metaKey: false,
      ctrlKey: false,
      code: 'KeyL' });

    expect(writeText).not.toHaveBeenCalled();
  });

  it('ignores Cmd+L when Ctrl is not held', () => {
    const { api, writeText } = createHarness();

    createTune(api, true);

    pressShortcut({ metaKey: true,
      ctrlKey: false,
      code: 'KeyL' });

    expect(writeText).not.toHaveBeenCalled();
  });

  it('ignores Ctrl+L when Cmd is not held', () => {
    const { api, writeText } = createHarness();

    createTune(api, true);

    pressShortcut({ metaKey: false,
      ctrlKey: true,
      code: 'KeyL' });

    expect(writeText).not.toHaveBeenCalled();
  });

  it('notifies success with the copyLinkSuccess translation key', async () => {
    const { api, notifier, i18n } = createHarness();
    const tune = createTune(api, false);

    await tune.handleClick();

    expect(i18n.t).toHaveBeenCalledWith('blockSettings.copyLinkSuccess');
    expect(notifier.show).toHaveBeenCalledWith({
      message: 'blockSettings.copyLinkSuccess',
      style: 'success',
      time: 2000,
    });
  });

  it('notifies failure with the copyLinkError translation key', async () => {
    const { api, notifier, i18n } = createHarness({ clipboardFails: true });
    const tune = createTune(api, false);

    await tune.handleClick();

    expect(i18n.t).toHaveBeenCalledWith('blockSettings.copyLinkError');
    expect(notifier.show).toHaveBeenCalledWith({
      message: 'blockSettings.copyLinkError',
      style: 'error',
      time: 3000,
    });
  });
});
