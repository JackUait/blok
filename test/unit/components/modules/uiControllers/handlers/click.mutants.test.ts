import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  analyzeClickContext,
  createDocumentClickedHandler,
  type ClickHandlerDependencies,
} from '../../../../../../src/components/modules/uiControllers/handlers/click';
import { SelectionUtils } from '../../../../../../src/components/selection/index';

interface Fake {
  deps: ClickHandlerDependencies;
  holder: HTMLElement;
  redactor: HTMLElement;
  outside: HTMLElement;
  toolbarContains: ReturnType<typeof vi.fn>;
  inlineContains: ReturnType<typeof vi.fn>;
  settingsContains: ReturnType<typeof vi.fn>;
  settingsToggler: HTMLElement;
  plusButton: HTMLElement;
  unsetCurrentBlock: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
  resetGoalColumn: ReturnType<typeof vi.fn>;
  closeInlineToolbar: ReturnType<typeof vi.fn>;
  setInlineToolbarOpen: (open: boolean) => void;
}

const makeFake = (): Fake => {
  const holder = document.createElement('div');
  const redactor = document.createElement('div');
  const outside = document.createElement('div');
  const settingsToggler = document.createElement('button');
  const plusButton = document.createElement('button');

  holder.appendChild(redactor);
  document.body.append(holder, outside, settingsToggler, plusButton);

  const toolbarContains = vi.fn(() => false);
  const inlineContains = vi.fn(() => false);
  const settingsContains = vi.fn(() => false);
  const unsetCurrentBlock = vi.fn();
  const clearSelection = vi.fn();
  const resetGoalColumn = vi.fn();
  const closeInlineToolbar = vi.fn();
  const inline = { opened: false, containsNode: inlineContains, close: closeInlineToolbar };

  const Blok = {
    Toolbar: { contains: toolbarContains, nodes: { settingsToggler: null, plusButton: null } },
    InlineToolbar: inline,
    BlockSettings: { contains: settingsContains },
    BlockManager: { unsetCurrentBlock },
    BlockSelection: { clearSelection },
    Caret: { resetGoalColumn },
  };

  return {
    deps: { Blok, nodes: { holder, redactor } } as unknown as ClickHandlerDependencies,
    holder,
    redactor,
    outside,
    toolbarContains,
    inlineContains,
    settingsContains,
    settingsToggler,
    plusButton,
    unsetCurrentBlock,
    clearSelection,
    resetGoalColumn,
    closeInlineToolbar,
    setInlineToolbarOpen: (open: boolean) => {
      inline.opened = open;
    },
  };
};

/**
 * A stand-in rather than a real MouseEvent: jsdom makes `isTrusted` a
 * non-configurable own property, so an untrusted-vs-trusted pair cannot be built
 * from the constructor. The handler reads only these three fields.
 */
const clickOn = (target: Node, { trusted = true, shiftKey = false } = {}): MouseEvent => ({
  target,
  isTrusted: trusted,
  shiftKey,
} as unknown as MouseEvent);

