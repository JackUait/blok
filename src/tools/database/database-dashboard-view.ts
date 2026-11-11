import { IconPlus, IconDotsHorizontal } from '../../components/icons';
import { onHover } from '../../components/utils/tooltip';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DashboardRow, DashboardWidget, DatabaseRow } from './types';

export interface DashboardMount {
  renderer: DatabaseViewRenderer;
  root: HTMLDivElement;
  readonly interacting: boolean;
  revoke(): void;
  destroy(): void;
}

/** The widget chrome. Without it a widget is its bare view, as a bound view needs. */
export interface DashboardChrome {
  /** The widget's view name, shown above it. */
  title: (widget: DashboardWidget) => string;
  /** The empty dashboard's line. */
  emptyText: string;
  /** Set when people may edit the layout: the "Add widget" and "⋯" labels. */
  edit?: { addWidget: string; menu: string; drag: string };
  /** Wires the edit controls. Returns its teardown. */
  wire?: (root: HTMLElement) => () => void;
}

export class DatabaseDashboardView implements DatabaseViewRenderer {
  private readonly mounts: DashboardMount[] = [];
  private unwire: (() => void) | null = null;

  constructor(private readonly options: {
    rows: DashboardRow[];
    /** One view bound to a second source: no grid, the view scrolls itself. */
    single?: boolean;
    chrome?: DashboardChrome;
    mount: (widget: DashboardWidget, host: HTMLElement) => DashboardMount | { error: string };
  }) {}

  createView(): HTMLDivElement {
    const root = document.createElement('div');
    const chrome = this.options.chrome;

    root.setAttribute('data-blok-database-dashboard', '');
    if (this.options.single === true) root.setAttribute('data-blok-database-source-view', '');
    if (chrome !== undefined && this.options.rows.length === 0) root.appendChild(this.createEmpty(chrome));
    for (const row of this.options.rows) {
      const rowEl = document.createElement('div');

      rowEl.setAttribute('data-blok-database-dashboard-row', row.id);
      rowEl.style.display = 'grid';
      rowEl.style.gridTemplateColumns = 'repeat(12, minmax(0, 1fr))';
      if (row.height !== undefined) rowEl.style.height = `${row.height}px`;
      for (const widget of row.widgets) {
        rowEl.appendChild(this.createWidget(widget));
      }
      root.appendChild(rowEl);
    }
    if (chrome?.edit !== undefined && this.options.rows.length > 0) root.appendChild(addWidgetButton(chrome.edit.addWidget));
    if (chrome?.edit !== undefined) root.setAttribute('data-blok-database-dashboard-editable', '');
    this.unwire = chrome?.wire?.(root) ?? null;

    return root;
  }

  private createEmpty(chrome: DashboardChrome): HTMLDivElement {
    const empty = document.createElement('div');
    const text = document.createElement('p');

    empty.setAttribute('data-blok-database-dashboard-empty', '');
    text.textContent = chrome.emptyText;
    empty.appendChild(text);
    if (chrome.edit !== undefined) empty.appendChild(addWidgetButton(chrome.edit.addWidget));

    return empty;
  }

  private createHeader(widget: DashboardWidget, chrome: DashboardChrome): HTMLDivElement {
    const header = document.createElement('div');
    const title = document.createElement('span');

    header.setAttribute('data-blok-database-dashboard-widget-header', '');
    title.setAttribute('data-blok-database-dashboard-widget-title', '');
    title.textContent = chrome.title(widget);
    header.appendChild(title);
    if (chrome.edit !== undefined) {
      const menu = document.createElement('button');

      onHover(header, chrome.edit.drag);
      menu.type = 'button';
      menu.setAttribute('data-blok-database-dashboard-widget-menu', '');
      menu.setAttribute('data-blok-testid', 'database-dashboard-widget-menu');
      menu.setAttribute('aria-label', chrome.edit.menu);
      menu.setAttribute('aria-haspopup', 'menu');
      menu.innerHTML = IconDotsHorizontal;
      header.appendChild(menu);
    }

    return header;
  }

  private createWidget(widget: DashboardWidget): HTMLDivElement {
    const host = document.createElement('div');
    const chrome = this.options.chrome;

    host.setAttribute('data-blok-database-dashboard-widget', widget.id);
    host.style.gridColumn = `span ${widget.width}`;
    host.style.minWidth = '0';
    // With a header, the view scrolls under it (database.css), not the whole widget.
    if (this.options.single !== true && chrome === undefined) host.style.overflow = 'auto';
    if (chrome !== undefined) host.appendChild(this.createHeader(widget, chrome));
    const mount = this.options.mount(widget, host);

    if ('error' in mount) {
      const error = document.createElement('p');

      error.setAttribute('data-blok-database-dashboard-widget-error', mount.error);
      error.setAttribute('role', 'status');
      error.textContent = `${widget.viewId}: ${mount.error}`;
      host.appendChild(error);
    } else {
      this.mounts.push(mount);
      host.appendChild(mount.root);
    }

    return host;
  }

  get interacting(): boolean {
    return this.mounts.some((mount) => mount.interacting);
  }

  destroy(): void {
    this.unwire?.();
    this.unwire = null;
    // Grid teardown closes its editor, which commits pending text.
    this.mounts.forEach((mount) => mount.revoke());
    this.mounts.forEach((mount) => mount.destroy());
    this.mounts.length = 0;
  }

  appendRow(_container: HTMLElement, _row: DatabaseRow): void {}

  removeRow(_wrapper: HTMLElement, rowId: string): void {
    this.mounts.forEach((mount) => mount.renderer.removeRow(mount.root, rowId));
  }

  updateRowTitle(_wrapper: HTMLElement, rowId: string, title: string): void {
    this.mounts.forEach((mount) => mount.renderer.updateRowTitle(mount.root, rowId, title));
  }
}

function addWidgetButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  const text = document.createElement('span');

  button.type = 'button';
  button.setAttribute('data-blok-database-dashboard-add-widget', '');
  button.setAttribute('data-blok-testid', 'database-dashboard-add-widget');
  button.innerHTML = IconPlus;
  text.textContent = label;
  button.appendChild(text);

  return button;
}
