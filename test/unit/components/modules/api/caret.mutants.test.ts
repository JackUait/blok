import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CaretAPI } from '../../../../../src/components/modules/api/caret';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { Mock } from 'vitest';

/**
 * Mutant notes for src/components/modules/api/caret.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

type YjsManagerMock = {
  updateLastCaretAfterPosition: Mock<() => void>;
};

const makeApi = (): { api: CaretAPI; yjsManager: YjsManagerMock } => {
  const yjsManager: YjsManagerMock = { updateLastCaretAfterPosition: vi.fn() };

  const api = new CaretAPI({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  // Only the YjsManager module is reachable from the method under test.
  api.state = { YjsManager: yjsManager } as unknown as BlokModules;

  return { api,
    yjsManager };
};

describe('CaretAPI.updateLastCaretAfterPosition', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('forwards the redo-position update to the collaboration manager', () => {
    const { api, yjsManager } = makeApi();

    api.methods.updateLastCaretAfterPosition();

    expect(yjsManager.updateLastCaretAfterPosition.mock.calls).toStrictEqual([[]]);
  });

  it('keeps working when the method is detached from the api object', () => {
    const { api, yjsManager } = makeApi();
    const { updateLastCaretAfterPosition } = api.methods;

    updateLastCaretAfterPosition();

    expect(yjsManager.updateLastCaretAfterPosition.mock.calls).toStrictEqual([[]]);
  });
});
