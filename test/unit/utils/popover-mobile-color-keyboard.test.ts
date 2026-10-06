import { fireEvent, getAllByRole, getByRole, queryByRole } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlockColorTunes } from '../../../src/components/shared/block-color';
import { PopoverMobile } from '../../../src/components/utils/popover/popover-mobile';
import type { I18n } from '../../../types/api';

const translations: Record<string, string> = {
  'toolNames.marker': 'Color',
  'tools.marker.textColor': 'Text color',
  'tools.marker.background': 'Background',
  'tools.marker.default': 'Default',
  'tools.colorPicker.defaultSwatchLabel': '{default} {mode}',
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

  it('shows both color groups and leaves swatch keys to the native picker', async () => {
    const menu = await openColors();
    const textGroup = getByRole(menu.getElement(), 'group', { name: 'Text color' });
    const backgroundGroup = getByRole(menu.getElement(), 'group', { name: 'Background' });
    const textSwatch = getByRole(textGroup, 'button', { name: 'Default text color' });

    expect(getByRole(backgroundGroup, 'button', { name: 'Default background' })).toBeInTheDocument();
    expect(queryByRole(menu.getElement(), 'tablist')).toBeNull();
    textSwatch.focus();
    expect(fireEvent.keyDown(textSwatch, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(textSwatch, { key: 'ArrowLeft' })).toBe(true);
    expect(textSwatch).toHaveFocus();
    expect(getByRole(menu.getElement(), 'button', { name: 'Back' })).toBeInTheDocument();
    expect(fireEvent.keyDown(textSwatch, { key: 'Tab' })).toBe(true);
  });

  it('runs the native child open hook to focus the active text swatch', async () => {
    const menu = await openColors();

    expect(getByRole(menu.getElement(), 'button', { name: 'Default text color', pressed: true })).toHaveFocus();
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
    const swatch = getByRole(menu.getElement(), 'button', { name: 'Default text color' });

    swatch.focus();
    fireEvent.keyDown(swatch, { key: 'Escape' });
    expect(menu.isShown).toBe(false);
    expect(getByRole(document.body, 'button', { name: 'Settings' })).toHaveFocus();
  });
});
