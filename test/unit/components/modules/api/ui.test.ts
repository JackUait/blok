import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import UiAPI from '../../../../../src/components/modules/api/ui';
import EventsDispatcher from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokConfig } from '../../../../../types';

type BlokStub = {
  UI: {
    nodes: {
      wrapper: HTMLElement;
      redactor: HTMLElement;
    };
  };
};

const createUiApi = (): {
  uiApi: UiAPI;
  blok: BlokStub;
  wrapper: HTMLDivElement;
  redactor: HTMLDivElement;
} => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher,
  };

  const uiApi = new UiAPI(moduleConfig);
  const wrapper = document.createElement('div');
  const redactor = document.createElement('div');

  const blok: BlokStub = {
    UI: {
      nodes: {
        wrapper,
        redactor,
      },
    },
  };

  uiApi.state = blok as unknown as BlokModules;

  return {
    uiApi,
    blok,
    wrapper,
    redactor,
  };
};

describe('UiAPI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('exposes blok wrapper and redactor nodes via methods getter', () => {
    const { uiApi, wrapper, redactor } = createUiApi();

    const nodes = uiApi.methods.nodes;

    expect(nodes.wrapper).toBe(wrapper);
    expect(nodes.redactor).toBe(redactor);
  });

  it('reflects the latest Blok UI nodes each time methods are accessed', () => {
    const { uiApi, blok, wrapper } = createUiApi();

    const initialNodes = uiApi.methods.nodes;

    expect(initialNodes.wrapper).toBe(wrapper);

    const freshWrapper = document.createElement('section');
    const freshRedactor = document.createElement('article');

    blok.UI.nodes.wrapper = freshWrapper;
    blok.UI.nodes.redactor = freshRedactor;

    const updatedNodes = uiApi.methods.nodes;

    expect(updatedNodes.wrapper).toBe(freshWrapper);
    expect(updatedNodes.redactor).toBe(freshRedactor);
  });
});