describe('document click handler mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    vi.spyOn(SelectionUtils, 'isAtBlok', 'get').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('analyzeClickContext', () => {
    it('places a click on the redactor inside the editor and its surface', () => {
      const fake = makeFake();
      const context = analyzeClickContext(fake.deps, clickOn(fake.redactor));

      expect(context.target).toBe(fake.redactor);
      expect(context.clickedInsideOfBlok).toBe(true);
      expect(context.clickedInsideRedactor).toBe(true);
      expect(context.clickedInsideBlokSurface).toBe(true);
      expect(context.shouldClearCurrentBlock).toBe(false);
    });

    it('places a click outside the editor nowhere, and asks to clear the block', () => {
      const fake = makeFake();
      const context = analyzeClickContext(fake.deps, clickOn(fake.outside));

      expect(context.clickedInsideOfBlok).toBe(false);
      expect(context.clickedInsideRedactor).toBe(false);
      expect(context.clickedInsideBlokSurface).toBe(false);
      expect(context.shouldClearCurrentBlock).toBe(true);
    });

    it('counts a caret parked in the editor as a click inside it', () => {
      const fake = makeFake();

      vi.spyOn(SelectionUtils, 'isAtBlok', 'get').mockReturnValue(true);

      const context = analyzeClickContext(fake.deps, clickOn(fake.outside));

      expect(context.clickedInsideOfBlok).toBe(true);
      expect(context.clickedInsideBlokSurface).toBe(true);
    });

    it('counts the toolbar as the editor surface but not as the redactor', () => {
      const fake = makeFake();

      fake.toolbarContains.mockReturnValue(true);

      const context = analyzeClickContext(fake.deps, clickOn(fake.outside));

      expect(context.clickedInsideToolbar).toBe(true);
      expect(context.clickedInsideBlokSurface).toBe(true);
      expect(context.clickedInsideRedactor).toBe(false);
      expect(context.shouldClearCurrentBlock).toBe(false);
    });

    it('reports a click inside the inline toolbar', () => {
      const fake = makeFake();

      fake.inlineContains.mockReturnValue(true);

      expect(analyzeClickContext(fake.deps, clickOn(fake.outside)).clickedInsideInlineToolbar).toBe(true);
    });

    it('leaves block settings, its toggler and the plus button to their own handlers', () => {
      const settings = makeFake();

      settings.settingsContains.mockReturnValue(true);
      expect(analyzeClickContext(settings.deps, clickOn(settings.outside)).doNotProcess).toBe(true);

      const toggler = makeFake();

      toggler.deps.Blok.Toolbar.nodes.settingsToggler = toggler.settingsToggler;
      expect(analyzeClickContext(toggler.deps, clickOn(toggler.settingsToggler)).doNotProcess).toBe(true);

      const plus = makeFake();

      plus.deps.Blok.Toolbar.nodes.plusButton = plus.plusButton;
      expect(analyzeClickContext(plus.deps, clickOn(plus.plusButton)).doNotProcess).toBe(true);
    });

    it('processes an ordinary click, and survives a toolbar with no toggler or plus button', () => {
      const fake = makeFake();

      expect(analyzeClickContext(fake.deps, clickOn(fake.outside)).doNotProcess).toBe(false);
    });

    it('asks to clear the block for a caret in the editor clicked outside both regions', () => {
      const fake = makeFake();

      vi.spyOn(SelectionUtils, 'isAtBlok', 'get').mockReturnValue(true);

      const context = analyzeClickContext(fake.deps, clickOn(fake.outside));

      expect(context.clickedInsideBlokSurface).toBe(true);
      expect(context.shouldClearCurrentBlock).toBe(true);
    });
  });

  describe('createDocumentClickedHandler', () => {
    it('ignores a synthetic click entirely', () => {
      const fake = makeFake();

      fake.setInlineToolbarOpen(true);
      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside, { trusted: false }));

      expect(fake.unsetCurrentBlock).not.toHaveBeenCalled();
      expect(fake.clearSelection).not.toHaveBeenCalled();
      expect(fake.closeInlineToolbar).not.toHaveBeenCalled();
      expect(fake.resetGoalColumn).not.toHaveBeenCalled();
    });

    it('drops the sticky navigation column when the click lands in the redactor', () => {
      const fake = makeFake();

      createDocumentClickedHandler(fake.deps)(clickOn(fake.redactor));

      expect(fake.resetGoalColumn).toHaveBeenCalledTimes(1);
    });

    it('keeps the sticky navigation column for a click outside the redactor', () => {
      const fake = makeFake();

      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside));

      expect(fake.resetGoalColumn).not.toHaveBeenCalled();
    });

    it('unsets the current block when the click leaves the editor', () => {
      const fake = makeFake();

      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside));

      expect(fake.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    });

    it('keeps the current block for a click in the redactor', () => {
      const fake = makeFake();

      createDocumentClickedHandler(fake.deps)(clickOn(fake.redactor));

      expect(fake.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('keeps the current block when the click belongs to another handler', () => {
      const fake = makeFake();

      fake.settingsContains.mockReturnValue(true);
      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside));

      expect(fake.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('clears the block selection on an ordinary click', () => {
      const fake = makeFake();
      const event = clickOn(fake.outside);

      createDocumentClickedHandler(fake.deps)(event);

      expect(fake.clearSelection).toHaveBeenCalledTimes(1);
      expect(fake.clearSelection.mock.calls[0][0]).toBe(event);
    });

    it('keeps the block selection while Shift is held', () => {
      const fake = makeFake();

      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside, { shiftKey: true }));

      expect(fake.clearSelection).not.toHaveBeenCalled();
    });

    it('keeps the block selection for a click that belongs to another handler', () => {
      const fake = makeFake();

      fake.settingsContains.mockReturnValue(true);
      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside));

      expect(fake.clearSelection).not.toHaveBeenCalled();
    });

    it('closes an open inline toolbar when the click lands outside it', () => {
      const fake = makeFake();

      fake.setInlineToolbarOpen(true);
      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside));

      expect(fake.closeInlineToolbar).toHaveBeenCalledTimes(1);
    });

    it.each(['true', 'plaintext-only'])('defers toolbar dismissal for a %s editable descendant', (mode) => {
      const fake = makeFake();
      const editable = document.createElement('div');
      const target = document.createElement('strong');

      editable.contentEditable = mode;
      editable.setAttribute('contenteditable', mode);
      editable.appendChild(target);
      fake.redactor.appendChild(editable);
      fake.setInlineToolbarOpen(true);

      createDocumentClickedHandler(fake.deps)(clickOn(target));

      expect(fake.closeInlineToolbar).not.toHaveBeenCalled();
    });

    it.each(['hasNestedPopoverOpen', 'hasDirectMenuOpen'])('dismisses an open %s menu when returning to text', (property) => {
      const fake = makeFake();
      const editable = document.createElement('div');

      editable.contentEditable = 'true';
      editable.setAttribute('contenteditable', 'true');
      fake.redactor.appendChild(editable);
      fake.setInlineToolbarOpen(true);
      Object.assign(fake.deps.Blok.InlineToolbar, { [property]: true });

      createDocumentClickedHandler(fake.deps)(clickOn(editable));

      expect(fake.closeInlineToolbar).toHaveBeenCalledOnce();
    });

    it('still dismisses the toolbar for a noneditable child inside the editor', () => {
      const fake = makeFake();
      const editable = document.createElement('div');
      const target = document.createElement('button');

      editable.setAttribute('contenteditable', 'true');
      target.setAttribute('contenteditable', 'false');
      editable.appendChild(target);
      fake.redactor.appendChild(editable);
      fake.setInlineToolbarOpen(true);

      createDocumentClickedHandler(fake.deps)(clickOn(target));

      expect(fake.closeInlineToolbar).toHaveBeenCalledOnce();
    });

    it('leaves an open inline toolbar alone when the click lands inside it', () => {
      const fake = makeFake();

      fake.setInlineToolbarOpen(true);
      fake.inlineContains.mockReturnValue(true);
      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside));

      expect(fake.closeInlineToolbar).not.toHaveBeenCalled();
    });

    it('does not close an inline toolbar that is already shut', () => {
      const fake = makeFake();

      createDocumentClickedHandler(fake.deps)(clickOn(fake.outside));

      expect(fake.closeInlineToolbar).not.toHaveBeenCalled();
    });
  });
});
