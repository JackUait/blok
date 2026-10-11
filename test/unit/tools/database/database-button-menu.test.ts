import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buttonEditItems, valueChoicesFor } from '../../../../src/tools/database/database-button-menu';
import type { ButtonSettings, PropertyDefinition } from '../../../../src/tools/database/types';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' },
  { id: 'stage', name: 'Stage', type: 'select', position: 'a2', config: { options: [{ id: 'o1', label: 'Ship', position: 'a0' }] } },
  { id: 'due', name: 'Due', type: 'date', position: 'a3' },
  { id: 'owner', name: 'Owner', type: 'person', position: 'a4' },
  { id: 'calc', name: 'Calc', type: 'formula', position: 'a5', formula: { expression: '1' } },
];

const button: PropertyDefinition = { id: 'btn', name: 'Act', type: 'button', position: 'a6', button: { label: 'Go', buttonActions: [{ id: 'a1', type: 'openPage' }] } };

interface Item { name?: string; title?: string; onActivate?: () => void; children?: { items?: Item[] } }

const find = (items: PopoverItemParams[] | Item[] | undefined, ...path: string[]): Item | undefined => {
  let level = items as Item[] | undefined;
  let found: Item | undefined;

  for (const name of path) {
    found = level?.find((item) => item.name === name);
    level = found?.children?.items;
  }

  return found;
};

describe('button settings items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers a value per type: checked, options, today, me', () => {
    expect(valueChoicesFor(schema[1]).map((c) => c.value)).toEqual([true, false]);
    expect(valueChoicesFor(schema[2]).map((c) => c.value)).toEqual(['o1', null]);
    expect(valueChoicesFor(schema[3]).map((c) => c.value)).toEqual(['@today', null]);
    expect(valueChoicesFor(schema[4]).map((c) => c.value)).toEqual([[{ id: '@me' }], []]);
  });

  it('adds an edit-property action with a fresh id after the existing ones', () => {
    const update = vi.fn();
    const items = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: true, update });

    find(items, 'buttonAddAction', 'buttonAdd-editProperty', 'buttonAdd-editProperty-done', 'buttonValue-done-0')?.onActivate?.();

    const next = update.mock.calls[0][0] as { button: ButtonSettings };

    expect(next.button.label).toBe('Go');
    expect(next.button.buttonActions?.map((a) => a.type)).toEqual(['openPage', 'editProperty']);
    expect(next.button.buttonActions?.[1]).toMatchObject({ type: 'editProperty', propertyId: 'done', value: true });
    expect(next.button.buttonActions?.[1].id).not.toBe('a1');
  });

  it('never offers a computed property or the button itself as an edit target', () => {
    const items = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => [...schema, button], hasHostActions: false, update: vi.fn() });
    const targets = find(items, 'buttonAddAction', 'buttonAdd-editProperty')?.children?.items?.map((i) => i.name);

    expect(targets).toEqual(['buttonAdd-editProperty-title', 'buttonAdd-editProperty-done', 'buttonAdd-editProperty-stage', 'buttonAdd-editProperty-due', 'buttonAdd-editProperty-owner']);
  });

  it('removes an action', () => {
    const update = vi.fn();
    const items = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: false, update });

    find(items, 'buttonAction-a1', 'buttonAction-a1-remove')?.onActivate?.();

    expect(update).toHaveBeenCalledWith({ button: { label: 'Go', buttonActions: [] } });
  });

  it('offers the host action only when the host listens', () => {
    const withHost = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: true, update: vi.fn() });
    const without = buttonEditItems(button, { i18n: { t: (k: string) => k }, schema: () => schema, hasHostActions: false, update: vi.fn() });

    expect(find(withHost, 'buttonAddAction', 'buttonAdd-callback')).toBeDefined();
    expect(find(without, 'buttonAddAction', 'buttonAdd-callback')).toBeUndefined();
  });
});
