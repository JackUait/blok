import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabasePanel, panelReorderList, panelRow, panelSwitch } from '../../../../src/tools/database/database-panel';
import type { PanelPage } from '../../../../src/tools/database/database-panel';

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
});
