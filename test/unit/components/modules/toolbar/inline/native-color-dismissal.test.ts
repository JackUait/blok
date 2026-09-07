import { fireEvent, getByRole, queryByAttribute } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkerInlineTool } from '../../../../../../src/components/inline-tools/inline-tool-marker';
import { InlineKeyboardHandler } from '../../../../../../src/components/modules/toolbar/inline/keyboard-handler';
import { Notifier } from '../../../../../../src/components/utils/notifier/index';
import { PopoverInline } from '../../../../../../src/components/utils/popover/popover-inline';
import type { API } from '../../../../../../types';
import type { I18n } from '../../../../../../types/api';

const i18n: I18n = {
  t: (key) => key,
  has: () => true,
  getEnglishTranslation: (key) => key,
  getLocale: () => 'en',
};
const cleanup: Array<() => void> = [];

const openMarker = async (): Promise<PopoverInline> => {
  const editor = document.createElement('div');

  editor.contentEditable = 'true';
  editor.textContent = 'Keep this selection';
  document.body.appendChild(editor);
  const range = document.createRange();

  range.selectNodeContents(editor);
  window.getSelection()?.addRange(range);
  const api = { i18n, inlineToolbar: { close: vi.fn() } } as unknown as API;
  const config = new MarkerInlineTool({ api }).render();
  const popover = new PopoverInline({ items: Array.isArray(config) ? config : [config] });
  const handler = new InlineKeyboardHandler(() => popover, () => popover.hide());
  const onKeyDown = (event: KeyboardEvent): void => handler.handle(event, popover.isShown);

  window.addEventListener('keydown', onKeyDown, true);
  cleanup.push(() => window.removeEventListener('keydown', onKeyDown, true));
  cleanup.push(() => popover.destroy());
  popover.show();
  await Promise.resolve();
  const marker = queryByAttribute('data-blok-item-name', popover.getElement(), 'marker');

  if (marker === null) {
    throw new Error('Missing marker opener');
  }
  fireEvent.click(marker);
  await Promise.resolve();

  return popover;
};

describe('native inline color Escape dismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup.splice(0).reverse().forEach((dispose) => dispose());
    fireEvent.keyDown(document, { key: 'Escape' });
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each(['before', 'after'] as const)('dismisses a toast opened %s the marker before closing the native submenu', async (order) => {
    if (order === 'before') {
      Notifier.show({ message: 'Saved' });
    }
    const popover = await openMarker();

    if (order === 'after') {
      Notifier.show({ message: 'Saved' });
    }
    const tab = getByRole(popover.getElement(), 'tab', { name: 'tools.marker.textColor' });
    const toast = queryByAttribute('data-blok-testid', document.body, 'notification');

    expect(tab).toHaveFocus();
    fireEvent.keyDown(tab, { key: 'Escape' });

    expect(popover.hasNestedPopoverOpen).toBe(true);
    expect(toast).toHaveAttribute('data-state', 'closed');
    expect(popover.isShown).toBe(true);
    expect(tab).toHaveFocus();

    fireEvent.keyDown(tab, { key: 'Escape' });
    expect(popover.hasNestedPopoverOpen).toBe(false);
    expect(popover.isShown).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Keep this selection');
  });

  it('closes a triggerless native marker when no higher dismissal layer exists', async () => {
    const popover = await openMarker();
    const tab = getByRole(popover.getElement(), 'tab', { name: 'tools.marker.textColor' });

    fireEvent.keyDown(tab, { key: 'Escape' });
    expect(popover.hasNestedPopoverOpen).toBe(false);
    expect(popover.isShown).toBe(true);
    expect(window.getSelection()?.toString()).toBe('Keep this selection');
  });
});
