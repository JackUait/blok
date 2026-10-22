import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabasePropertyMenu } from '../../../../src/tools/database/database-property-menu';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const property: PropertyDefinition = { id: 'p', name: 'Amount', type: 'select', position: 'a1', config: { options: [] } };

const arrowDown = (target: EventTarget): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
};

const highlighted = (): Element | null => document.querySelector('[data-blok-popover-opened] [data-blok-focused="true"]');

/** The collapsed description field is not a keyboard stop; the open one is. */
describe('property description: ArrowDown from the name, on the real menu', () => {
  const cb = { onRename: vi.fn(), onUpdate: vi.fn(), onOptionsChange: vi.fn(), onChangeType: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };
  let menu: DatabasePropertyMenu | null = null;

  const open = (): { input: HTMLInputElement; info: HTMLButtonElement; area: HTMLTextAreaElement } => {
    const anchor = document.createElement('button');

    document.body.appendChild(anchor);
    menu = new DatabasePropertyMenu({ i18n: { t: (k: string) => k, getLocale: () => 'en' } as never, hasPeople: false, ...cb });
    menu.open(property, anchor);
    const input = document.querySelector<HTMLInputElement>('[data-blok-database-property-menu-name-input]');
    const info = document.querySelector<HTMLButtonElement>('[data-blok-database-property-menu-description-button]');
    const area = document.querySelector<HTMLTextAreaElement>('textarea[data-blok-database-property-description]');

    if (input === null || info === null || area === null) throw new Error('no description field');

    return { input, info, area };
  };

  /** Steps until the name holds the highlight, then returns the next stops. */
  const stopsAfterName = (input: HTMLInputElement, count: number): Array<Element | null> => {
    input.focus();
    for (const _ of Array.from({ length: 5 })) {
      if (highlighted() === input) break;
      arrowDown(input);
    }
    expect(highlighted()).toBe(input);

    return Array.from({ length: count }, () => {
      arrowDown(input);

      return highlighted();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    menu?.close();
    menu = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('skips the field while it is closed', () => {
    const { input, info, area } = open();
    const stops = stopsAfterName(input, 2);

    expect(stops).not.toContain(area);
    expect(stops[0]).toBe(info);
    expect(stops[1]?.getAttribute('data-blok-item-name')).toBe('editProperty');
  });

  it('stops on the field once the (i) opens it', () => {
    const { input, info, area } = open();

    info.click();
    expect(area).toHaveFocus();
    const stops = stopsAfterName(input, 3);

    expect(stops[0]).toBe(info);
    expect(stops[1]).toBe(area);
    expect(stops[2]?.getAttribute('data-blok-item-name')).toBe('editProperty');
  });
});
