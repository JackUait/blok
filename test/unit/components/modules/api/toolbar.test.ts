import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ToolbarAPI from '../../../../../src/components/modules/api/toolbar';
import EventsDispatcher from '../../../../../src/components/utils/events';
import * as utils from '../../../../../src/components/utils';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';
import type { EditorConfig } from '../../../../../types';
import type { EditorEventMap } from '../../../../../src/components/events';

type ToolbarEditorMock = {
  BlockManager: {
    currentBlockIndex: number;
  };
  BlockSettings: {
    opened: boolean;
    open: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  Toolbar: {
    moveAndOpen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    toolbox: {
      opened: boolean;
      open: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  };
};

describe('ToolbarAPI', () => {
  let toolbarApi: ToolbarAPI;
  let editorMock: ToolbarEditorMock;

  const createToolbarApi = (overrides?: Partial<ToolbarEditorMock>): void => {
    const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
    const moduleConfig: ModuleConfig = {
      config: {} as EditorConfig,
      eventsDispatcher,
    };

    toolbarApi = new ToolbarAPI(moduleConfig);
    editorMock = {
      BlockManager: {
        currentBlockIndex: 0,
      },
      BlockSettings: {
        opened: false,
        open: vi.fn(),
        close: vi.fn(),
      },
      Toolbar: {
        moveAndOpen: vi.fn(),
        close: vi.fn(),
        toolbox: {
          opened: false,
          open: vi.fn(),
          close: vi.fn(),
        },
      },
      ...overrides,
    };

    toolbarApi.state = editorMock as unknown as EditorModules;
  };

  beforeEach(() => {
    createToolbarApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the toolbar via Editor module', () => {
    toolbarApi.open();

    expect(editorMock.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
  });

  it('closes the toolbar via Editor module', () => {
    toolbarApi.close();

    expect(editorMock.Toolbar.close).toHaveBeenCalledTimes(1);
  });

  it('opens block settings when toggleBlockSettings decides to open', () => {
    toolbarApi.toggleBlockSettings(undefined as unknown as boolean);

    expect(editorMock.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
    expect(editorMock.BlockSettings.open).toHaveBeenCalledTimes(1);
    expect(editorMock.BlockSettings.close).not.toHaveBeenCalled();
  });

  it('closes block settings when toggleBlockSettings decides to close', () => {
    editorMock.BlockSettings.opened = true;

    toolbarApi.toggleBlockSettings(undefined as unknown as boolean);

    expect(editorMock.BlockSettings.close).toHaveBeenCalledTimes(1);
    expect(editorMock.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    expect(editorMock.BlockSettings.open).not.toHaveBeenCalled();
  });

  it('forces opening block settings when openingState is true', () => {
    editorMock.BlockSettings.opened = true;

    toolbarApi.toggleBlockSettings(true);

    expect(editorMock.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
    expect(editorMock.BlockSettings.open).toHaveBeenCalledTimes(1);
    expect(editorMock.BlockSettings.close).not.toHaveBeenCalled();
  });

  it('forces closing block settings when openingState is false', () => {
    toolbarApi.toggleBlockSettings(false);

    expect(editorMock.BlockSettings.close).toHaveBeenCalledTimes(1);
    expect(editorMock.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    expect(editorMock.BlockSettings.open).not.toHaveBeenCalled();
  });

  it('logs a warning when no block is selected for toggleBlockSettings', () => {
    const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

    editorMock.BlockManager.currentBlockIndex = -1;

    toolbarApi.toggleBlockSettings(true);

    expect(logSpy).toHaveBeenCalledWith(
      'Could\'t toggle the Toolbar because there is no block selected ',
      'warn'
    );
    expect(editorMock.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    expect(editorMock.BlockSettings.open).not.toHaveBeenCalled();
    expect(editorMock.BlockSettings.close).not.toHaveBeenCalled();
  });

  it('opens toolbox when toggleToolbox receives opening state', () => {
    toolbarApi.toggleToolbox(true);

    expect(editorMock.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
    expect(editorMock.Toolbar.toolbox.open).toHaveBeenCalledTimes(1);
    expect(editorMock.Toolbar.toolbox.close).not.toHaveBeenCalled();
  });

  it('closes toolbox when toggleToolbox receives closing state', () => {
    toolbarApi.toggleToolbox(false);

    expect(editorMock.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);
    expect(editorMock.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    expect(editorMock.Toolbar.toolbox.open).not.toHaveBeenCalled();
  });

  it('toggles toolbox when opening state is omitted', () => {
    toolbarApi.toggleToolbox(undefined as unknown as boolean);

    expect(editorMock.Toolbar.moveAndOpen).toHaveBeenCalledTimes(1);
    expect(editorMock.Toolbar.toolbox.open).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    editorMock.Toolbar.toolbox.opened = true;

    toolbarApi.toggleToolbox(undefined as unknown as boolean);

    expect(editorMock.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);
    expect(editorMock.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    expect(editorMock.Toolbar.toolbox.open).not.toHaveBeenCalled();
  });

  it('logs a warning when no block is selected for toggleToolbox', () => {
    const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

    editorMock.BlockManager.currentBlockIndex = -1;

    toolbarApi.toggleToolbox(true);

    expect(logSpy).toHaveBeenCalledWith(
      'Could\'t toggle the Toolbox because there is no block selected ',
      'warn'
    );
    expect(editorMock.Toolbar.moveAndOpen).not.toHaveBeenCalled();
    expect(editorMock.Toolbar.toolbox.open).not.toHaveBeenCalled();
    expect(editorMock.Toolbar.toolbox.close).not.toHaveBeenCalled();
  });
});

