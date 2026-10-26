import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../../src/components/constants';
import { destroy, HINT_DELAY } from '../../../../../src/components/utils/tooltip';
import { renderCellValue } from '../../../../../src/tools/database/cells';
import type { CellContext } from '../../../../../src/tools/database/cells/types';
import type { FormulaProblem } from '../../../../../src/tools/database/computed-properties';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';

const formula: PropertyDefinition = { id: 'f', name: 'F', type: 'formula', position: 'a0', formula: { expression: 'x' } };

const strings: Record<string, string> = {
  'tools.database.formula.error.unknownProperty': 'No property {name}',
  'tools.database.formulaLimitReached': 'Hit a limit',
};

const ctx = (problem: FormulaProblem | undefined, overrides: Partial<CellContext> = {}): CellContext => ({
  i18n: { t: (key: string, params?: Record<string, string | number>) => (strings[key] ?? key).replace('{name}', String(params?.name ?? '')) },
  readOnly: true,
  rowId: 'r1',
  valueProperty: (p) => ({ ...p, type: 'checkbox' }),
  formulaProblem: (p, rowId) => (p.id === 'f' && rowId === 'r1' ? problem : undefined),
  ...overrides,
});

const hint = (): HTMLElement | null => document.querySelector(`[${DATA_ATTR.interface}="${TOOLTIP_INTERFACE_VALUE}"]`);

const hover = (el: HTMLElement): void => {
  el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
};

describe('a formula cell with no value because of an error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows a warning mark named by the compile error, in the person\'s words', () => {
    const cell = renderCellValue(formula, null, ctx({ kind: 'error', code: 'unknownProperty', params: { name: 'Due' } }));
    const mark = cell.querySelector('[role="img"]');

    expect(mark?.getAttribute('aria-label')).toBe('No property Due');
    expect(mark?.querySelector('svg')).not.toBeNull();
    expect(cell.hasAttribute('data-formula-error')).toBe(true);
    expect(cell.hasAttribute('data-empty')).toBe(false);
  });

  it('a checkbox formula past a limit shows the mark, never an unchecked box', () => {
    const cell = renderCellValue(formula, null, ctx({ kind: 'limit' }));

    expect(cell.querySelector('[data-blok-database-checkbox]')).toBeNull();
    expect(cell.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Hit a limit');
  });

  it('shows the reason on hover, only after the hint delay', () => {
    const cell = renderCellValue(formula, null, ctx({ kind: 'limit' }));

    cell.getBoundingClientRect = vi.fn(() => DOMRect.fromRect({ x: 10, y: 20, width: 100, height: 20 }));
    document.body.appendChild(cell);
    hover(cell);
    vi.advanceTimersByTime(HINT_DELAY - 1);
    expect(hint()?.getAttribute('aria-hidden')).not.toBe('false');
    vi.advanceTimersByTime(1);
    expect(hint()?.getAttribute('aria-hidden')).toBe('false');
    expect(hint()?.textContent).toBe('Hit a limit');
  });

  it('focus never shows the reason', () => {
    const cell = renderCellValue(formula, null, ctx({ kind: 'limit' }));

    document.body.appendChild(cell);
    cell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(HINT_DELAY * 2);
    expect(hint()?.getAttribute('aria-hidden')).not.toBe('false');
  });

  it('a formula with no problem draws its value', () => {
    const cell = renderCellValue(formula, true, ctx(undefined));

    expect(cell.querySelector('[data-blok-database-checkbox]')?.getAttribute('data-state')).toBe('checked');
    expect(cell.querySelector('[role="img"]')).toBeNull();
  });

  it('without a row there is no mark', () => {
    const cell = renderCellValue(formula, null, ctx({ kind: 'limit' }, { rowId: undefined }));

    expect(cell.hasAttribute('data-formula-error')).toBe(false);
  });
});
