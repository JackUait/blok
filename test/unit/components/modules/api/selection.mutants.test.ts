import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SelectionAPI } from '../../../../../src/components/modules/api/selection';
import { SelectionUtils } from '../../../../../src/components/selection/index';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';

/**
 * Mutant notes for src/components/modules/api/selection.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

const makeApi = (): SelectionAPI => new SelectionAPI({
  config: {},
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
});

describe('SelectionAPI passthrough methods', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('saves the selection through the util', () => {
    const save = vi.spyOn(SelectionUtils.prototype, 'save');

    makeApi().methods.save();

    expect(save.mock.calls).toStrictEqual([[]]);
  });

  it('restores the selection through the util', () => {
    const restore = vi.spyOn(SelectionUtils.prototype, 'restore');

    makeApi().methods.restore();

    expect(restore.mock.calls).toStrictEqual([[]]);
  });

  it('sets the fake background through the util', () => {
    const setFakeBackground = vi.spyOn(SelectionUtils.prototype, 'setFakeBackground');

    makeApi().methods.setFakeBackground();

    expect(setFakeBackground.mock.calls).toStrictEqual([[]]);
  });
});
