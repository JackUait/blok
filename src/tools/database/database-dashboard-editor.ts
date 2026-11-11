import { IconChart, IconCopy, IconHash, IconListBulleted, IconSliders, IconTable, IconTrash } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import type { WidgetPlacement } from '../../shared/database/dashboard';
import { MAX_WIDGETS_PER_ROW } from '../../shared/database/dashboard';

/** The kinds "Add widget" offers. Number is a chart view drawn as one value. */
export type DashboardWidgetKind = 'chart' | 'number' | 'table' | 'list';

const WIDGET_KINDS: Array<{ kind: DashboardWidgetKind; icon: string; labelKey: string }> = [
  { kind: 'chart', icon: IconChart, labelKey: 'tools.database.viewTypeChart' },
  { kind: 'number', icon: IconHash, labelKey: 'tools.database.chartTypeNumber' },
  { kind: 'table', icon: IconTable, labelKey: 'tools.database.viewTypeTable' },
  { kind: 'list', icon: IconListBulleted, labelKey: 'tools.database.viewTypeList' },
];

/** Blok's own values: Notion's widget editor is behind a paid plan and unmeasured. */
const DRAG_THRESHOLD = 4;
/** A drop this close to a row's top or bottom edge starts a new row there. */
const ROW_EDGE = 16;

export interface DashboardEditorHandlers {
  t: (key: string) => string;
  addWidget: (kind: DashboardWidgetKind) => void;
  editWidget: (widgetId: string, anchor: HTMLElement) => void;
  duplicateWidget: (widgetId: string) => void;
  removeWidget: (widgetId: string) => void;
  moveWidget: (widgetId: string, placement: WidgetPlacement) => void;
}

interface RowBox {
  rowId: string;
  top: number;
  bottom: number;
  widgets: Array<{ id: string; left: number; right: number }>;
}

/**
 * Where a widget dropped at (x, y) goes. Near a row's top or bottom edge, or
 * between rows, it starts a new row; inside a row it goes before the first
 * widget whose centre is right of x. A full row takes no more.
 */
export const dashboardDropTarget = (rows: RowBox[], draggedId: string, x: number, y: number): WidgetPlacement | null => {
  for (const [index, row] of rows.entries()) {
    if (y < row.top) return { newRowAt: index };
    if (y > row.bottom) continue;
    if (y < row.top + ROW_EDGE) return { newRowAt: index };
    if (y > row.bottom - ROW_EDGE) return { newRowAt: index + 1 };
    const others = row.widgets.filter((widget) => widget.id !== draggedId);

    if (others.length >= MAX_WIDGETS_PER_ROW) return null;

    return { rowId: row.rowId, index: others.filter((widget) => (widget.left + widget.right) / 2 < x).length };
  }

  return { newRowAt: rows.length };
};

const rowBoxes = (root: HTMLElement): RowBox[] =>
  [...root.querySelectorAll<HTMLElement>(':scope > [data-blok-database-dashboard-row]')].map((row) => {
    const rect = row.getBoundingClientRect();

    return {
      rowId: row.getAttribute('data-blok-database-dashboard-row') ?? '',
      top: rect.top,
      bottom: rect.bottom,
      widgets: [...row.querySelectorAll<HTMLElement>(':scope > [data-blok-database-dashboard-widget]')].map((widget) => {
        const box = widget.getBoundingClientRect();

        return { id: widget.getAttribute('data-blok-database-dashboard-widget') ?? '', left: box.left, right: box.right };
      }),
    };
  });

function showMenu(trigger: HTMLElement, items: PopoverItemParams[], onClosed: (popover: PopoverDesktop) => void): PopoverDesktop {
  const popover = new PopoverDesktop({
    class: DATABASE_MENU_CLASS,
    animateClose: true,
    trigger,
    width: 'auto',
    minWidth: '160px',
    autoFocusFirstItem: false,
    items,
  });

  const closed = { done: false };

  // destroy() closes the popover again: without the flag the two call each other forever.
  popover.on(PopoverEvent.Closed, () => {
    if (closed.done) return;
    closed.done = true;
    onClosed(popover);
    popover.destroy();
  });
  popover.show();

  return popover;
}

/**
 * The dashboard's edit controls: "Add widget", each widget's "⋯" menu, and
 * moving a widget by dragging its header. Returns the teardown.
 */
