import { nanoid } from 'nanoid';
import { IconCross, IconPlus } from '../../../components/icons';
import { safeHref } from '../../../components/utils/sanitize-url';
import { promoteToTopLayer, removeFromTopLayer } from '../../../components/utils/top-layer';
import { fileChipIcon } from '../page-icon';
import type { FileValue, PropertyDefinition, PropertyValue } from '../types';
import { filesOf } from '../property-values';
import { CellPopover, coverMinWidth } from './cell-popover';
import type { CellEditorContext, CellEditorHandle } from './types';

/** A file's name from its URL: the last path segment, decoded. */
export const fileNameFromUrl = (url: string): string => {
  const path = url.split(/[?#]/)[0].split('/').filter((part) => part !== '');
  const last = path.at(-1) ?? url;

  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

/** notion-spec-2 §18.3: the Upload / Link panel is 300 wide. */
const PANEL_WIDTH = 300;
/** The panel slides to stay this far inside the window, like the box over the cell. */
const PANEL_VIEWPORT_MARGIN = 12;
/** notion-spec-2 §19.22: the panel fades out over 0.2s (database.css). */
const PANEL_FADE_MS = 200;

type PanelTab = 'upload' | 'link';

const tabIds = { next: 0 };

/**
 * The files panel: the current files with a remove button each, then
 * Notion's "Add a file or image" tabs, Upload (only with a host uploader)
 * and Link. Every change commits the whole list.
 */
class FilesEditor implements CellEditorHandle {
  private readonly root = document.createElement('div');
  private readonly list = document.createElement('div');
  /** "Add a file or image", or "Replace a file or image" under Limit 1 file with a file present. */
  private readonly addLabel = document.createElement('div');
  private readonly popover: CellPopover;
  private files: FileValue[];
  private open = true;
  /** The table's Upload / Link panel under the box; null when closed. */
  private panel: HTMLElement | null = null;

  constructor(
    private readonly property: PropertyDefinition,
    value: PropertyValue | undefined,
    anchor: HTMLElement,
    private readonly ctx: CellEditorContext
  ) {
    this.files = filesOf(value);
    this.root.setAttribute('data-blok-database-files-editor', '');
    this.list.setAttribute('data-blok-database-files-list', '');
    if (ctx.coverCell === true) {
      this.popover = this.buildTable(anchor);
      this.renderList();
      this.popover.show();
      if (this.files.length === 0) this.openPanel();

      return;
    }

    this.addLabel.setAttribute('data-blok-database-select-hint', '');
    this.root.append(this.list, this.addLabel);
    if (ctx.uploadFile !== undefined) {
      this.root.appendChild(this.buildUpload(ctx.uploadFile));
    }
    this.root.appendChild(this.buildLink());

    this.popover = new CellPopover({
      anchor,
      cover: ctx.coverCell,
      content: this.root,
      minWidth: coverMinWidth(anchor, ctx.coverCell, 280),
      onEscape: () => this.finish(true),
      onDismiss: () => this.finish(false),
    });
    this.renderList();
    this.popover.show();
  }

  get isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.finish(true);
  }

  cancel(): void {
    this.finish(true);
  }

  private t(key: string): string {
    return this.ctx.i18n.t(key);
  }

  private finish(closePopover: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.dropPanel();
    if (closePopover) this.popover.close();
    this.ctx.onClose?.();
  }

  private setFiles(files: FileValue[]): void {
    const added = files.length > this.files.length;

    this.files = files;
    this.ctx.onCommit(files.map((file) => ({ ...file })));
    this.renderList();
    // notion-spec-2 §19.17: the panel closes once a file is added.
    if (added) this.dropPanel();
  }

  /** notion-spec-2 §20.7: under Limit 1 file, adding replaces the file. */
  private addFile(file: FileValue): void {
    this.setFiles(this.property.files?.limit === 1 ? [file] : [...this.files, file]);
  }

  private buildUpload(upload: NonNullable<CellEditorContext['uploadFile']>): HTMLElement {
    const label = document.createElement('label');
    const input = document.createElement('input');

    label.setAttribute('data-blok-database-files-upload', '');
    label.append(this.t('tools.database.filesUpload'));
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('data-blok-database-files-input', '');
    input.addEventListener('change', () => {
      const picked = [...(input.files ?? [])];

      input.value = '';
      for (const file of picked) {
        void upload(file).then((stored) => {
          const url = safeHref(stored.url);

          if (url !== null && this.open) {
            this.addFile({ id: nanoid(), name: stored.name ?? file.name, url });
          }
        }).catch(() => undefined);
      }
    });
    label.appendChild(input);

    return label;
  }

  private buildLink(): HTMLElement {
    const form = document.createElement('div');
    const input = document.createElement('input');
    const submit = document.createElement('button');

    form.setAttribute('data-blok-database-files-link', '');
    input.type = 'url';
    input.inputMode = 'url';
    input.setAttribute('data-blok-database-files-link-input', '');
    input.setAttribute('aria-label', this.t('tools.database.filesLinkLabel'));
    input.placeholder = this.t('tools.database.filesLinkPlaceholder');
    if (this.ctx.coverCell === true) input.setAttribute('data-blok-field', 'text');
    submit.type = 'button';
    submit.setAttribute('data-blok-database-files-link-submit', '');
    // notion-spec-2 §18.3: the table panel's button reads "Link".
    submit.textContent = this.t(this.ctx.coverCell === true ? 'tools.database.filesTabLink' : 'tools.database.filesEmbed');

    const add = (): void => {
      const raw = input.value.trim();
      const url = /^https?:\/\//i.test(raw) ? safeHref(raw) : null;

      if (url === null) {
        input.setAttribute('aria-invalid', 'true');

        return;
      }
      input.value = '';
      input.removeAttribute('aria-invalid');
      this.addFile({ id: nanoid(), name: fileNameFromUrl(raw), url });
    };

    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        add();
      }
    });
    submit.addEventListener('click', add);
    form.append(input, submit);

    return form;
  }

  /**
   * notion-spec-2 §18.3, §19.17: a box over the cell holds the files and an
   * "Add a file or image" row; the Upload / Link panel opens under it, at once
   * on an empty cell.
   */
  private buildTable(anchor: HTMLElement): CellPopover {
    const add = document.createElement('div');
    const icon = document.createElement('span');
    const label = document.createElement('span');

    this.root.setAttribute('data-layout', 'table');
    add.setAttribute('data-blok-database-files-add', '');
    add.setAttribute('role', 'button');
    add.tabIndex = -1;
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = IconPlus;
    label.textContent = this.t('tools.database.filesAdd');
    add.append(icon, label);
    add.addEventListener('click', () => {
      if (this.panel === null) this.openPanel();
    });
    this.root.append(this.list, add);

    return new CellPopover({
      anchor,
      cover: true,
      content: this.root,
      // notion-spec-2 §18.3: 240 wide over a 200 cell; it grows to fit a name (database.css).
      minWidth: coverMinWidth(anchor, true, 240),
      onEscape: () => {
        if (this.panel !== null) this.fadePanel();
        else this.finish(true);
      },
      onDismiss: () => this.finish(false),
    });
  }

  private openPanel(): void {
    const panel = document.createElement('div');
    const tabs = document.createElement('div');
    const body = document.createElement('div');
    const upload = this.ctx.uploadFile;
    const names: PanelTab[] = upload === undefined ? ['link'] : ['upload', 'link'];
    const id = `blok-database-files-tab-${++tabIds.next}`;
    const buttons = new Map<PanelTab, HTMLElement>();

    const select = (name: PanelTab): void => {
      buttons.forEach((button, key) => {
        button.setAttribute('aria-selected', String(key === name));
        button.setAttribute('tabindex', key === name ? '0' : '-1');
      });
      body.setAttribute('aria-labelledby', `${id}-${name}`);
      body.replaceChildren(name === 'upload' && upload !== undefined ? this.buildUpload(upload) : this.buildLink());
    };

    panel.setAttribute('data-blok-database-files-panel', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', this.t('tools.database.filesAdd'));
    tabs.setAttribute('data-blok-database-files-tabs', '');
    tabs.setAttribute('role', 'tablist');
    body.setAttribute('data-blok-database-files-tabpanel', '');
    body.setAttribute('role', 'tabpanel');
    names.forEach((name) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.id = `${id}-${name}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('data-blok-database-files-tab', name);
      button.textContent = this.t(name === 'upload' ? 'tools.database.filesTabUpload' : 'tools.database.filesTabLink');
      button.addEventListener('click', () => {
        select(name);
        body.querySelector<HTMLInputElement>('[data-blok-database-files-link-input]')?.focus();
      });
      buttons.set(name, button);
      tabs.appendChild(button);
    });
    panel.append(tabs, body);
    select(names[0]);
    this.root.appendChild(panel);
    this.panel = panel;
    promoteToTopLayer(panel);
    this.placePanel(panel);
    buttons.get(names[0])?.focus();
  }

  /** notion-spec-2 §18.3: centred under the box, its top on the box's bottom. */
  private placePanel(panel: HTMLElement): void {
    const box = this.root.getBoundingClientRect();
    const centred = box.left + box.width / 2 - PANEL_WIDTH / 2;
    const left = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(centred, window.innerWidth - PANEL_VIEWPORT_MARGIN - PANEL_WIDTH));

    Object.assign(panel.style, { position: 'fixed', left: `${left}px`, top: `${box.bottom}px` });
  }

  /** notion-spec-2 §19.22: the first Escape fades the panel out; the box stays. */
  private fadePanel(): void {
    const panel = this.panel;

    if (panel === null) return;
    this.panel = null;
    panel.setAttribute('data-closing', '');
    this.focusAddRow(panel);
    setTimeout(() => this.removePanel(panel), PANEL_FADE_MS);
  }

  private dropPanel(): void {
    const panel = this.panel;

    this.panel = null;
    if (panel === null) return;
    if (this.open) this.focusAddRow(panel);
    this.removePanel(panel);
  }

  /** Keys stay in the editor once the panel that held focus goes. */
  private focusAddRow(panel: HTMLElement): void {
    if (panel.contains(document.activeElement)) {
      this.root.querySelector<HTMLElement>('[data-blok-database-files-add]')?.focus();
    }
  }

  private removePanel(panel: HTMLElement): void {
    removeFromTopLayer(panel);
    panel.remove();
  }

  private renderList(): void {
    this.addLabel.textContent = this.t(this.property.files?.limit === 1 && this.files.length > 0 ? 'tools.database.filesReplace' : 'tools.database.filesAdd');
    this.list.replaceChildren(...this.files.map((file) => {
      const row = document.createElement('div');
      const name = document.createElement('span');
      const remove = document.createElement('button');

      row.setAttribute('data-blok-database-file-row', file.id);
      name.textContent = file.name;

      remove.type = 'button';
      remove.setAttribute('data-blok-database-file-remove', '');
      remove.setAttribute('aria-label', this.t('tools.database.removeOption').replace('{option}', file.name));
      remove.innerHTML = IconCross;
      remove.addEventListener('click', () => this.setFiles(this.files.filter((f) => f.id !== file.id)));
      row.append(name, remove);
      // notion-spec-2 §19.17: the page glyph leads each file row in the table box.
      if (this.ctx.coverCell === true) row.prepend(fileChipIcon());

      return row;
    }));
  }
}

export const openFilesEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => new FilesEditor(property, value, anchor, ctx);
