/**
 * Undo/redo entry points: which keystrokes and API calls reach Blok's history.
 * Each pin here is confirmed in a real browser by
 * test/playwright/tests/undo-audit/entry-points.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryAPI } from '../../../src/components/modules/api/history';
import { KeyboardController } from '../../../src/components/modules/uiControllers/controllers/keyboard';
import { EventsDispatcher } from '../../../src/components/utils/events';
import type { BlokEventMap } from '../../../src/components/events';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { ModuleConfig } from '../../../src/types-internal/module-config';

type Editor = {
  controller: KeyboardController;
  wrapper: HTMLElement;
  redactor: HTMLElement;
  undo: ReturnType<typeof vi.fn>;
};

const controllers: KeyboardController[] = [];

const mountEditor = (): Editor => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', 'blok-editor');
  document.body.appendChild(wrapper);

  const redactor = document.createElement('div');

  redactor.contentEditable = 'true';
  wrapper.appendChild(redactor);

  const undo = vi.fn();
  const blok = {
    BlockManager: {
      currentBlock: undefined,
      noteUserInput: vi.fn(),
      unsetCurrentBlock: vi.fn(),
    },
    BlockSelection: { navigationModeEnabled: false },
    BlockSettings: { contains: vi.fn(() => false) },
    BlockEvents: { keydown: vi.fn() },
    Toolbar: { close: vi.fn() },
    DragManager: { isDragging: false },
    YjsManager: { undo, redo: vi.fn(), markCaretBeforeChange: vi.fn() },
  } as unknown as BlokModules;

  const controller = new KeyboardController({
    config: { holder: document.createElement('div') },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    someToolbarOpened: (): boolean => false,
  });

  controller.state = blok;
  controller.setRedactorElement(redactor);
  controller.setWrapperElement(wrapper);
  controller.enable();
  controllers.push(controller);

  return { controller, wrapper, redactor, undo };
};

const pressUndo = (target: EventTarget, init: KeyboardEventInit = { key: 'z', ctrlKey: true }): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

describe('undo audit — entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    controllers.forEach((controller) => controller.disable());
    controllers.length = 0;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('ENT-1: one Ctrl+Z with focus on <body> undoes at most one of two editors', () => {
    const a = mountEditor();
    const b = mountEditor();

    pressUndo(document.body);

    expect(a.undo.mock.calls.length + b.undo.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('Ctrl+Z with focus on <body> undoes the editor that was used last', () => {
    const a = mountEditor();
    const b = mountEditor();

    b.redactor.dispatchEvent(new Event('focusin', { bubbles: true }));
    pressUndo(document.body);

    expect(a.undo).not.toHaveBeenCalled();
    expect(b.undo).toHaveBeenCalledTimes(1);
  });

  it('a historyUndo beforeinput in a text input inside the editor stays native', () => {
    const editor = mountEditor();
    const input = document.createElement('input');

    editor.redactor.appendChild(input);

    const event = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true });

    input.dispatchEvent(event);

    expect(editor.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ENT-2: Ctrl+Z in a host contenteditable outside the editor leaves Blok alone', () => {
    const editor = mountEditor();
    const host = document.createElement('div');

    // jsdom does not reflect the contentEditable property to the attribute.
    host.setAttribute('contenteditable', 'true');
    document.body.appendChild(host);

    const event = pressUndo(host);

    expect(editor.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ENT-4: Ctrl+Z on a non-Latin layout (key "я", code KeyZ) runs Blok undo', () => {
    const editor = mountEditor();

    pressUndo(editor.redactor, { key: 'я', code: 'KeyZ', ctrlKey: true });

    expect(editor.undo).toHaveBeenCalledTimes(1);
  });

  it('ENT-3: a historyUndo beforeinput (Edit menu) is routed to Blok undo', () => {
    const editor = mountEditor();
    const event = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true });

    editor.redactor.dispatchEvent(event);

    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ENT-5: history.undo() does nothing while the editor is read-only', () => {
    const moduleConfig: ModuleConfig = { config: {}, eventsDispatcher: new EventsDispatcher<BlokEventMap>() };
    const api = new HistoryAPI(moduleConfig);
    const undo = vi.fn();

    api.state = {
      ReadOnly: { isEnabled: true },
      YjsManager: { undo, redo: vi.fn(), canUndo: vi.fn(() => true), canRedo: vi.fn(() => false), clear: vi.fn() },
    } as unknown as BlokModules;

    api.methods.undo();

    expect(undo).not.toHaveBeenCalled();
  });
});
