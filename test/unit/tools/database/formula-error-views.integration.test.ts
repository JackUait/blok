import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData } from '../../../../types';

/**
 * A formula that does not compile, or passes a limit, shows a warning mark
 * named by the reason in every view that shows the formula, never a blank or
 * a false checkbox.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const now = new Date();
const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
const SHOWN = ['broken', 'capped', 'fine', 'blank'];

const doc = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
        { id: 'due', name: 'Due', type: 'date', position: 'a2' },
        { id: 'notes', name: 'Notes', type: 'text', position: 'a3' },
        { id: 'broken', name: 'Broken', type: 'formula', position: 'a4', formula: { expression: 'prop("Missing")' } },
        // A boolean formula past the regex budget: it must not read as an unchecked box.
        { id: 'capped', name: 'Capped', type: 'formula', position: 'a5', formula: { expression: 'test(prop("Notes"), "(a+" + ")+$")' } },
        { id: 'fine', name: 'Fine', type: 'formula', position: 'a6', formula: { expression: 'length(prop("Notes"))' } },
        { id: 'blank', name: 'Blank', type: 'formula', position: 'a7', formula: { expression: '' } },
      ],
      views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], ...view }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', s: 'o1', due, notes: 'aaa' }, position: 'a0' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[], locale = 'en'): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    i18n: { locale },
    tools: {
      paragraph: Paragraph,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never);
  await editor.isReady;
  await quiet();
};

const marks = (scope: string): Array<string | null> =>
  [...(holder?.querySelectorAll(`${scope} [data-formula-error] [role="img"]`) ?? [])].map((mark) => mark.getAttribute('aria-label'));

describe('a formula error in every view that shows the formula', () => {
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

  it.each([
    ['a table row', { type: 'table' }, '[data-blok-database-table-row][data-row-id="r1"]'],
    ['a board card', { type: 'board', groupBy: 's', visibleProperties: SHOWN }, '[data-blok-database-card][data-row-id="r1"]'],
    ['a list row', { type: 'list', visibleProperties: SHOWN }, '[data-blok-database-list-row][data-row-id="r1"]'],
    ['a gallery card', { type: 'gallery', visibleProperties: SHOWN }, '[data-blok-database-gallery-card][data-row-id="r1"]'],
    ['a timeline bar', { type: 'timeline', visibleProperties: SHOWN }, '[data-blok-database-timeline-bar][data-row-id="r1"]'],
    ['a calendar event', { type: 'calendar', visibleProperties: SHOWN }, '[data-blok-database-calendar-event][data-row-id="r1"]'],
  ])('%s: the broken and the capped formula show a named mark, the others none', async (_name, view, scope) => {
    await make(doc(view));

    expect(marks(scope)).toEqual(['Unknown property "Missing"', expect.stringContaining('limit')]);
    expect(holder?.querySelector(`${scope} [data-blok-database-cell="formula"][data-result-type="checkbox"]`)).toBeNull();
  });

  it('the table names the reason in the person\'s language', async () => {
    await make(doc({ type: 'table' }), 'ru');

    expect(marks('[data-blok-database-table-row][data-row-id="r1"]')[0]).toBe('Неизвестное свойство "Missing"');
  });

  describe('the row page', () => {
    const openPage = async (mode: string): Promise<void> => {
      await make(doc({ type: 'table', openPagesIn: mode }));
      holder?.querySelector('[data-row-id="r1"] [data-blok-database-table-open]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await quiet();
    };
    const pageMark = (propertyId: string): Element | null =>
      holder?.querySelector(`[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="${propertyId}"] [data-formula-error] [role="img"]`) ?? null;

    it.each([['side peek', 'side'], ['center peek', 'center'], ['full page', 'full']])('%s: shows the marks, as the table does', async (_name, mode) => {
      await openPage(mode);

      expect(pageMark('broken')?.getAttribute('aria-label')).toBe('Unknown property "Missing"');
      expect(pageMark('capped')).not.toBeNull();
      expect(pageMark('fine')).toBeNull();
      expect(pageMark('blank')).toBeNull();
    });
  });
});
