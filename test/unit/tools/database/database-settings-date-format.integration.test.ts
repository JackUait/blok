import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData } from '../../../../types';

/**
 * View settings › Edit properties › a date property opens the Edit property
 * panel from the settings path (a row page menu, not the column header's).
 * Its Date format row must open the format list there too.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'd', name: 'Due', type: 'date', position: 'a1' },
        { id: 'ct', name: 'Created', type: 'createdTime', position: 'a2' },
      ],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', d: '2026-10-15' }, position: 'a0' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: doc() },
  } as never) as TestEditor;
  await editor.isReady;
  await quiet();
};

const find = (selector: string): HTMLElement => {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].pop();

  if (el === undefined) throw new Error(`no ${selector}`);

  return el;
};

const clickTestId = async (testId: string): Promise<void> => {
  find(`[data-blok-testid="${testId}"]`).click();
  await quiet();
};

const openFromSettings = async (propertyId: string): Promise<void> => {
  await clickTestId('database-toolbar-settings');
  await clickTestId('database-settings-edit-properties');
  await clickTestId(`database-edit-property-${propertyId}`);
};

const formatRow = (): HTMLElement => find('[data-blok-item-name="dateFormat"]');
const listShown = (): boolean => document.querySelector('[data-blok-item-name="dateFormat-full"]') !== null;

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('settings › Edit properties › a date property › Date format', () => {
  it.each(['d', 'ct'])('opens the format list (%s)', async (propertyId) => {
    await make();
    await openFromSettings(propertyId);

    expect(listShown()).toBe(false);
    formatRow().click();
    await quiet();

    expect(listShown()).toBe(true);
    expect(formatRow().getAttribute('aria-expanded')).toBe('true');
  });

  it('opens it again after a format was picked', async () => {
    await make();
    await openFromSettings('d');
    formatRow().click();
    await quiet();
    find('[data-blok-item-name="dateFormat-short"]').click();
    await quiet();

    await openFromSettings('d');
    formatRow().click();
    await quiet();

    expect(listShown()).toBe(true);
    expect(find('[data-blok-item-name="dateFormat-short"]').getAttribute('aria-checked')).toBe('true');
  });
});
