import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCellEditor, renderCellValue } from '../../../../../src/tools/database/cells';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { editorRoot, makeAnchor, makeEditorContext, makeProperty, press } from './helpers';

const field = (): HTMLInputElement | HTMLTextAreaElement => {
  const el = editorRoot()?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');

  if (el === null || el === undefined) {
    throw new Error('no editor field');
  }

  return el;
};

describe('place and verification cells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a place shows its name, else its address, and is empty without either', () => {
    const ctx = makeEditorContext();

    expect(renderCellValue(makeProperty('place'), { name: 'HQ', address: '1 Main St' }, ctx).textContent).toBe('HQ');
    expect(renderCellValue(makeProperty('place'), { address: '1 Main St', lat: 1, lon: 2 }, ctx).textContent).toBe('1 Main St');
    expect(renderCellValue(makeProperty('place'), { lat: 1, lon: 2 }, ctx).hasAttribute('data-empty')).toBe(true);
  });

  it('editing a place writes the typed address and drops coordinates the host must work out again', () => {
    const onCommit = vi.fn();

    openCellEditor(makeProperty('place'), { address: 'Old', lat: 1, lon: 2 }, makeAnchor(), makeEditorContext({ onCommit }));
    expect(field().value).toBe('Old');
    field().value = '2 New Rd';
    field().dispatchEvent(new Event('input', { bubbles: true }));
    press(field(), 'Enter');

    expect(onCommit).toHaveBeenCalledWith({ address: '2 New Rd' });
  });

  it('clearing a place writes null', () => {
    const onCommit = vi.fn();

    openCellEditor(makeProperty('place'), { address: 'Old' }, makeAnchor(), makeEditorContext({ onCommit }));
    field().value = '  ';
    press(field(), 'Enter');

    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('a verification shows verified, expired or unverified', () => {
    const ctx = makeEditorContext({ now: new Date('2026-10-09T00:00:00Z') });
    const state = (value: Parameters<typeof renderCellValue>[1]): string | null =>
      renderCellValue(makeProperty('verification'), value, ctx).getAttribute('data-verification');

    expect(state({ state: 'verified' })).toBe('verified');
    expect(state({ state: 'verified', expiresAt: '2026-01-01' })).toBe('expired');
    expect(state(null)).toBe('unverified');
    expect(renderCellValue(makeProperty('verification'), { state: 'verified' }, ctx).textContent).toBe('tools.database.verificationVerified');
  });

  it('an untouched verification is a state, not empty: the table, peek and card all say Unverified', () => {
    const ctx = makeEditorContext();

    [undefined, null].forEach((value) => {
      const cell = renderCellValue(makeProperty('verification'), value, ctx);

      expect(cell.hasAttribute('data-empty')).toBe(false);
      expect(cell.textContent).toBe('tools.database.verificationUnverified');
    });
  });

  it('clicking a verification verifies it as the current user, and again unverifies it', () => {
    const onCommit = vi.fn();

    openCellEditor(makeProperty('verification'), null, makeAnchor(), makeEditorContext({ onCommit, me: 'u1' }));
    openCellEditor(makeProperty('verification'), { state: 'verified', verifiedBy: 'u1' }, makeAnchor(), makeEditorContext({ onCommit }));

    expect(onCommit.mock.calls).toEqual([[{ state: 'verified', verifiedBy: 'u1' }], [{ state: 'unverified' }]]);
  });

  it('an expired verification verifies again on click', () => {
    const onCommit = vi.fn();

    openCellEditor(
      makeProperty('verification'),
      { state: 'verified', expiresAt: '2000-01-01' },
      makeAnchor(),
      makeEditorContext({ onCommit })
    );

    expect(onCommit).toHaveBeenCalledWith({ state: 'verified' });
  });
});
