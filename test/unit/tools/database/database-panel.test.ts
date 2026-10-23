import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabasePanel, panelReorderList, panelRow, panelSwitch } from '../../../../src/tools/database/database-panel';
import type { PanelPage } from '../../../../src/tools/database/database-panel';
import { HINT_DELAY, destroy as destroyTooltip, onHover } from '../../../../src/components/utils/tooltip';

const byTestId = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="${id}"]`);

describe('DatabasePanel', () => {
  let anchor: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    anchor = document.createElement('button');
    document.body.appendChild(anchor);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const open = (root: PanelPage, onClose = vi.fn()): DatabasePanel => {
    const panel = new DatabasePanel({ anchor, root, testId: 'panel', width: 290, backLabel: 'Back', onClose });

    panel.open();

    return panel;
  };

  // A hint must not outlive its trigger: paging replaces the trigger, so no mouseleave ever comes.
  it.each(['push', 'back', 'refresh'] as const)('hides a shown hint when the panel pages (%s)', (step) => {
    vi.useFakeTimers();
    try {
      const shown = (): boolean => document.querySelector('[data-blok-testid="tooltip"]')?.getAttribute('data-blok-shown') === 'true';
      const hinted = (): HTMLElement => {
        const info = document.createElement('span');

        info.setAttribute('data-blok-testid', 'hinted');
        onHover(info, 'A hint');

        return info;
      };
      const second: PanelPage = { title: 'Second', build: () => [hinted()] };
      const panel = open({ title: 'First', build: () => [hinted()] });

      if (step === 'back') panel.push(second);
      byTestId('hinted')?.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(HINT_DELAY);

      expect(shown()).toBe(true);
      if (step === 'push') panel.push(second);
      if (step === 'back') panel.back();
      if (step === 'refresh') panel.refresh();

      expect(shown()).toBe(false);
      panel.close();
    } finally {
      destroyTooltip();
      vi.useRealTimers();
    }
  });

  it('pages forward on a row and back on Escape, then closes', () => {
    const onClose = vi.fn();
    const second: PanelPage = { title: 'Layout', build: () => [panelRow({ label: 'Board', testId: 'row-board', onClick: vi.fn() })] };
    const panel = open({ title: 'View settings', build: (p) => [panelRow({ label: 'Layout', testId: 'row-layout', opensPage: true, onClick: () => p.push(second) })] }, onClose);

    byTestId('row-layout')?.click();

    expect(panel.depth).toBe(2);
    expect(byTestId('row-board')).not.toBeNull();
    expect(byTestId('database-panel-back')?.getAttribute('aria-label')).toBe('Back');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel.depth).toBe(1);
    expect(byTestId('row-layout')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(byTestId('panel')).toBeNull();
  });

  it('rebuilds a page on refresh and keeps focus on the same control', () => {
    const state = { count: 0 };
    const panel = open({ build: () => [panelRow({ label: `Count ${state.count}`, testId: 'row-count', onClick: vi.fn() })] });

    byTestId('row-count')?.focus();
    state.count = 3;
    panel.refresh();

    expect(byTestId('row-count')?.textContent).toBe('Count 3');
    expect(byTestId('row-count')).toHaveFocus();
  });

  it('marks a chosen row with aria-checked, not a fill', () => {
    const row = panelRow({ label: 'Table', testId: 'r', checked: true, onClick: vi.fn() });

    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(row.querySelector('[data-blok-database-panel-check]')).not.toBeNull();
  });

  it('flips a switch and reports the new state', () => {
    const onToggle = vi.fn();
    const toggle = panelSwitch({ label: 'Wrap all', testId: 's', checked: false, onToggle });

    toggle.click();

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('moves a list row with Alt+Arrow on its handle', () => {
    const onMove = vi.fn();
    const list = panelReorderList({
      testId: 'list',
      handleLabel: 'Drag',
      items: ['a', 'b', 'c'].map((id) => ({ id, element: document.createElement('span') })),
      onMove,
    });

    document.body.appendChild(list);
    list.querySelector<HTMLElement>('[data-blok-testid="list-handle-a"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    list.querySelector<HTMLElement>('[data-blok-testid="list-handle-c"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    list.querySelector<HTMLElement>('[data-blok-testid="list-handle-b"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));

    expect(onMove.mock.calls).toEqual([['a', 'c'], ['c', 'b'], ['b', null]]);
  });

  describe('docked placement (research/26 §1a: 290 wide at x 1210 of a 1512 window)', () => {
    const popoverOf = (): HTMLElement | null => document.querySelector('[data-blok-testid="panel"]')?.closest<HTMLElement>('[data-blok-popover-custom-class]') ?? null;

    it('hugs the window\'s end edge, 12px in, at the anchor\'s top, whatever opened it', () => {
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 300, 28, 28));
      const panel = new DatabasePanel({ anchor, root: { build: () => [] }, testId: 'panel', width: 290, backLabel: 'Back', docked: true });

      panel.open();
      const popover = popoverOf();

      expect(popover?.getAttribute('data-blok-popover-custom-class')).toContain('blok-database-docked-panel');
      // jsdom measures the box 0 wide, so its start edge is the end edge.
      expect(popover?.style.left).toBe(`${window.innerWidth - 12}px`);
      expect(popover?.style.top).toBe('300px');
      panel.close();
    });

    it('opens under its anchor when not docked', () => {
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 300, 28, 28));
      open({ build: () => [] });

      expect(popoverOf()?.getAttribute('data-blok-popover-custom-class')).not.toContain('blok-database-docked-panel');
      expect(popoverOf()?.style.left).toBe('40px');
    });
  });

  describe('pointer drag (Notion r35:497-509)', () => {
    /** Notion's measured sort list: 32px rows, 40px apart, list top 133. */
    const dragList = (ids: string[], onMove = vi.fn()): { list: HTMLElement; row: (id: string) => HTMLElement; onMove: typeof onMove } => {
      const list = panelReorderList({
        testId: 'list',
        handleLabel: 'Drag',
        items: ids.map((id) => ({ id, element: document.createElement('span') })),
        onMove,
      });

      document.body.appendChild(list);
      const row = (id: string): HTMLElement => {
        const found = list.querySelector<HTMLElement>(`[data-item-id="${id}"]`);

        if (!found) throw new Error(`no row ${id}`);

        return found;
      };

      ids.forEach((id, index) => {
        const top = 133 + index * 40;

        vi.spyOn(row(id), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 290, 32));
      });

      return { list, row, onMove };
    };
    const down = (list: HTMLElement, id: string, clientY: number): void => {
      list.querySelector<HTMLElement>(`[data-blok-testid="list-handle-${id}"]`)
        ?.dispatchEvent(new PointerEvent('pointerdown', { clientY, button: 0, bubbles: true, cancelable: true }));
    };
    const move = (clientY: number): void => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientY, bubbles: true }));
    };
    const up = (clientY: number): void => {
      document.dispatchEvent(new PointerEvent('pointerup', { clientY, bubbles: true }));
    };

    it('follows the pointer past the threshold, jumps the neighbour one slot, and drops in the shown order', () => {
      const { list, row, onMove } = dragList(['f', 'num']);

      down(list, 'num', 189);
      move(186);
      move(180);
      expect(row('num').style.top).toBe('');
      expect(row('num').hasAttribute('data-dragging')).toBe(false);

      move(170);
      expect(row('num').style.top).toBe('-19px');
      expect(row('num').hasAttribute('data-dragging')).toBe(true);
      expect(row('f').style.top).toBe('');

      move(160);
      expect(row('num').style.top).toBe('-29px');
      expect(row('f').style.top).toBe('40px');
      expect(row('f').style.position).toBe('relative');

      move(150);
      expect(row('num').style.top).toBe('-39px');
      move(144);
      expect(row('num').style.top).toBe('-40px');
      expect(row('f').style.top).toBe('40px');

      up(144);
      expect(onMove.mock.calls).toEqual([['num', 'f']]);
      expect(row('num').style.top).toBe('');
      expect(row('f').style.top).toBe('');
      expect(row('f').style.position).toBe('');
      expect(row('num').hasAttribute('data-dragging')).toBe(false);
    });

    it('clamps at the list end and passes every row it crosses', () => {
      const { list, row, onMove } = dragList(['a', 'b', 'c']);

      down(list, 'a', 149);
      move(400);
      expect(row('a').style.top).toBe('80px');
      expect(row('b').style.top).toBe('-40px');
      expect(row('c').style.top).toBe('-40px');

      up(400);
      expect(onMove.mock.calls).toEqual([['a', null]]);
    });

    it('puts a neighbour back when the row returns over it', () => {
      const { list, row, onMove } = dragList(['a', 'b', 'c']);

      down(list, 'a', 149);
      move(185);
      expect(row('b').style.top).toBe('-40px');
      move(150);
      expect(row('b').style.top).toBe('');

      up(150);
      expect(onMove).not.toHaveBeenCalled();
    });

    it('jumps a passed row by the dragged row height plus the gap', () => {
      const { list, row } = dragList(['a', 'b', 'c']);

      vi.spyOn(row('b'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 173, 290, 60));
      vi.spyOn(row('c'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 241, 290, 32));

      down(list, 'b', 200);
      move(150);
      expect(row('a').style.top).toBe('68px');
      move(260);
      expect(row('a').style.top).toBe('');
      expect(row('c').style.top).toBe('-68px');
    });

    it('does not reorder on a click or a move under the threshold', () => {
      const { list, row, onMove } = dragList(['a', 'b']);

      down(list, 'b', 189);
      move(180);
      up(180);

      expect(onMove).not.toHaveBeenCalled();
      expect(row('b').hasAttribute('data-dragging')).toBe(false);
    });

    it('drops nothing and clears every row on pointercancel', () => {
      const { list, row, onMove } = dragList(['a', 'b']);

      down(list, 'b', 189);
      move(150);
      document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      move(100);

      expect(onMove).not.toHaveBeenCalled();
      expect(row('a').style.top).toBe('');
      expect(row('b').style.top).toBe('');
      expect(row('b').hasAttribute('data-dragging')).toBe(false);
    });
  });
});
