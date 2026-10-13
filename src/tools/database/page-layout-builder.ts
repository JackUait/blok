import type { I18n } from '../../../types';
import { englishDictionary } from '../../components/i18n/lightweight-i18n';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconCheck, IconChevronDown, IconCross, IconDatabase, IconPage } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';
import type { ModalDialogHandle } from '../../components/utils/modal-dialog';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { openDatabaseConfirm } from './database-confirm-dialog';

/** A page the Preview switch offers. */
export interface PreviewPage {
  id: string;
  title: string;
}

export interface PageLayoutBuilderOptions {
  i18n?: I18n;
  /** The database's name for the top bar. Empty shows the new-database placeholder. */
  title: string;
  /** The live element whose direction the builder takes: it mounts outside the editor. */
  directionSource: Element | null;
  /** Whether the open draft holds any edit. Cancel asks first when it does. */
  hasEdits: () => boolean;
  onApply: () => void;
  /** Cancel, after the discard question when there were edits. */
  onDiscard: () => void;
  onReset: () => void;
  onPageSettings: (anchor: HTMLElement) => void;
  /** The property search changed. */
  onSearch: () => void;
  /** Every page, in view order. Empty when the database has no rows. */
  pages: () => PreviewPage[];
  /** The page in the canvas. Null is the "New page" placeholder. */
  previewId: () => string | null;
  onPreview: (id: string) => void;
}

/**
 * The full-window "Customize page layout" builder (research/09 §1, §10). UI
 * only: the drawer owns the draft and draws the page regions into `canvas`.
 */
export class PageLayoutBuilder {
  readonly canvas: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly options: PageLayoutBuilderOptions;
  private readonly dialog: ModalDialogHandle;
  private menu: PopoverDesktop | null = null;
  /** The discard question; closing the builder closes it too. */
  private confirm: AbortController | null = null;

  constructor(options: PageLayoutBuilderOptions) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.setAttribute('data-blok-interface', 'database-layout-builder');
    this.root.setAttribute('data-blok-database-layout-builder', '');
    // Without it the editor's document keydown turns Tab into block navigation.
    this.root.setAttribute(DATA_ATTR.keyboardOwner, '');

    const bar = document.createElement('div');
    const heading = document.createElement('div');
    const name = document.createElement('div');
    const title = document.createElement('span');
    const actions = document.createElement('div');
    const split = document.createElement('div');
    const more = this.button('data-blok-database-layout-more-save', IconChevronDown, null, (el) => this.openMoreSave(el));

    bar.setAttribute('data-blok-database-layout-topbar', '');
    heading.setAttribute('data-blok-database-layout-heading', '');
    name.setAttribute('data-blok-database-layout-heading-name', '');
    name.innerHTML = IconDatabase;
    title.setAttribute('data-blok-database-layout-title', '');
    this.title = title;
    this.setTitle(options.title);
    name.appendChild(title);
    // research/09 §2: the Preview switch, centered under the database title.
    const preview = this.button('data-blok-database-layout-preview', null, null, (el) => this.openPreview(el));

    this.preview = document.createElement('span');
    preview.setAttribute('aria-haspopup', 'menu');
    preview.append(this.preview);
    preview.insertAdjacentHTML('beforeend', IconChevronDown);
    heading.append(name, preview);
    actions.setAttribute('data-blok-database-layout-actions', '');
    split.setAttribute('data-blok-database-layout-apply-split', '');
    more.setAttribute('aria-label', this.label('tools.database.layoutMoreSaveOptions'));
    more.setAttribute('aria-haspopup', 'menu');
    split.append(this.button('data-blok-database-layout-apply', IconCheck, 'tools.database.layoutApply', () => options.onApply()), more);
    actions.append(this.button('data-blok-database-layout-cancel', IconCross, 'tools.database.layoutCancel', () => this.cancel()), split);
    bar.append(heading, actions);

    const body = document.createElement('div');
    const side = document.createElement('div');

    body.setAttribute('data-blok-database-layout-body', '');
    this.canvas = document.createElement('div');
    this.canvas.setAttribute('data-blok-database-layout-canvas', '');
    side.setAttribute('data-blok-database-layout-side', '');
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.setAttribute('data-blok-database-layout-search', '');
    this.search.setAttribute('data-blok-database-search-input', '');
    this.search.setAttribute('aria-label', this.label('tools.database.searchLabel'));
    this.search.placeholder = this.label('tools.database.searchPlaceholder');
    this.search.addEventListener('input', () => options.onSearch());
    side.append(this.button('data-blok-database-layout-settings', null, 'tools.database.layoutPageSettings', (el) => options.onPageSettings(el)), this.search);
    body.append(this.canvas, side);
    this.root.append(bar, body);

