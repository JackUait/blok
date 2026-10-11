import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DashboardRow, DashboardWidget, DatabaseRow } from './types';

export interface DashboardMount {
  renderer: DatabaseViewRenderer;
  root: HTMLDivElement;
  readonly interacting: boolean;
  revoke(): void;
  destroy(): void;
}

export class DatabaseDashboardView implements DatabaseViewRenderer {
  private readonly mounts: DashboardMount[] = [];

  constructor(private readonly options: {
    rows: DashboardRow[];
    mount: (widget: DashboardWidget, host: HTMLElement) => DashboardMount | { error: string };
  }) {}

  createView(): HTMLDivElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-dashboard', '');
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

    return root;
  }

  private createWidget(widget: DashboardWidget): HTMLDivElement {
    const host = document.createElement('div');

    host.setAttribute('data-blok-database-dashboard-widget', widget.id);
    host.style.gridColumn = `span ${widget.width}`;
    host.style.minWidth = '0';
    host.style.overflow = 'auto';
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
