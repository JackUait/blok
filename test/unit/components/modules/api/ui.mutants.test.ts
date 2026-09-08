import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { UiAPI } from '../../../../../src/components/modules/api/ui';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Mutant notes for src/components/modules/api/ui.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

type UiModuleMock = {
  isMobile: boolean;
  nodes: {
    wrapper: HTMLElement;
    redactor: HTMLElement;
  };
};

const makeApi = (isMobile: boolean): { api: UiAPI; ui: UiModuleMock } => {
  const ui: UiModuleMock = {
    isMobile,
    nodes: {
      wrapper: document.createElement('div'),
      redactor: document.createElement('div'),
    },
  };

  const api = new UiAPI({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  // Only the UI module is reachable from the methods under test.
  api.state = { UI: ui } as unknown as BlokModules;

  return { api,
    ui };
};

describe('UiAPI methods', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('reports the mobile state of the UI module', () => {
    expect(makeApi(true).api.methods.isMobile).toBe(true);
    expect(makeApi(false).api.methods.isMobile).toBe(false);
  });

  it('reads the mobile state on every access, not once at build time', () => {
    const { api, ui } = makeApi(false);
    const { methods } = api;

    ui.isMobile = true;

    expect(methods.isMobile).toBe(true);
  });

  it('exposes the wrapper and redactor nodes', () => {
    const { api, ui } = makeApi(false);

    expect(api.methods.nodes.wrapper).toBe(ui.nodes.wrapper);
    expect(api.methods.nodes.redactor).toBe(ui.nodes.redactor);
  });
});
