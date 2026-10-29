import { describe, it, expect } from 'vitest';
import { planViewBarFold, type ViewBarParts } from '../../../../src/tools/database/database-view-bar-fold';

/**
 * Notion's own parts (notion-spec-2 §26.1, tb-1512-closed.txt): six tabs with
 * their 1px gap, "+" 28 + its gaps, "4 more…" 76.7, and the
 * right side from Filter to the chevron (243.3), and without the five icons (103.3).
 */
const notion = (bar: number): ViewBarParts => ({
  // Notion's bar has an 8px inset at each end.
  width: bar - 16,
  tabs: [86.4, 90.1, 97.5, 74.9, 110.3, 106.8],
  current: 0,
  gap: 0,
  add: 31,
  more: 77.7,
  toolbar: { full: 243.3, noIcons: 103.3 },
});

const describeFold = (bar: number): string => {
  const fold = planViewBarFold(notion(bar));
  const tabs = typeof fold.tabs === 'string' ? fold.tabs : `${fold.tabs.length} + more`;

  return `${tabs} | icons ${fold.icons ? 'on' : 'off'} | new ${fold.newButton ? 'on' : 'off'}`;
};

describe('planViewBarFold: Notion order as the bar narrows (notion-spec-2 §26.1)', () => {
  it('shows every tab, every icon and New on a wide bar', () => {
    expect(describeFold(1050)).toBe('all | icons on | new on');
  });

  it('folds tabs one at a time into "N more…" and drops "+" with the first fold', () => {
    expect(describeFold(818)).toBe('5 + more | icons on | new on');
    expect(describeFold(698)).toBe('4 + more | icons on | new on');
    expect(describeFold(538)).toBe('2 + more | icons on | new on');
  });

  it('turns the tabs into "Table ⌄" once fewer than two fit, keeping every icon', () => {
    expect(describeFold(498)).toBe('compact | icons on | new on');
    expect(describeFold(482)).toBe('compact | icons on | new on');
  });

  it('hides the icons together and brings two tabs back beside Settings and New', () => {
    const fold = planViewBarFold(notion(478));

    expect(fold.icons).toBe(false);
    expect(fold.newButton).toBe(true);
    expect(Array.isArray(fold.tabs) && fold.tabs.length >= 2).toBe(true);
    expect(describeFold(398)).toBe('2 + more | icons off | new on');
  });

  it('goes back to "Table ⌄" with Settings and New', () => {
    expect(describeFold(338)).toBe('compact | icons off | new on');
    expect(describeFold(322)).toBe('compact | icons off | new on');
  });

  it('drops New last, keeping Settings', () => {
    expect(describeFold(318)).toBe('compact | icons off | new off');
    expect(describeFold(178)).toBe('compact | icons off | new off');
  });

  it('keeps the current view among the shown tabs', () => {
    const fold = planViewBarFold({ ...notion(698), current: 5 });

    expect(fold.tabs).toEqual([0, 1, 5]);
  });

  it('never leaves a single tab beside "N more…"', () => {
    const fold = planViewBarFold({ ...notion(1050), tabs: [300, 300], toolbar: { full: 0, noIcons: 0 }, width: 500 });

    expect(fold.tabs).toBe('compact');
  });

  it('folds at least one tab when only "+" is short of room, so "N more…" still offers New view', () => {
    const fold = planViewBarFold({ ...notion(1050), tabs: [100, 100, 100], current: 2, toolbar: { full: 0, noIcons: 0 }, width: 320, more: 0 });

    expect(fold.tabs).toEqual([0, 2]);
  });

  it('measures both switches against the whole bar; the gap before the toolbar only costs the tabs', () => {
    // tbp-1350-open: icons shown with 222.7 of room; tbp-1460-open: New shown at a 322 bar.
    const icons = planViewBarFold({ ...notion(482), gap: 4 });
    const withNew = planViewBarFold({ ...notion(322), gap: 4 });

    expect(icons.icons).toBe(true);
    expect(withNew.newButton).toBe(true);
    expect(planViewBarFold({ ...notion(538), gap: 4 }).tabs).toEqual([0, 1]);
  });
});
