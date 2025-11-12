import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import UI from '../../../../src/components/modules/ui';
import SelectionUtils from '../../../../src/components/selection';

vi.mock('../../../../src/components/styles/main.css?inline', () => ({}));

describe('UI module interactions affecting the Toolbar', () => {
  let ui: UI;
  let holder: HTMLElement;
  let wrapper: HTMLElement;
  let redactor: HTMLElement;
  let mockEditor: {
    BlockManager: {
      setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
      getBlockByChildNode: ReturnType<typeof vi.fn>;
      unsetCurrentBlock: ReturnType<typeof vi.fn>;
      blocks: unknown[];
    };
    RectangleSelection: {
      isRectActivated: MockInstance<unknown[], boolean>;
    };
    Caret: {
      setToTheLastBlock: ReturnType<typeof vi.fn>;
    };
    Toolbar: {
      moveAndOpen: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      nodes: {
        settingsToggler: HTMLElement;
      };
      CSS: {
        toolbar: string;
      };
    };
    BlockSettings: {
      opened: boolean;
      close: ReturnType<typeof vi.fn>;
      nodes: {
        wrapper: HTMLElement;
      };
    };
    BlockSelection: {
      clearSelection: ReturnType<typeof vi.fn>;
    };
    ReadOnly: {
      isEnabled: boolean;
    };
  };

  beforeEach(() => {
    holder = document.createElement('div');
    wrapper = document.createElement('div');
    redactor = document.createElement('div');

    holder.appendChild(wrapper);
    wrapper.appendChild(redactor);
    document.body.appendChild(holder);

    const isRectActivated = vi.fn((..._args: unknown[]) => false);

    mockEditor = {
      BlockManager: {
        setCurrentBlockByChildNode: vi.fn(),
        getBlockByChildNode: vi.fn(),
        unsetCurrentBlock: vi.fn(),
        blocks: [],
      },
      RectangleSelection: {
        isRectActivated,
      },
      Caret: {
        setToTheLastBlock: vi.fn(),
      },
      Toolbar: {
        moveAndOpen: vi.fn(),
        close: vi.fn(),
        nodes: {
          settingsToggler: document.createElement('button'),
        },
        CSS: {
          toolbar: 'ce-toolbar',
        },
      },
      BlockSettings: {
        opened: false,
        close: vi.fn(),
        nodes: {
          wrapper: document.createElement('div'),
        },
      },
      BlockSelection: {
        clearSelection: vi.fn(),
      },
      ReadOnly: {
        isEnabled: false,
      },
    };

    ui = new UI({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as typeof ui['eventsDispatcher'],
    });

    ui.state = mockEditor as unknown as UI['Editor'];
    (ui as unknown as { nodes: UI['nodes'] }).nodes = {
      holder,
      wrapper,
      redactor,
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const setSelectionAtEditor = (value: boolean): void => {
    vi.spyOn(SelectionUtils, 'isAtEditor', 'get').mockReturnValue(value);
  };

  it('repositions the Toolbar after inline toolbar interactions via documentTouched', () => {
    setSelectionAtEditor(false);

    const block = document.createElement('div');

    redactor.appendChild(block);

    (ui as unknown as { documentTouched: (event: Event) => void }).documentTouched({
      target: block,
    } as unknown as Event);

    expect(mockEditor.BlockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(block);
    expect(mockEditor.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
  });

  it('closes the Toolbar and clears focus when clicking outside the holder', () => {
    setSelectionAtEditor(false);

    const outsideElement = document.createElement('div');

    document.body.appendChild(outsideElement);

    (ui as unknown as { documentClicked: (event: MouseEvent) => void }).documentClicked({
      target: outsideElement,
      isTrusted: true,
    } as unknown as MouseEvent);

    expect(mockEditor.Toolbar.close).toHaveBeenCalledTimes(1);
    expect(mockEditor.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    expect(mockEditor.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('closes the Toolbar when clicking inside the holder but outside the redactor', () => {
    setSelectionAtEditor(false);

    const sidePanel = document.createElement('div');

    holder.appendChild(sidePanel);

    (ui as unknown as { documentClicked: (event: MouseEvent) => void }).documentClicked({
      target: sidePanel,
      isTrusted: true,
    } as unknown as MouseEvent);

    expect(mockEditor.Toolbar.close).toHaveBeenCalledTimes(1);
    expect(mockEditor.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
  });

  it('keeps the Toolbar visible while closing Block Settings when clicking inside the redactor', () => {
    setSelectionAtEditor(false);

    mockEditor.BlockSettings.opened = true;

    const blockElement = document.createElement('div');

    redactor.appendChild(blockElement);

    const blockStub = {};

    mockEditor.BlockManager.getBlockByChildNode.mockReturnValue(blockStub);

    (ui as unknown as { documentClicked: (event: MouseEvent) => void }).documentClicked({
      target: blockElement,
      isTrusted: true,
    } as unknown as MouseEvent);

    expect(mockEditor.BlockSettings.close).toHaveBeenCalledTimes(1);
    expect(mockEditor.Toolbar.close).not.toHaveBeenCalled();
    expect(mockEditor.Toolbar.moveAndOpen).toHaveBeenCalledWith(blockStub);
  });
});

