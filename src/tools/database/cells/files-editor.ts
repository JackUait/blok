import { nanoid } from 'nanoid';
import { IconCross } from '../../../components/icons';
import { safeHref } from '../../../components/utils/sanitize-url';
import type { FileValue, PropertyDefinition, PropertyValue } from '../types';
import { filesOf } from '../property-values';
import { CellPopover } from './cell-popover';
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

/**
 * The files panel: the current files with a remove button each, then
 * Notion's "Add a file or image" tabs, Upload (only with a host uploader)
 * and Link. Every change commits the whole list.
 */
class FilesEditor implements CellEditorHandle {
  private readonly root = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly popover: CellPopover;
  private files: FileValue[];
  private open = true;

  constructor(
    private readonly property: PropertyDefinition,
    value: PropertyValue | undefined,
    anchor: HTMLElement,
    private readonly ctx: CellEditorContext
  ) {
    this.files = filesOf(value);
    this.root.setAttribute('data-blok-database-files-editor', '');
    this.list.setAttribute('data-blok-database-files-list', '');

    const heading = document.createElement('div');

    heading.setAttribute('data-blok-database-select-hint', '');
    heading.textContent = this.t('tools.database.filesAdd');
    this.root.append(this.list, heading);
    if (ctx.uploadFile !== undefined) {
      this.root.appendChild(this.buildUpload(ctx.uploadFile));
    }
    this.root.appendChild(this.buildLink());

    this.popover = new CellPopover({
      anchor,
      content: this.root,
      minWidth: `${Math.max(anchor.getBoundingClientRect().width, 280)}px`,
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
    if (closePopover) this.popover.close();
    this.ctx.onClose?.();
  }

  private setFiles(files: FileValue[]): void {
    this.files = files;
    this.ctx.onCommit(files.map((file) => ({ ...file })));
    this.renderList();
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
            this.setFiles([...this.files, { id: nanoid(), name: stored.name ?? file.name, url }]);
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
    submit.type = 'button';
    submit.setAttribute('data-blok-database-files-link-submit', '');
    submit.textContent = this.t('tools.database.filesEmbed');

    const add = (): void => {
      const raw = input.value.trim();
      const url = /^https?:\/\//i.test(raw) ? safeHref(raw) : null;

      if (url === null) {
        input.setAttribute('aria-invalid', 'true');

        return;
      }
      input.value = '';
      input.removeAttribute('aria-invalid');
      this.setFiles([...this.files, { id: nanoid(), name: fileNameFromUrl(raw), url }]);
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

  private renderList(): void {
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