export function wireDashboardEditor(root: HTMLElement, handlers: DashboardEditorHandlers): () => void {
  const state: {
    menu: PopoverDesktop | null;
    drag: { widgetId: string; host: HTMLElement; startX: number; startY: number; pointerId: number; active: boolean; target: WidgetPlacement | null } | null;
    line: HTMLElement | null;
  } = { menu: null, drag: null, line: null };

  const closeMenu = (): void => {
    const menu = state.menu;

    state.menu = null;
    menu?.hide();
  };
  const forget = (popover: PopoverDesktop): void => {
    if (state.menu === popover) state.menu = null;
  };

  const addMenu = (anchor: HTMLElement): void => {
    closeMenu();
    state.menu = showMenu(anchor, WIDGET_KINDS.map((option) => ({
      icon: option.icon,
      name: `database-dashboard-add-${option.kind}`,
      title: handlers.t(option.labelKey),
      closeOnActivate: true,
      onActivate: () => handlers.addWidget(option.kind),
    })), forget);
  };

  const widgetMenu = (anchor: HTMLElement, widgetId: string): void => {
    closeMenu();
    state.menu = showMenu(anchor, [
      {
        icon: IconSliders,
        name: 'database-dashboard-widget-edit',
        title: handlers.t('tools.database.editView'),
        closeOnActivate: true,
        onActivate: () => handlers.editWidget(widgetId, anchor),
      },
      { type: PopoverItemType.Separator },
      {
        icon: IconCopy,
        name: 'database-dashboard-widget-duplicate',
        title: handlers.t('tools.database.duplicateView'),
        closeOnActivate: true,
        onActivate: () => handlers.duplicateWidget(widgetId),
      },
      {
        icon: IconTrash,
        name: 'database-dashboard-widget-remove',
        title: handlers.t('tools.database.deleteView'),
        isDestructive: true,
        closeOnActivate: true,
        onActivate: () => handlers.removeWidget(widgetId),
      },
    ], forget);
  };

  const click = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const add = target?.closest<HTMLElement>('[data-blok-database-dashboard-add-widget]');
    const menu = target?.closest<HTMLElement>('[data-blok-database-dashboard-widget-menu]');

    if (add !== null && add !== undefined && root.contains(add)) {
      event.stopPropagation();
      addMenu(add);
    } else if (menu !== null && menu !== undefined && root.contains(menu)) {
      const widgetId = menu.closest('[data-blok-database-dashboard-widget]')?.getAttribute('data-blok-database-dashboard-widget');

      event.stopPropagation();
      if (typeof widgetId === 'string') widgetMenu(menu, widgetId);
    }
  };

  const clearLine = (): void => {
    state.line?.remove();
    state.line = null;
  };

  const paintLine = (placement: WidgetPlacement | null): void => {
    clearLine();
    if (placement === null) return;
    const line = document.createElement('div');
    const base = root.getBoundingClientRect();

    line.setAttribute('data-blok-database-dashboard-drop', 'newRowAt' in placement ? 'row' : 'column');
    if ('newRowAt' in placement) {
      const rows = root.querySelectorAll<HTMLElement>(':scope > [data-blok-database-dashboard-row]');
      const before = rows[placement.newRowAt]?.getBoundingClientRect();
      const after = rows[placement.newRowAt - 1]?.getBoundingClientRect();

      line.style.top = `${(before?.top ?? after?.bottom ?? base.top) - base.top}px`;
    } else {
      const row = [...root.querySelectorAll<HTMLElement>(':scope > [data-blok-database-dashboard-row]')]
        .find((entry) => entry.getAttribute('data-blok-database-dashboard-row') === placement.rowId);
      const widgets = [...row?.querySelectorAll<HTMLElement>(':scope > [data-blok-database-dashboard-widget]') ?? []]
        .filter((widget) => widget !== state.drag?.host);
      const next = widgets[placement.index ?? widgets.length]?.getBoundingClientRect();
      const prev = widgets[(placement.index ?? widgets.length) - 1]?.getBoundingClientRect();
      const box = row?.getBoundingClientRect();

      line.style.left = `${(next?.left ?? prev?.right ?? box?.left ?? base.left) - base.left}px`;
      line.style.top = `${(box?.top ?? base.top) - base.top}px`;
      line.style.height = `${box?.height ?? 0}px`;
    }
    root.appendChild(line);
    state.line = line;
  };

  const endDrag = (): void => {
    state.drag?.host.removeAttribute('data-dragging');
    root.removeAttribute('data-dragging');
    state.drag = null;
    clearLine();
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', endDrag);
    window.removeEventListener('keydown', escape, true);
  };

  const move = (event: PointerEvent): void => {
    const drag = state.drag;

    if (drag === null || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.active = true;
    drag.host.setAttribute('data-dragging', '');
    root.setAttribute('data-dragging', '');
    drag.target = dashboardDropTarget(rowBoxes(root), drag.widgetId, event.clientX, event.clientY);
    paintLine(drag.target);
  };

  const up = (event: PointerEvent): void => {
    const drag = state.drag;

    if (drag === null || event.pointerId !== drag.pointerId) return;
    const target = drag.active ? drag.target : null;
    const widgetId = drag.widgetId;

    endDrag();
    if (target !== null) handlers.moveWidget(widgetId, target);
  };

  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || state.drag === null) return;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
  };

  const down = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const header = target?.closest('[data-blok-database-dashboard-widget-header]');
    const host = header?.closest<HTMLElement>('[data-blok-database-dashboard-widget]');

    if (event.button !== 0 || header === null || header === undefined || host === null || host === undefined
      || target?.closest('[data-blok-database-dashboard-widget-menu]') !== null) return;
    event.preventDefault();
    endDrag();
    state.drag = {
      widgetId: host.getAttribute('data-blok-database-dashboard-widget') ?? '',
      host,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      active: false,
      target: null,
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', endDrag);
    // On window: it runs before the editor's own Escape handling on the document.
    window.addEventListener('keydown', escape, true);
  };

  root.addEventListener('click', click);
  root.addEventListener('pointerdown', down);

  return () => {
    closeMenu();
    endDrag();
    root.removeEventListener('click', click);
    root.removeEventListener('pointerdown', down);
  };
}
