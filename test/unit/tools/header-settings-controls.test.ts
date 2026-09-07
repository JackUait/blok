import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header, type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import type { API, BlockAPI } from '../../../types';
import type { MenuConfigItem } from '../../../types/tools';
import { PopoverDesktop } from '../../../src/components/utils/popover';

const popovers: PopoverDesktop[] = [];

const createHeader = (data: Partial<HeaderData> = {}, config: HeaderConfig = {}): Header => {
  const api = {
    styles: { block: 'blok-block' },
    i18n: { t: (key: string) => key, has: () => false },
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    blocks: { getChildren: () => [] },
  } as unknown as API;

  const block = { id: 'header', dispatchChange: vi.fn() } as unknown as BlockAPI;

  return new Header({ api, block, config, readOnly: false, data: { text: 'Section', level: 2, ...data } });
};

const settingsItems = (header: Header): MenuConfigItem[] => {
  const settings = header.renderSettings();

  return Array.isArray(settings) ? settings : [settings];
};

const activateLevel = (header: Header, level: number): void => {
  const entry = settingsItems(header).find(candidate => 'dataset' in candidate && candidate.dataset?.['blok-header-level'] === String(level));

  if (!entry || !('onActivate' in entry) || !entry.onActivate) {
    throw new Error('Missing heading setting');
  }
  entry.onActivate(entry);
};

describe('Header settings controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    popovers.splice(0).forEach(popover => popover.destroy());
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('keeps the stored anchor and live text when changing level through settings', () => {
    const header = createHeader({ anchor: 'section-original', textColor: 'red', backgroundColor: 'blue' });
    const element = header.render();

    document.body.append(element);
    element.innerHTML = '<b>Edited section</b>';
    activateLevel(header, 3);

    expect(header.save(element)).toEqual({
      text: '<b>Edited section</b>',
      level: 3,
      anchor: 'section-original',
      textColor: 'red',
      backgroundColor: 'blue',
    });
    expect(document.body.querySelector('h3')?.id).toBe('section-original');
  });

  it('exposes only configured levels as direct named controls with the current level selected', () => {
    const header = createHeader({}, { levels: [1, 2, 4] });
    const popover = new PopoverDesktop({ items: settingsItems(header) });

    popovers.push(popover);
    popover.show();
    const controls = Array.from(popover.getElement().querySelectorAll<HTMLElement>('[role="menuitemradio"]'));

    expect(controls.map(control => control.getAttribute('data-blok-header-level'))).toEqual(['1', '2', '4']);
    expect(controls.map(control => control.textContent?.trim())).toEqual(['Heading 1', 'Heading 2', 'Heading 4']);
    expect(controls.map(control => control.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    document.body.append(header.render());
    controls[2].click();
    expect(header.save(document.body).level).toBe(4);
  });

  it('keeps level settings searchable without falling back to block conversion', () => {
    const header = createHeader({ anchor: 'search-anchor' });

    document.body.append(header.render());
    const popover = new PopoverDesktop({ items: settingsItems(header), searchable: true });

    popovers.push(popover);
    popover.show();
    const input = popover.getElement().querySelector('input');

    if (!input) {
      throw new Error('Missing settings search');
    }
    input.value = 'Heading 3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const level = popover.getElement().querySelector<HTMLElement>('[data-blok-header-level="3"]');

    expect(level?.closest('[data-blok-hidden="true"]')).toBeNull();
    level?.click();
    expect(header.save(document.body)).toEqual({ text: 'Section', level: 3, anchor: 'search-anchor' });
  });

  it('retains collapsed toggle state and children while using a direct level control', () => {
    const header = createHeader({ isToggleable: true, isOpen: false, anchor: 'toggle-anchor' });
    const wrapper = header.render();
    const children = wrapper.querySelector('[data-blok-nested-blocks]');
    const child = document.createElement('p');

    child.textContent = 'Nested content';
    children?.append(child);
    document.body.append(wrapper);
    activateLevel(header, 1);

    expect(header.save(wrapper)).toEqual({
      text: 'Section', level: 1, isToggleable: true, isOpen: false, anchor: 'toggle-anchor',
    });
    expect(wrapper.querySelector('[data-blok-nested-blocks]')?.firstChild).toBe(child);
    expect(wrapper.querySelector('h1')?.getAttribute('data-blok-toggle-open')).toBe('false');
  });
});
