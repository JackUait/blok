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

  // ENT-1. Observed: both editors' undo ran (A: 1 call, B: 1 call).
  // Expected per the multi-editor document-listener law: one press = one editor.
  it.fails('ENT-1: one Ctrl+Z with focus on <body> undoes at most one of two editors', () => {
    const a = mountEditor();
    const b = mountEditor();

    pressUndo(document.body);

    expect(a.undo.mock.calls.length + b.undo.mock.calls.length).toBeLessThanOrEqual(1);
  });

  // ENT-2. Observed: undo called once and the event was preventDefault-ed.
  // Expected: a keystroke in the host page's own editable field is not Blok's.
  it.fails('ENT-2: Ctrl+Z in a host contenteditable outside the editor leaves Blok alone', () => {
    const editor = mountEditor();
    const host = document.createElement('div');

    host.contentEditable = 'true';
    document.body.appendChild(host);

    const event = pressUndo(host);

    expect(editor.undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  // ENT-4. Observed: undo not called — handleZ matches event.key, not event.code.
  // Expected: layout-independent match, as handleTurnInto already does via event.code.
  it.fails('ENT-4: Ctrl+Z on a non-Latin layout (key "я", code KeyZ) runs Blok undo', () => {
    const editor = mountEditor();

    pressUndo(editor.redactor, { key: 'я', code: 'KeyZ', ctrlKey: true });

    expect(editor.undo).toHaveBeenCalledTimes(1);
  });

  // ENT-3. Observed: undo not called, beforeinput not prevented, so the browser's
  // native contenteditable undo runs instead.
  it.fails('ENT-3: a historyUndo beforeinput (Edit menu) is routed to Blok undo', () => {
    const editor = mountEditor();
    const event = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true });

    editor.redactor.dispatchEvent(event);

    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  // ENT-5. Observed: YjsManager.undo called while read-only is on.
  // Expected: undo does nothing in read-only (the keyboard path already stands down).
  it.fails('ENT-5: history.undo() does nothing while the editor is read-only', () => {
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
