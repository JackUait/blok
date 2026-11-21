import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrag } from '../../../../src/tools/database/database-card-drag';
import { DatabaseColumnDrag } from '../../../../src/tools/database/database-column-drag';
import { DatabaseFormQuestionDrag } from '../../../../src/tools/database/database-form-question-drag';
import { DatabaseListRowDrag } from '../../../../src/tools/database/database-list-row-drag';
import { DatabaseTableColumnDrag } from '../../../../src/tools/database/database-table-column-drag';
import { DatabaseTableRowDrag } from '../../../../src/tools/database/database-table-row-drag';
import { createTableState } from '../../../../src/tools/database/database-table-view';

/**
 * A focused block, as after a page load. Blok's editor hears keydown in capture
 * on document and, with a block focused, turns Escape into navigation mode
 * (which blurs the block) and stops it there.
 */
const focusedEditor = (): { block: HTMLElement; navigation: ReturnType<typeof vi.fn>; remove: () => void } => {
  const block = document.createElement('div');
  const navigation = vi.fn();
  const editorEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    navigation();
    event.stopPropagation();
  };

  block.contentEditable = 'true';
  document.body.appendChild(block);
  document.addEventListener('keydown', editorEscape, true);

  return {
    block,
    navigation,
    remove: () => {
      document.removeEventListener('keydown', editorEscape, true);
      block.remove();
    },
  };
};

const box = (el: HTMLElement, left: number, top: number, width: number, height: number): HTMLElement => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }),
    configurable: true,
  });

  return el;
};

const stack = (attr: string, ids: string[], axis: 'x' | 'y'): HTMLElement => {
  const wrapper = document.createElement('div');

  ids.forEach((id, i) => {
    const el = document.createElement('div');

    el.setAttribute(attr, '');
    el.setAttribute(axis === 'y' ? 'data-row-id' : 'data-option-id', id);
    wrapper.appendChild(box(el, axis === 'x' ? i * 200 : 0, axis === 'y' ? i * 40 : 0, 200, 40));
  });
  document.body.appendChild(wrapper);

  return wrapper;
};

const pointer = (type: string, x: number, y: number, target: EventTarget = document): void => {
  target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
};

describe('a database drag cancelled with Escape while a block has focus', () => {
  let editor: ReturnType<typeof focusedEditor>;

  beforeEach(() => {
    vi.clearAllMocks();
    editor = focusedEditor();
  });

  afterEach(() => {
    editor.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const pressEscape = (): void => {
    editor.block.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  };

  it('list row: cancels, moves nothing and keeps the editor out of navigation mode', () => {
    const onDrop = vi.fn();
    const drag = new DatabaseListRowDrag({ wrapper: stack('data-blok-database-list-row', ['a', 'b', 'c'], 'y'), onDrop });

    drag.beginTracking('a', 0, 0);
    pointer('pointermove', 0, 100);
    pressEscape();
    pointer('pointerup', 0, 100);

    expect(editor.navigation).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    drag.destroy();
  });

  it('board card: cancels, moves nothing and keeps the editor out of navigation mode', () => {
    const onDrop = vi.fn();
    const drag = new DatabaseCardDrag({ wrapper: stack('data-blok-database-card', ['a', 'b', 'c'], 'y'), onDrop });

    drag.beginTracking('a', 0, 0);
    pointer('pointermove', 0, 100);
    pressEscape();
    pointer('pointerup', 0, 100);

    expect(editor.navigation).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    drag.destroy();
  });

  it('board column: cancels, moves nothing and keeps the editor out of navigation mode', () => {
    const onDrop = vi.fn();
    const drag = new DatabaseColumnDrag({ wrapper: stack('data-blok-database-column', ['a', 'b', 'c'], 'x'), onDrop });

    drag.beginTracking('a', 50, 20);
    pointer('pointermove', 590, 20);
    pressEscape();
    pointer('pointerup', 590, 20);

    expect(editor.navigation).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    drag.destroy();
  });

  it('form question: cancels, moves nothing and keeps the editor out of navigation mode', () => {
    const onDrop = vi.fn();
    const form = stack('data-blok-database-form-question', ['a', 'b', 'c'], 'y');
    const card = form.firstElementChild;
    const drag = new DatabaseFormQuestionDrag(form, onDrop);

    if (!(card instanceof HTMLElement)) throw new Error('no card');
    drag.begin(card, new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    pointer('pointermove', 0, 100);
    pressEscape();
    pointer('pointerup', 0, 100);

    expect(editor.navigation).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    drag.cleanup();
  });

  it('table row: cancels, moves nothing and keeps the editor out of navigation mode', () => {
    const onDrop = vi.fn();
    const grid = stack('data-blok-database-table-row', ['a', 'b', 'c'], 'y');
    const handle = document.createElement('div');

    handle.setAttribute('data-blok-database-table-row-handle', '');
    grid.firstElementChild?.appendChild(handle);
    const drag = new DatabaseTableRowDrag({ grid, state: createTableState(), onDrop });

    pointer('pointerdown', 0, 0, handle);
    pointer('pointermove', 0, 100);
    pressEscape();
    pointer('pointerup', 0, 100);

    expect(editor.navigation).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    drag.destroy();
  });

  it('table column: cancels, moves nothing and keeps the editor out of navigation mode', () => {
    const onDrop = vi.fn();
    const grid = stack('data-blok-database-table-column-header', ['a', 'b', 'c'], 'x');
    const header = grid.firstElementChild;
    const drag = new DatabaseTableColumnDrag({ grid, state: createTableState(), onDrop });

    if (header === null) throw new Error('no header');
    pointer('pointerdown', 50, 20, header);
    pointer('pointermove', 590, 20);
    pressEscape();
    pointer('pointerup', 590, 20);

    expect(editor.navigation).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    drag.destroy();
  });
});
