/**
 * Exact-value pins for the toolbar class-name table.
 *
 * Every class string here is a single twJoin argument. twJoin drops a falsy
 * argument, so blanking any one of them silently shortens the joined value:
 * only a whole-object exact comparison notices. toContain would not.
 *
 * No survivors: all 27 recorded mutants change one of these strings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getToolbarStyles } from '../../../../../src/components/modules/toolbar/styles';

describe('getToolbarStyles mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the exact class table, with every twJoin argument present', () => {
    expect(getToolbarStyles()).toStrictEqual({
      toolbar: 'absolute left-0 right-0 top-0 h-toolbox-btn transition-opacity duration-100 ease-linear will-change-[opacity,top] pointer-events-none',
      toolbarOpened: 'block',
      toolbarClosed: 'hidden',
      content: 'relative mx-auto max-w-blok-content',
      actions: 'absolute flex opacity-0 pr-[5px] right-full mobile:right-auto group-data-[blok-rtl=true]:right-auto group-data-[blok-rtl=true]:left-[calc(-1*(var(--spacing-toolbox-btn)))] mobile:group-data-[blok-rtl=true]:ml-0 mobile:group-data-[blok-rtl=true]:mr-auto mobile:group-data-[blok-rtl=true]:pr-0 mobile:group-data-[blok-rtl=true]:pl-[10px]',
      actionsOpened: 'opacity-100',
      settingsTogglerHidden: 'hidden',
    });
  });
});
