import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findSnapTarget,
  collectSiblingBlocks,
  AlignmentGuide,
  SNAP_THRESHOLD,
} from '../../../../src/tools/spacer/alignment-guide';

/**
 * Mutant-directed cover for the spacer alignment guide.
 *
 * Standard used while triaging: a mutant is equivalent only when NO reachable
 * input distinguishes it from the original, faulted DOM objects included.
 *
 * Three mutants are left alive, and all three are equivalent. Each removes one
 * clause of a guard whose remaining clauses already cover the same inputs:
 *
 * - line 46, `component === null` replaced by false. The other clause is a
 *   negated Set lookup, and a Set of strings never holds null, so the lookup is
 *   false and its negation true for exactly the input the removed clause used
 *   to catch. Both forms return false there.
 *
 * - line 76, `ownColumn === null` replaced by false. The column list is read as
 *   an optional call on ownColumn, so a null ownColumn always yields undefined
 *   for it, and the third clause of the same guard tests for undefined. The
 *   removed clause can never be the only one that is true.
 *
 * - line 76, `columnList === undefined` replaced by false. The mirror of the
 *   above: the column list is undefined only when ownColumn is null, and the
 *   first clause of the same guard already tests for that.
 */

const COLUMNS_ATTR = 'data-blok-columns';
const COLUMN_ATTR = 'data-blok-column';
const ELEMENT_ATTR = 'data-blok-element';

/**
 * A computed style whose custom-property lookup answers with `value`. Built from
 * a real declaration so no cast is needed; the accessor is replaced because
 * cssstyle normalises a whitespace-only custom property away.
 */
const accentStyle = (value: string): CSSStyleDeclaration => {
  const declaration = document.createElement('div').style;

  Object.defineProperty(declaration, 'getPropertyValue', {
    configurable: true,
    value: (property: string): string => (property === '--blok-color-accent' ? value : ''),
  });

  return declaration;
};

const guideLine = (): HTMLElement => {
  const line = document.querySelector<HTMLElement>('[data-blok-spacer-guide]');

  if (line === null) {
    throw new Error('the guide drew no line');
  }

  return line;
};

describe('spacer alignment guide — mutant cover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('findSnapTarget', () => {
    it('accepts a target sitting exactly on the threshold', () => {
      expect(findSnapTarget(0, [SNAP_THRESHOLD])).toBe(SNAP_THRESHOLD);
    });

    it('keeps the nearer of two in-range targets, whichever comes first', () => {
      expect(findSnapTarget(10, [8, 13])).toBe(8);
    });

    it('keeps the earlier target when two are equally near', () => {
      expect(findSnapTarget(0, [3, -3])).toBe(3);
    });
  });

  describe('collectSiblingBlocks', () => {
    it('drops a text holder whose textContent reads as nothing at all', () => {
      const columns = document.createElement('div');
      const siblingColumn = document.createElement('div');
      const ownColumn = document.createElement('div');
      const holder = document.createElement('div');
      const spacer = document.createElement('div');

      columns.setAttribute(COLUMNS_ATTR, '');
      siblingColumn.setAttribute(COLUMN_ATTR, '');
      ownColumn.setAttribute(COLUMN_ATTR, '');
      holder.setAttribute(ELEMENT_ATTR, '');
      holder.setAttribute('data-blok-component', 'paragraph');

      Object.defineProperty(holder, 'textContent', {
        configurable: true,
        get: (): string | null => null,
      });

      siblingColumn.appendChild(holder);
      ownColumn.appendChild(spacer);
      columns.appendChild(siblingColumn);
      columns.appendChild(ownColumn);
      document.body.appendChild(columns);

      expect(collectSiblingBlocks(spacer)).toEqual([]);
    });

    it('returns nothing for a column that sits outside any column list', () => {
      const ownColumn = document.createElement('div');
      const spacer = document.createElement('div');

      ownColumn.setAttribute(COLUMN_ATTR, '');
      ownColumn.appendChild(spacer);
      document.body.appendChild(ownColumn);

      expect(collectSiblingBlocks(spacer)).toEqual([]);
    });
  });

  describe('AlignmentGuide', () => {
    it('draws the line with its own geometry, not the page defaults', () => {
      const scope = document.createElement('div');
      const guide = new AlignmentGuide();

      document.body.appendChild(scope);
      guide.show(120, new DOMRect(10, 0, 600, 2), scope);

      const line = guideLine();

      expect(line.getAttribute('data-blok-spacer-guide')).toBe('');
      expect(line.style.height).toBe('2px');
      expect(line.style.borderRadius).toBe('1px');
      expect(line.style.pointerEvents).toBe('none');

      guide.hide();
    });

    it('paints the accent the editor scope resolves', () => {
      const scope = document.createElement('div');
      const guide = new AlignmentGuide();

      document.body.appendChild(scope);
      // Deliberately not the hard-coded fallback: a guide that ignored the scope
      // would land on that colour and look correct.
      vi.spyOn(window, 'getComputedStyle').mockReturnValue(accentStyle('rgb(1, 2, 3)'));

      guide.show(120, new DOMRect(10, 0, 600, 2), scope);

      expect(guideLine().style.backgroundColor).toBe('rgb(1, 2, 3)');

      guide.hide();
    });

    it('treats a blank-but-not-empty accent as no accent at all', () => {
      const scope = document.createElement('div');
      const guide = new AlignmentGuide();

      document.body.appendChild(scope);
      vi.spyOn(window, 'getComputedStyle').mockReturnValue(accentStyle('   '));

      guide.show(120, new DOMRect(10, 0, 600, 2), scope);

      expect(guideLine().style.backgroundColor).toBe('rgb(35, 131, 226)');

      guide.hide();
    });

    it('hide before any show is a no-op', () => {
      const guide = new AlignmentGuide();

      expect(() => guide.hide()).not.toThrow();
    });
  });
});
