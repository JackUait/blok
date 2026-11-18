import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header, type HeaderConfig, type HeaderData } from '../../../src/tools/header';
import type { API, BlockAPI } from '../../../types';
import type { MenuConfigItem } from '../../../types/tools';
import { PopoverDesktop } from '../../../src/components/utils/popover';
import { createMemoryViewState } from '../../helpers/view-state';

const popovers: PopoverDesktop[] = [];

const createHeader = (data: Partial<HeaderData> = {}, config: HeaderConfig = {}): Header => {
  const api = {
    styles: { block: 'blok-block' },
    i18n: { t: (key: string) => key, has: () => false },
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    blocks: { getChildren: () => [] },
    viewState: createMemoryViewState(),
  } as unknown as API;

  const block = { id: 'header', dispatchChange: vi.fn() } as unknown as BlockAPI;

  return new Header({ api, block, config, readOnly: false, data: { text: 'Section', level: 2, ...data } });
};

const settingsItems = (header: Header): MenuConfigItem[] => {
  const settings = header.renderSettings();

  return Array.isArray(settings) ? settings : [settings];
};

const activateLevel = (header: Header, level: number): void => {
  header.data = { ...header.data, level };
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

  it('keeps the stored anchor and live text when the level changes', () => {
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

  it.each([false, true])('shows Color alone, with no level controls (toggleable: %s)', (isToggleable) => {
    const header = createHeader({ isToggleable }, { levels: [1, 3, 6] });
    const popover = new PopoverDesktop({ items: settingsItems(header) });

    popovers.push(popover);
    popover.show();
    const root = popover.getElement();

    expect(root.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0);
    expect(root.querySelectorAll('[role="separator"]')).toHaveLength(0);
    expect(Array.from(root.querySelectorAll('[data-blok-item-name]'), item => item.getAttribute('data-blok-item-name'))).toEqual(['block-color']);
  });

  it('retains collapsed toggle state and children when the level changes', () => {
    const header = createHeader({ isToggleable: true, anchor: 'toggle-anchor' });
    const wrapper = header.render();
    const children = wrapper.querySelector('[data-blok-nested-blocks]');
    const child = document.createElement('p');

    child.textContent = 'Nested content';
    children?.append(child);
    document.body.append(wrapper);
    activateLevel(header, 1);

    expect(header.save(wrapper)).toEqual({
      text: 'Section', level: 1, isToggleable: true, anchor: 'toggle-anchor',
    });
    expect(wrapper.querySelector('[data-blok-nested-blocks]')?.firstChild).toBe(child);
    expect(wrapper.querySelector('h1')?.getAttribute('data-blok-toggle-open')).toBe('false');
  });
});
