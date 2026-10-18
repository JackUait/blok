import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCellEditor } from '../../../../src/tools/database/cells';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { PlaceValue, PropertyValue } from '../../../../src/tools/database/types';
import { buildTool, fakeRow, makeDoc } from './tier3-harness';
import type { Doc } from './tier3-harness';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press, pressOutside } from './cells/helpers';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

/** A place a map pin made: a host name, an address and the point. */
const EIFFEL: PlaceValue = { name: 'Eiffel Tower', address: '5 Avenue Anatole France, 75007 Paris, France', lat: 48.8584, lon: 2.2945 };

const field = (): HTMLInputElement | HTMLTextAreaElement => {
  const el = editorRoot()?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');

  if (el === null || el === undefined) throw new Error('no editor field');

  return el;
};

const writesTo = (doc: Doc, rowId: string): unknown[][] =>
  vi.mocked(doc.rows.get(rowId)?.block.call ?? vi.fn()).mock.calls.filter(([method]) => method === 'updateProperties');

const openPlaceCell = (el: HTMLElement): void => {
  const cell = el.querySelector<HTMLElement>('[data-row-id="a"] [role="gridcell"][data-property-id="where"]');

  if (cell === null) throw new Error('no place cell');
  cell.click();
};

/** The grid as it is now: closing an editor redraws the view. */
const grid = (el: HTMLElement): HTMLElement => {
  const found = el.querySelector<HTMLElement>('[role="grid"]');

  if (found === null) throw new Error('no grid');

  return found;
};

const paste = (target: HTMLElement, text: string): void => {
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (format: string): string => (format === 'text/plain' ? text : ''), setData: () => undefined, types: ['text/plain'] },
  });
  target.dispatchEvent(event);
};

describe('editing a Place keeps what the user did not change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('in the table', () => {
    const setup = (where: PropertyValue = EIFFEL): { doc: Doc; el: HTMLElement } => {
      const doc = makeDoc([fakeRow('a', 'db', { title: 'HQ', where }, 'a0')]);
      const { el } = buildTool(doc);

      return { doc, el };
    };

    it.each([
      ['Enter', (): void => void press(field(), 'Enter')],
      ['a press outside', (): void => pressOutside()],
      ['Escape', (): void => void press(field(), 'Escape')],
    ])('opening and closing with %s writes nothing', (_exit, close) => {
      const { doc, el } = setup();

      openPlaceCell(el);
      close();

      expect(writesTo(doc, 'a')).toEqual([]);
      expect(doc.rows.get('a')?.data.properties.where).toStrictEqual(EIFFEL);
    });

    it('a commit whose text differs only by spaces writes nothing', () => {
      const { doc, el } = setup();

      openPlaceCell(el);
      field().value = `${field().value}  `;
      press(field(), 'Enter');

      expect(writesTo(doc, 'a')).toEqual([]);
      expect(doc.rows.get('a')?.data.properties.where).toStrictEqual(EIFFEL);
    });

    it('a new address replaces the place: the old name and point no longer match it', () => {
      const { doc, el } = setup();

      openPlaceCell(el);
      field().value = '1 Main St';
      press(field(), 'Enter');

      expect(doc.rows.get('a')?.data.properties.where).toStrictEqual({ address: '1 Main St' });
    });

    it('pasting the text the cell already shows keeps the place whole', () => {
      const { doc, el } = setup();

      openPlaceCell(el);
      press(field(), 'Escape');
      paste(grid(el), 'Eiffel Tower');

      expect(writesTo(doc, 'a')).toEqual([]);
      expect(doc.rows.get('a')?.data.properties.where).toStrictEqual(EIFFEL);
    });

    it('pasting the stored address keeps the place whole too', () => {
      const { doc, el } = setup();

      openPlaceCell(el);
      press(field(), 'Escape');
      paste(grid(el), ` ${EIFFEL.address ?? ''} `);

      expect(writesTo(doc, 'a')).toEqual([]);
      expect(doc.rows.get('a')?.data.properties.where).toStrictEqual(EIFFEL);
    });

    it('pasting other text replaces the place with that address', () => {
      const { doc, el } = setup();

      openPlaceCell(el);
      press(field(), 'Escape');
      paste(grid(el), '1 Main St');

      expect(doc.rows.get('a')?.data.properties.where).toStrictEqual({ address: '1 Main St' });
    });
  });

  describe('on the row page and in the peek', () => {
    it.each(['center', 'side', 'full'] as const)('committing the value editor (%s) with only a space added writes nothing', (mode) => {
      const doc = makeDoc([fakeRow('a', 'db', { title: 'HQ', where: EIFFEL }, 'a0')]);
      const { tool } = buildTool(doc);

      tool.openRow({ rowId: 'a', mode });
      const value = document.querySelector<HTMLElement>('[data-blok-database-drawer-prop-value][data-property-id="where"]');

      if (value === null) throw new Error('no place value');
      value.click();
      field().value = `${field().value} `;
      press(field(), 'Enter');

      expect(writesTo(doc, 'a')).toEqual([]);
      expect(doc.rows.get('a')?.data.properties.where).toStrictEqual(EIFFEL);
    });
  });

  describe('the editor (research/20 §1d)', () => {
    const chip = (): HTMLElement | null => editorRoot()?.querySelector<HTMLElement>('[data-blok-database-place-name]') ?? null;
    const clear = (): HTMLButtonElement | null => editorRoot()?.querySelector<HTMLButtonElement>('[data-blok-database-place-clear]') ?? null;

    it('shows the stored name in a chip and the stored address in the field', () => {
      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext());

      expect(chip()?.textContent).toBe('Eiffel Tower');
      expect(field().value).toBe(EIFFEL.address);
    });

    it('a place with no name shows no chip', () => {
      openCellEditor(makeProperty('place'), { address: '1 Main St' }, makeAnchor(), makeEditorContext());

      expect(chip()).toBeNull();
      expect(clear()).toBeNull();
    });

    it('a pin with a name and a point only closes without a write', () => {
      const onCommit = vi.fn();

      openCellEditor(makeProperty('place'), { name: 'Statue of Liberty', lat: 40.68, lon: -74.04 }, makeAnchor(), makeEditorContext({ onCommit }));
      expect(chip()?.textContent).toBe('Statue of Liberty');
      expect(field().value).toBe('');
      field().value = '   ';
      press(field(), 'Enter');

      expect(onCommit).not.toHaveBeenCalled();
    });

    it('× clears the place and closes the editor', () => {
      const onCommit = vi.fn();
      const onClose = vi.fn();

      openCellEditor(makeProperty('place'), EIFFEL, makeAnchor(), makeEditorContext({ onCommit, onClose }));
      expect(clear()?.getAttribute('aria-label')).toBe('tools.database.placeClear');
      clear()?.click();

      expect(onCommit.mock.calls).toEqual([[null]]);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(editorRoot()).toBeNull();
    });
  });
});