    // Escape never closes the builder; only Cancel and Apply do (research/10 §9).
    // Joins Escape so a toast below can't take it; the dialog closes an owned menu first.
    this.dialog = openModalDialog({
      content: this.root,
      label: this.label('tools.database.layoutCustomizePage'),
      directionSource: options.directionSource,
      escape: true,
      outside: false,
      onDismiss: () => undefined,
    });
  }

  /** The property search, lowercased. */
  get query(): string {
    return this.search.value.trim().toLowerCase();
  }

  /** The database's name. Empty shows the new-database placeholder. */
  setTitle(title: string): void {
    this.title.textContent = title.trim() !== '' ? title : this.label('tools.database.titlePlaceholder');
  }

  /** The page in the canvas. Empty shows the "New page" placeholder. */
  setPreview(title: string): void {
    this.preview.textContent = this.label('tools.database.layoutPreview', { page: this.pageTitle(title) });
  }

  /** Is `target` inside the builder or one of its menus? */
  contains(target: Node): boolean {
    return this.root.contains(target);
  }

  close(): void {
    this.confirm?.abort();
    this.confirm = null;
    this.closeMenu();
    this.dialog.close();
  }

  /** Cancel: with edits, asks first (research/09 §3b). */
  private cancel(): void {
    if (!this.options.hasEdits()) {
      this.options.onDiscard();

      return;
    }
    const confirm = new AbortController();

    this.closeMenu();
    this.confirm = confirm;
    void openDatabaseConfirm({
      title: this.label('tools.database.layoutDiscardTitle'),
      confirmLabel: this.label('tools.database.layoutDiscard'),
      cancelLabel: this.label('tools.database.layoutCancel'),
      destructive: true,
      directionSource: this.root,
      // Over this modal: two focus traps on body would pull focus back and forth.
      container: this.root,
      signal: confirm.signal,
    }).then((discard) => {
      if (this.confirm !== confirm) return;
      this.confirm = null;
      if (discard) this.options.onDiscard();
    });
  }

  /**
   * research/09 §2: a focused "Search pages…" field over every page. The
   * previewed one has a trailing check and no fill. Pages come in view order (Q4).
   */
  private openPreview(anchor: HTMLElement): void {
    const pages = this.options.pages();
    const current = this.options.previewId();
    const empty = document.createElement('div');

    empty.setAttribute('data-blok-database-layout-preview-empty', '');
    empty.textContent = this.label('tools.database.layoutPreviewEmpty');
    const items: PopoverItemParams[] = pages.length === 0
      ? [{ type: PopoverItemType.Html, element: empty }]
      : pages.map((page) => ({
        type: PopoverItemType.Default,
        name: `preview-${page.id}`,
        title: this.pageTitle(page.title),
        icon: IconPage,
        ...(page.id === current ? { trailingIcon: IconCheck } : {}),
        closeOnActivate: true,
        onActivate: () => this.options.onPreview(page.id),
      }));

    this.showMenu(new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      minWidth: '300px',
      searchable: true,
      messages: {
        search: this.label('tools.database.layoutPreviewSearch'),
        nothingFound: this.label('tools.database.layoutPreviewEmpty'),
      },
      items,
    }));
  }

  /** Apply's chevron half: "Reset to original page layout" (research/10 §5). */
  private openMoreSave(anchor: HTMLElement): void {
    this.showMenu(new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      width: 'auto',
      minWidth: '220px',
      autoFocusFirstItem: false,
      items: [{
        type: PopoverItemType.Default,
        name: 'reset',
        title: this.label('tools.database.layoutReset'),
        secondaryLabel: this.label('tools.database.layoutResetDescription'),
        closeOnActivate: true,
        onActivate: () => this.options.onReset(),
      }] as PopoverItemParams[],
    }));
  }

  private showMenu(menu: PopoverDesktop): void {
    this.closeMenu();
    menu.on(PopoverEvent.Closed, () => {
      if (this.menu === menu) {
        this.menu = null;
        menu.destroy();
      }
    });
    this.menu = menu;
    menu.show();
  }

  private closeMenu(): void {
    const menu = this.menu;

    this.menu = null;
    menu?.destroy();
  }

  private button(attr: string, icon: string | null, key: string | null, onClick: (el: HTMLButtonElement) => void): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attr, '');
    if (icon !== null) button.innerHTML = icon;
    if (key !== null) button.append(this.label(key));
    button.addEventListener('click', () => onClick(button));

    return button;
  }

  private pageTitle(title: string): string {
    return title.trim() !== '' ? title : this.label('tools.database.layoutNewPage');
  }

  private label(key: string, vars?: Record<string, string>): string {
    const fallback = (englishDictionary as Record<string, string>)[key] ?? key;

    return this.options.i18n?.t(key, vars) ?? fallback.replace(/\{(\w+)\}/g, (match, name: string) => vars?.[name] ?? match);
  }
}
