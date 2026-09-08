import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ToolbarAPI } from '../../../../../src/components/modules/api/toolbar';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlockControlsPosition } from '@/types/configs/blok-config';
import type { Mock } from 'vitest';

/**
 * Mutant notes for src/components/modules/api/toolbar.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

type ToolbarModuleMock = {
  setHidden: Mock<(hidden: boolean) => void>;
  setPosition: Mock<(position: BlockControlsPosition) => void>;
};

const makeApi = (): { api: ToolbarAPI; toolbar: ToolbarModuleMock } => {
  const toolbar: ToolbarModuleMock = {
    setHidden: vi.fn(),
    setPosition: vi.fn(),
  };

  const api = new ToolbarAPI({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  // Only the Toolbar module is reachable from the methods under test.
  api.state = { Toolbar: toolbar } as unknown as BlokModules;

  return { api,
    toolbar };
};

describe('ToolbarAPI reactive setters', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('forwards setHidden through the exposed methods', () => {
    const { api, toolbar } = makeApi();

    api.methods.setHidden(true);
    api.methods.setHidden(false);

    expect(toolbar.setHidden.mock.calls).toStrictEqual([[true], [false]]);
  });

  it('forwards setHidden from the class method', () => {
    const { api, toolbar } = makeApi();

    api.setHidden(true);

    expect(toolbar.setHidden.mock.calls).toStrictEqual([[true]]);
  });

  it('forwards setPosition through the exposed methods', () => {
    const { api, toolbar } = makeApi();

    api.methods.setPosition('right');

    expect(toolbar.setPosition.mock.calls).toStrictEqual([['right']]);
  });

  it('forwards setPosition from the class method', () => {
    const { api, toolbar } = makeApi();

    api.setPosition('left');

    expect(toolbar.setPosition.mock.calls).toStrictEqual([['left']]);
  });
});
