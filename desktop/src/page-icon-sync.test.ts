import { describe, expect, it } from 'vitest';
import { nextPageIcon } from './page-icon-sync';

describe('nextPageIcon', () => {
  it('keeps the icon when the editor has not loaded the document yet', () => {
    // The load-time read on a remote page: the document, and with it the icon,
    // has not arrived. Writing undefined here is what erased the emoji on
    // every page visit.
    expect(nextPageIcon('👋', undefined, { adoptOnly: true })).toBe('👋');
  });

  it('adopts the icon the editor reports at load', () => {
    expect(nextPageIcon(undefined, '✅', { adoptOnly: true })).toBe('✅');
    expect(nextPageIcon('👋', '✅', { adoptOnly: true })).toBe('✅');
  });

  it('clears the icon when a real change removes it', () => {
    expect(nextPageIcon('👋', undefined, { adoptOnly: false })).toBeUndefined();
  });
});
