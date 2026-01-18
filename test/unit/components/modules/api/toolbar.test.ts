import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolbarAPI } from '../../../../../src/components/modules/api/toolbar';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import * as utils from '../../../../../src/components/utils';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';

type ToolbarBlokMock = {
  BlockManager: {
    currentBlockIndex: number;
  };
  BlockSettings: {
    opened: boolean;
    open: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  Toolbar: {
    opened: boolean;
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
  let blokMock: ToolbarBlokMock;
  const unspecifiedState = undefined as unknown as boolean;

  const createToolbarApi = (overrides?: Partial<ToolbarBlokMock>): void => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const moduleConfig: ModuleConfig = {
      config: {} as BlokConfig,
      eventsDispatcher,
    };

    toolbarApi = new ToolbarAPI(moduleConfig);
    blokMock = {
      BlockManager: {
        currentBlockIndex: 0,
      },
      BlockSettings: {
        opened: false,
        open: vi.fn(() => {
          blokMock.BlockSettings.opened = true;
        }),
        close: vi.fn(() => {
          blokMock.BlockSettings.opened = false;
        }),
      },
      Toolbar: {
        opened: false,
        moveAndOpen: vi.fn(() => {
          blokMock.Toolbar.opened = true;
        }),
        close: vi.fn(() => {
          blokMock.Toolbar.opened = false;
        }),
        toolbox: {
          opened: false,
          open: vi.fn(() => {
            blokMock.Toolbar.toolbox.opened = true;
          }),
          close: vi.fn(() => {
            blokMock.Toolbar.toolbox.opened = false;
          }),
        },
      },
      ...overrides,
    };

    toolbarApi.state = blokMock as unknown as BlokModules;
  };

  beforeEach(() => {
    createToolbarApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('methods getter', () => {
    it('exposes bound toolbar controls', () => {
      const openSpy = vi.spyOn(toolbarApi, 'open').mockImplementation(() => {});
      const closeSpy = vi.spyOn(toolbarApi, 'close').mockImplementation(() => {});
      const toggleBlockSettingsSpy = vi
        .spyOn(toolbarApi, 'toggleBlockSettings')
        .mockImplementation(() => {});
      const toggleToolboxSpy = vi
        .spyOn(toolbarApi, 'toggleToolbox')
        .mockImplementation(() => {});

      const { open, close, toggleBlockSettings, toggleToolbox } = toolbarApi.methods;

      open();
      close();
      toggleBlockSettings(true);
      toggleToolbox(false);

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(toggleBlockSettingsSpy).toHaveBeenCalledWith(true);
      expect(toggleToolboxSpy).toHaveBeenCalledWith(false);
    });
  });

  describe('open/close', () => {
    it('opens the toolbar via Blok module', () => {
      toolbarApi.open();

      expect(blokMock.Toolbar.opened).toBe(true);
    });

    it('closes the toolbar via Blok module', () => {
      blokMock.Toolbar.opened = true;

      toolbarApi.close();

      expect(blokMock.Toolbar.opened).toBe(false);
    });
  });

  describe('toggleBlockSettings', () => {
    it('opens block settings when state is omitted and block settings are closed', () => {
      toolbarApi.toggleBlockSettings(unspecifiedState);

      expect(blokMock.BlockSettings.opened).toBe(true);
      expect(blokMock.Toolbar.opened).toBe(true);
    });

    it('closes block settings when state is omitted and block settings are opened', () => {
      blokMock.BlockSettings.opened = true;

      toolbarApi.toggleBlockSettings(unspecifiedState);

      expect(blokMock.BlockSettings.opened).toBe(false);
    });

    it('forces opening when openingState is true', () => {
      blokMock.BlockSettings.opened = true;

      toolbarApi.toggleBlockSettings(true);

      expect(blokMock.BlockSettings.opened).toBe(true);
      expect(blokMock.Toolbar.opened).toBe(true);
    });

    it('forces closing when openingState is false', () => {
      blokMock.BlockSettings.opened = true;

      toolbarApi.toggleBlockSettings(false);

      expect(blokMock.BlockSettings.opened).toBe(false);
    });

    it('logs a warning when no block is selected', () => {
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

      blokMock.BlockManager.currentBlockIndex = -1;

      toolbarApi.toggleBlockSettings(true);

      expect(logSpy).toHaveBeenCalledWith(
        'Could\'t toggle the Toolbar because there is no block selected ',
        'warn'
      );
      expect(blokMock.BlockSettings.opened).toBe(false);
    });
  });

  it('opens toolbox when toggleToolbox receives opening state', () => {
    toolbarApi.toggleToolbox(true);

    expect(blokMock.Toolbar.toolbox.opened).toBe(true);
    expect(blokMock.Toolbar.opened).toBe(true);
  });

  it('closes toolbox when toggleToolbox receives closing state', () => {
    blokMock.Toolbar.toolbox.opened = true;

    toolbarApi.toggleToolbox(false);

    expect(blokMock.Toolbar.toolbox.opened).toBe(false);
  });

  it('toggles toolbox when opening state is omitted', () => {
    toolbarApi.toggleToolbox(unspecifiedState);

    expect(blokMock.Toolbar.toolbox.opened).toBe(true);
    expect(blokMock.Toolbar.opened).toBe(true);

    blokMock.Toolbar.toolbox.opened = true;

    toolbarApi.toggleToolbox(unspecifiedState);

    expect(blokMock.Toolbar.toolbox.opened).toBe(false);
  });

  it('logs a warning when no block is selected for toggleToolbox', () => {
    const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

    blokMock.BlockManager.currentBlockIndex = -1;

    toolbarApi.toggleToolbox(true);

    expect(logSpy).toHaveBeenCalledWith(
      'Could\'t toggle the Toolbox because there is no block selected ',
      'warn'
    );
    expect(blokMock.Toolbar.toolbox.opened).toBe(false);
  });
});
