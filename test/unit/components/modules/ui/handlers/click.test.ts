import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeClickContext,
  type ClickHandlerDependencies,
} from '../../../../../../src/components/modules/uiControllers/handlers/click';
import { SelectionUtils as Selection } from '../../../../../../src/components/selection';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

const createBlokStub = (): BlokModules => {
  const toolbarWrapper = document.createElement('div');
  const toolbarSettingsToggler = document.createElement('button');
  const toolbarPlusButton = document.createElement('button');

  return {
    BlockManager: {
      unsetCurrentBlock: vi.fn(),
      getBlockByChildNode: vi.fn(),
    },
    BlockSettings: {
      opened: false,
      close: vi.fn(),
      contains: vi.fn(() => false),
    },
    Toolbar: {
      close: vi.fn(),
      moveAndOpen: vi.fn(),
      contains: vi.fn(() => false),
      nodes: {
        wrapper: toolbarWrapper,
        settingsToggler: toolbarSettingsToggler,
        plusButton: toolbarPlusButton,
      },
    },
    BlockSelection: {
      clearSelection: vi.fn(),
    },
    InlineToolbar: {
      opened: false,
      close: vi.fn(),
      containsNode: vi.fn(() => false),
    },
  } as unknown as BlokModules;
};

describe('Click Handler', () => {
  let blok: BlokModules;
  let holder: HTMLElement;
  let redactor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();

    holder = document.createElement('div');
    redactor = document.createElement('div');
    holder.appendChild(redactor);
    document.body.appendChild(holder);

    blok = createBlokStub();
  });

  describe('analyzeClickContext', () => {
    it('identifies clicks inside redactor', () => {
      const target = document.createElement('div');
      redactor.appendChild(target);

      const deps: ClickHandlerDependencies = {
        Blok: blok,
        nodes: { holder, redactor },
      };

      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      const context = analyzeClickContext(deps, event);

      expect(context.clickedInsideRedactor).toBe(true);
      expect(context.clickedInsideOfBlok).toBe(true);
      expect(context.clickedInsideBlokSurface).toBe(true);
    });

    it('identifies clicks outside blok', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const deps: ClickHandlerDependencies = {
        Blok: blok,
        nodes: { holder, redactor },
      };

      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      vi.spyOn(Selection, 'isAtBlok', 'get').mockReturnValue(false);

      const context = analyzeClickContext(deps, event);

      expect(context.clickedInsideOfBlok).toBe(false);
      expect(context.clickedInsideRedactor).toBe(false);
      expect(context.clickedInsideBlokSurface).toBe(false);
    });

    it('identifies clicks inside toolbar', () => {
      const target = document.createElement('div');

      vi.mocked(blok.Toolbar.contains).mockReturnValue(true);

      const deps: ClickHandlerDependencies = {
        Blok: blok,
        nodes: { holder, redactor },
      };

      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      const context = analyzeClickContext(deps, event);

      expect(context.clickedInsideToolbar).toBe(true);
      expect(context.clickedInsideBlokSurface).toBe(true);
    });

    it('identifies clicks inside block settings', () => {
      const target = document.createElement('div');

      vi.mocked(blok.BlockSettings.contains).mockReturnValue(true);

      const deps: ClickHandlerDependencies = {
        Blok: blok,
        nodes: { holder, redactor },
      };

      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      const context = analyzeClickContext(deps, event);

      expect(context.doNotProcess).toBe(true);
    });

    it('identifies clicks on settings toggler', () => {
      const target = document.createElement('div');

      if (blok.Toolbar.nodes.settingsToggler) {
        vi.spyOn(blok.Toolbar.nodes.settingsToggler, 'contains').mockReturnValue(true);
      }

      const deps: ClickHandlerDependencies = {
        Blok: blok,
        nodes: { holder, redactor },
      };

      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      const context = analyzeClickContext(deps, event);

      expect(context.doNotProcess).toBe(true);
    });

    it('identifies clicks on plus button', () => {
      const target = document.createElement('div');

      if (blok.Toolbar.nodes.plusButton) {
        vi.spyOn(blok.Toolbar.nodes.plusButton, 'contains').mockReturnValue(true);
      }

      const deps: ClickHandlerDependencies = {
        Blok: blok,
        nodes: { holder, redactor },
      };

      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      const context = analyzeClickContext(deps, event);

      expect(context.doNotProcess).toBe(true);
    });

    it('determines when to clear current block', () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const deps: ClickHandlerDependencies = {
        Blok: blok,
        nodes: { holder, redactor },
      };

      const event = new MouseEvent('mousedown');
      Object.defineProperty(event, 'target', { value: target });

      vi.spyOn(Selection, 'isAtBlok', 'get').mockReturnValue(false);

      const context = analyzeClickContext(deps, event);

      expect(context.shouldClearCurrentBlock).toBe(true);
    });
  });
});
