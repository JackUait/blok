/**
 * A toggle carries Notion-style block colour like a paragraph or heading:
 * kept in data, painted on its title, offered in its settings menu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { API } from '../../../../types';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { ToggleItemData } from '../../../../src/tools/toggle/types';
import { colorVarName } from '../../../../src/components/shared/color-presets';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';

const createApi = (): API => ({
  i18n: { t: (key: string) => key, has: () => false },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    getChildren: vi.fn().mockReturnValue([]),
    getBlocksCount: vi.fn().mockReturnValue(1),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
  },
} as unknown as API);

const dispatchChange = vi.fn();

const createToggle = (data: Partial<ToggleItemData>): ToggleItem => new ToggleItem({
  data: { text: 'Title', ...data },
  config: {},
  api: createApi(),
  readOnly: false,
  block: { id: 't', dispatchChange } as never,
});

const titleOf = (element: HTMLElement): HTMLElement => {
  const title = element.querySelector<HTMLElement>(`[${TOGGLE_ATTR.toggleContent}]`);

  if (title === null) {
    throw new Error('toggle has no title');
  }

  return title;
};

describe('toggle block colour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves the colour it was given', () => {
    const toggle = createToggle({ textColor: 'red', backgroundColor: 'blue' });

    toggle.render();

    expect(toggle.save()).toEqual({ text: 'Title', isOpen: true, textColor: 'red', backgroundColor: 'blue' });
  });

  it('saves no colour keys when it has none', () => {
    const toggle = createToggle({});

    toggle.render();

    expect(toggle.save()).toEqual({ text: 'Title', isOpen: true });
  });

  it('paints the colour on its title', () => {
    const title = titleOf(createToggle({ textColor: 'red', backgroundColor: 'blue' }).render());

    expect(title.style.getPropertyValue('color')).toBe(colorVarName('red', 'text'));
    expect(title.style.getPropertyValue('background-color')).toBe(colorVarName('blue', 'bg'));
  });

  it('declares the colour fields in its sanitize config', () => {
    expect(ToggleItem.sanitize).toHaveProperty('textColor', false);
    expect(ToggleItem.sanitize).toHaveProperty('backgroundColor', false);
  });

  it('offers the block colour menu in its settings', () => {
    const settings = createToggle({}).renderSettings();
    const items = Array.isArray(settings) ? settings : [settings];

    expect(items.some(item => 'name' in item && item.name === 'block-color')).toBe(true);
  });

  it('repaints and saves the new colour after setData (undo/redo)', () => {
    const toggle = createToggle({ backgroundColor: 'blue' });
    const title = titleOf(toggle.render());

    toggle.setData({ text: 'Title', textColor: 'green' });

    expect(title.style.getPropertyValue('color')).toBe(colorVarName('green', 'text'));
    expect(title.style.getPropertyValue('background-color')).toBe('');
    expect(toggle.save()).toEqual({ text: 'Title', isOpen: true, textColor: 'green' });
  });
});
