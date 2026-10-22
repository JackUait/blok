import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabasePropertyMenu } from '../../../../src/tools/database/database-property-menu';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const property: PropertyDefinition = { id: 'p', name: 'Amount', type: 'select', position: 'a1', config: { options: [] } };

const key = (target: EventTarget, name: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, code: name, bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

/**
 * research/36 §2: plain Enter in the description field keeps focus there,
 * with no new line, and the menu stays open. Notion's Enter also ran a row
 * the pointer had highlighted; Blok does not copy that.
 */
describe('property description: plain Enter, on the real menu', () => {
  const cb = { onRename: vi.fn(), onUpdate: vi.fn(), onOptionsChange: vi.fn(), onChangeType: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };
  let menu: DatabasePropertyMenu | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    menu?.close();
    menu = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps focus in the field even when a menu row is highlighted', () => {
    const anchor = document.createElement('button');

    document.body.appendChild(anchor);
    menu = new DatabasePropertyMenu({ i18n: { t: (k: string) => k, getLocale: () => 'en' } as never, hasPeople: false, ...cb });
    menu.open(property, anchor);
    const input = document.querySelector<HTMLInputElement>('[data-blok-database-property-menu-name-input]');
    const info = document.querySelector<HTMLButtonElement>('[data-blok-database-property-menu-description-button]');
    const area = document.querySelector<HTMLTextAreaElement>('textarea[data-blok-database-property-description]');

    if (input === null || info === null || area === null) throw new Error('no description field');
    input.focus();
    const highlighted = document.querySelector('[data-blok-item-name="changeType"]');

    for (const _ of Array.from({ length: 10 })) {
      if (highlighted?.getAttribute('data-blok-focused') === 'true') break;
      key(input, 'ArrowDown');
    }
    expect(highlighted?.getAttribute('data-blok-focused')).toBe('true');

    info.click();
    expect(area).toHaveFocus();
    expect(highlighted?.getAttribute('data-blok-focused')).toBe('true');
    area.value = 'Desc one';
    const enter = key(area, 'Enter');

    expect(area).toHaveFocus();
    expect(enter.defaultPrevented).toBe(true);
    expect(area.value).toBe('Desc one');
    expect(menu.isOpen).toBe(true);
    expect(document.querySelectorAll('[data-blok-popover-opened]').length).toBe(1);
    expect(Object.values(cb).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});
