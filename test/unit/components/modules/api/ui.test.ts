import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import UiAPI from '../../../../../src/components/modules/api/ui';
import EventsDispatcher from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';
import type { EditorEventMap } from '../../../../../src/components/events';
import type { EditorConfig } from '../../../../../types';

type EditorStub = {
  UI: {
    nodes: {
      wrapper: HTMLElement;
      redactor: HTMLElement;
    };
  };
};

const createUiApi = (): {
  uiApi: UiAPI;
  editor: EditorStub;
  wrapper: HTMLDivElement;
  redactor: HTMLDivElement;
} => {
  const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as EditorConfig,
    eventsDispatcher,
  };

  const uiApi = new UiAPI(moduleConfig);
  const wrapper = document.createElement('div');
  const redactor = document.createElement('div');

  const editor: EditorStub = {
    UI: {
      nodes: {
        wrapper,
        redactor,
      },
    },
  };

  uiApi.state = editor as unknown as EditorModules;

  return {
    uiApi,
    editor,
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

  it('exposes editor wrapper and redactor nodes via methods getter', () => {
    const { uiApi, wrapper, redactor } = createUiApi();

    const nodes = uiApi.methods.nodes;

    expect(nodes.wrapper).toBe(wrapper);
    expect(nodes.redactor).toBe(redactor);
  });

  it('reflects the latest Editor UI nodes each time methods are accessed', () => {
    const { uiApi, editor, wrapper } = createUiApi();

    const initialNodes = uiApi.methods.nodes;

    expect(initialNodes.wrapper).toBe(wrapper);

    const freshWrapper = document.createElement('section');
    const freshRedactor = document.createElement('article');

    editor.UI.nodes.wrapper = freshWrapper;
    editor.UI.nodes.redactor = freshRedactor;

    const updatedNodes = uiApi.methods.nodes;

    expect(updatedNodes.wrapper).toBe(freshWrapper);
    expect(updatedNodes.redactor).toBe(freshRedactor);
  });
});
