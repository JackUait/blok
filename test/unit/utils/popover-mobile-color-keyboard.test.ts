import { fireEvent, getAllByRole, getByRole } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlockColorTunes } from '../../../src/components/shared/block-color';
import { PopoverMobile } from '../../../src/components/utils/popover/popover-mobile';
import type { I18n } from '../../../types/api';

const translations: Record<string, string> = {
  'toolNames.marker': 'Color',
  'tools.marker.textColor': 'Text color',
  'tools.marker.background': 'Background',
};
const i18n: I18n = {
  t: (key) => translations[key] ?? key,
  has: (key) => key in translations,
  getEnglishTranslation: (key) => translations[key] ?? '',
  getLocale: () => 'en',
};
let popover: PopoverMobile | undefined;

const openColors = async (): Promise<PopoverMobile> => {
  const trigger = document.createElement('button');

  trigger.textContent = 'Settings';
  document.body.appendChild(trigger);
  trigger.focus();
  const config = buildBlockColorTunes({ data: {}, i18n, onPick: vi.fn() });

  popover = new PopoverMobile({
    trigger,
    items: [
      ...(Array.isArray(config) ? config : [config]),
      { title: 'Duplicate', onActivate: vi.fn() },
      { title: 'More', children: { items: [{ title: 'Nested action', onActivate: vi.fn() }] } },
    ],
  });
  popover.show();
  fireEvent.click(getByRole(popover.getElement(), 'menuitem', { name: 'Color' }));
  await Promise.resolve();

  return popover;
};

describe('PopoverMobile native color keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popover?.destroy();
    popover = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('leaves Left and Right arrows to the native color tabs', async () => {
    const menu = await openColors();
    const textTab = getByRole(menu.getElement(), 'tab', { name: 'Text color' });

    textTab.focus();
    fireEvent.keyDown(textTab, { key: 'ArrowRight' });
    const backgroundTab = getByRole(menu.getElement(), 'tab', { name: 'Background' });

    expect(backgroundTab).toHaveFocus();
    expect(backgroundTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(backgroundTab, { key: 'ArrowLeft' });
    expect(textTab).toHaveFocus();
    expect(textTab).toHaveAttribute('aria-selected', 'true');
    expect(getByRole(menu.getElement(), 'button', { name: 'Back' })).toBeInTheDocument();
    expect(fireEvent.keyDown(textTab, { key: 'Tab' })).toBe(true);
  });

  it('runs the native child open hook to focus its selected tab', async () => {
    const menu = await openColors();

    expect(getByRole(menu.getElement(), 'tab', { name: 'Text color', selected: true })).toHaveFocus();
  });

  it('restores menu arrows after Back and keeps Left navigation for ordinary children', async () => {
    const menu = await openColors();

    fireEvent.click(getByRole(menu.getElement(), 'button', { name: 'Back' }));
    const root = getByRole(menu.getElement(), 'menu');

    getAllByRole(root, 'menuitem').forEach((item) => {
      Object.defineProperty(item, 'scrollIntoView', { value: vi.fn(), configurable: true });
    });
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    expect(root).toHaveAttribute(
      'aria-activedescendant',
      getByRole(root, 'menuitem', { name: 'Duplicate' }).id
    );
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(getByRole(menu.getElement(), 'menuitem', { name: 'Nested action' })).toBeInTheDocument();
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    expect(getByRole(menu.getElement(), 'menuitem', { name: 'Color' })).toBeInTheDocument();
  });

  it('lets Escape dismiss the mobile color sheet and restore its trigger', async () => {
    const menu = await openColors();
    const tab = getByRole(menu.getElement(), 'tab', { name: 'Text color' });

    tab.focus();
    fireEvent.keyDown(tab, { key: 'Escape' });
    expect(menu.isShown).toBe(false);
    expect(getByRole(document.body, 'button', { name: 'Settings' })).toHaveFocus();
  });
});
