import { nanoid } from 'nanoid';

import { IconCheck, IconChevronRight, IconMenu, IconPlus } from '../../../components/icons';
import type { I18n } from '../../../../types';
import { DatabaseModel } from '../database-model';
import { orderedStatusOptions, statusGroupOf, statusGroupsOf } from '../property-values';
import { sortedSelectOptions } from '../../../shared/database/value-helpers';
import type { PropertyDefinition, SelectOption } from '../types';
import { createOptionPill } from './display';
import { pickOptionColor, shownStatusOption } from './option-colors';
import { OptionDrag, buildOptionPanel, confirmOptionDelete, placeDroppedOption } from './option-editing';
import { CellPopover } from './cell-popover';
import { openDatabaseConfirm } from '../database-confirm-dialog';

export interface OptionsEditorOptions {
  /** Shown labels: pass the localized property. */
  property: PropertyDefinition;
  i18n: Pick<I18n, 't'>;
  /** The whole new list after each add, rename, recolour, delete or move. */
  onChange: (options: SelectOption[]) => void;
  /** Status only: "Set as default" picked another option (research/30 §10f). */
  onSetDefault?: (optionId: string) => void;
  /**
   * Keeps the menu around the list open under an option's menu or a dialog, until the release.
   * `refocus`: the cursor goes back to that menu's row the list hangs from.
   */
  hold?: (() => (refocus?: boolean) => void);
  /** The menu around the list calls `close` when it closes, so a status option's menu goes with it. */
  onHostClose?: (close: () => void) => void;
}

/** notion-motion.md Round 56 §5, Round 57 §2: an option row's menu is 220 wide, like the select editor's. */
const OPTION_MENU_CLASS = 'blok-database-option-menu';
const ROW_OPTION_MENU_CLASS = 'blok-database-row-option-menu';
const GROUP_MENU_CLASS = 'blok-database-option-group-menu';
const OPTION_MENU_WIDTH = 220;
/** notion-motion.md Round 57 §4: the Group › menu is 250x94. */
const GROUP_MENU_WIDTH = 250;

interface Flyout {
  popover: CellPopover;
  root: HTMLElement;
  optionId: string;
  release: () => void;
  groupMenu: { popover: CellPopover; release: () => void; row: HTMLElement } | null;
}

const byPosition = (options: SelectOption[]): SelectOption[] =>
  [...options].sort((a, b) => (a.position < b.position ? -1 : 1));

const button = (attribute: string, icon: string, label: string): HTMLButtonElement => {
  const el = document.createElement('button');

  el.type = 'button';
  el.setAttribute(attribute, '');
  el.setAttribute('aria-label', label);
  el.innerHTML = icon;

  return el;
};

/**
 * Notion's options list under "Edit property" (research/04, H-create "Add an
 * option"; notion-spec-2 §25.6 option rows with ⋮⋮ and ›). Status shows its groups,
 * each with its own "+". The list owns its keys, so the menu around it does
 * not take arrows, Enter or Escape typed in its fields.
 */
class OptionsEditor {
  readonly root = document.createElement('div');
  private options: SelectOption[];
  /** The group whose add field is open; '' for a select. */
  private adding: string | null = null;
  private readonly drag: OptionDrag;
  private defaultId: string | undefined;
  private flyout: Flyout | null = null;
  /** Takes the delete confirm away when the menu around closes under it, or its modal leaves the page inert. */
  private deleteConfirm: AbortController | null = null;

  constructor(private readonly opts: OptionsEditorOptions) {
    this.options = this.sorted(opts.property.config?.options ?? []);
    this.defaultId = opts.property.status?.defaultOptionId;
    this.root.setAttribute('data-blok-database-options-editor', opts.property.type);
    this.root.setAttribute('data-blok-keyboard-owner', '');
    this.drag = new OptionDrag(this.root, () => this.options, (id, others, index) => {
      const dragged = this.options.find((option) => option.id === id);

      if (dragged !== undefined) {
        const placed = placeDroppedOption(this.withOptions(this.options), others, index, dragged);

        this.set(this.options.map((option) => (option.id === id ? placed : option)));
      }
    }, () => this.render());
    opts.onHostClose?.(() => {
      this.deleteConfirm?.abort();
      this.closeFlyout();
    });
    this.render();
  }

  private t(key: string): string {
    return this.opts.i18n.t(key);
  }

  private get isStatus(): boolean {
    return this.opts.property.type === 'status';
  }

  private withOptions(options: SelectOption[]): PropertyDefinition {
    return { ...this.opts.property, config: { ...this.opts.property.config, options } };
  }

  private sorted(options: SelectOption[]): SelectOption[] {
    return this.isStatus ? orderedStatusOptions(this.withOptions(options)) : sortedSelectOptions(this.opts.property, options);
  }

  private set(options: SelectOption[]): void {
    this.options = this.sorted(options);
    this.opts.onChange(options);
  }

  /**
   * Escape steps back from the add field. Window capture runs
   * before the popover registry's document-capture Escape, which would close
   * the whole menu. On only while there is something to step back from.
   */
  private readonly handleKey = (event: KeyboardEvent): void => {
    if (!this.root.isConnected) {
      window.removeEventListener('keydown', this.handleKey, true);

      return;
    }
    if (event.key !== 'Escape' || event.isComposing) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.adding = null;
    this.render();
  };

  private syncEscape(): void {
    window.removeEventListener('keydown', this.handleKey, true);
    if (this.adding !== null) {
      window.addEventListener('keydown', this.handleKey, true);
    }
  }

  private render(): void {
    this.syncEscape();
    const sections = this.isStatus
      ? statusGroupsOf(this.opts.property).map((group) => ({ id: group.id, label: group.name }))
      : [{ id: '', label: this.t('tools.database.editOptions') }];
    const rows: HTMLElement[] = [];

    for (const section of sections) {
      rows.push(this.heading(section.id, section.label));
      if (this.adding === section.id) {
        rows.push(this.addField(section.id));
      }
      const members = this.options.filter((option) => !this.isStatus || statusGroupOf(this.withOptions(this.options), option.id)?.id === section.id);

      members.forEach((option) => rows.push(this.row(option)));
      if (this.isStatus && members.length === 0 && this.adding !== section.id) {
        rows.push(this.addRow(section.id));
      }
    }
    this.root.replaceChildren(...rows);
    this.root.querySelector<HTMLInputElement>('[data-blok-database-options-add-input]')?.focus();
  }

  private heading(groupId: string, label: string): HTMLElement {
    const heading = document.createElement('div');
    const text = document.createElement('span');
    const add = button('data-blok-database-options-add', IconPlus, this.t('tools.database.addOption'));

    heading.setAttribute('data-blok-database-options-heading', '');
    if (this.isStatus) {
      heading.setAttribute('data-blok-database-status-group-heading', groupId);
      add.setAttribute('data-group-id', groupId);
    }
    text.textContent = label;
    add.addEventListener('click', () => {
      this.adding = groupId;
      this.render();
    });
    heading.append(text, add);

    return heading;
  }

  /** notion-motion.md Round 58 §7: an empty status group offers "+ Add an option"; a click opens its add field. */
  private addRow(groupId: string): HTMLElement {
    const row = document.createElement('button');

    row.type = 'button';
    row.setAttribute('data-blok-database-options-add-row', '');
    row.setAttribute('data-group-id', groupId);
    row.innerHTML = IconPlus;
    row.append(this.t('tools.database.addOption'));
    row.addEventListener('click', () => {
      this.adding = groupId;
      this.render();
    });

    return row;
  }

  private addField(groupId: string): HTMLElement {
    const input = document.createElement('input');

    input.type = 'text';
    input.setAttribute('data-blok-database-options-add-input', '');
    input.setAttribute('data-blok-database-option-name', '');
    input.setAttribute('aria-label', this.t('tools.database.addOption'));
    input.placeholder = this.t('tools.database.addOptionPlaceholder');
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) {
        return;
      }
      event.preventDefault();
      this.add(input.value.trim(), groupId);
    });

    return input;
  }

  private add(label: string, groupId: string): void {
    if (label === '' || this.options.some((option) => option.label.toLowerCase() === label.toLowerCase())) {
      return;
    }
    const peers = this.isStatus ? this.options.filter((option) => statusGroupOf(this.withOptions(this.options), option.id)?.id === groupId) : this.options;
    const last = byPosition(peers).at(-1);
    const option: SelectOption = {
      id: nanoid(),
      label,
      color: pickOptionColor(this.options),
      position: DatabaseModel.positionBetween(last?.position ?? null, null),
      ...(this.isStatus ? { groupId } : {}),
    };

    this.set([...this.options, option]);
    this.render();
  }

  private row(option: SelectOption): HTMLElement {
    const row = document.createElement('div');
    const handle = button('data-blok-database-select-option-handle', IconMenu, this.t('tools.database.dragOption'));
    const label = document.createElement('span');
    const menu = button('data-blok-database-select-option-menu', IconChevronRight, this.t('tools.database.optionMenu'));

    row.setAttribute('data-blok-database-select-option', option.id);
    // A sorted list puts a dropped option straight back, so only Manual drags.
    handle.addEventListener('pointerdown', (event) => {
      if (this.isStatus || this.opts.property.optionSort === undefined) this.drag.start(event, option.id);
    });
    handle.addEventListener('click', (event) => event.stopPropagation());
    label.setAttribute('data-blok-database-select-option-label', '');
    const pill = createOptionPill(this.isStatus ? shownStatusOption(option) : option);

    // The status pill rules in database.css draw its dot.
    if (this.isStatus) pill.setAttribute('data-status-group', statusGroupOf(this.withOptions(this.options), option.id)?.kind ?? 'todo');
    label.appendChild(pill);
    // research/30 §10f: the Edit property list reads "Not started DEFAULT". Its look was not measured.
    if (this.isStatus && option.id === this.defaultId) {
      const badge = document.createElement('span');

      badge.setAttribute('data-blok-database-option-default', '');
      badge.textContent = this.t('tools.database.templateDefault');
      label.append(' ', badge);
    }
    // Rows are rebuilt on every edit, so the open state is set here too.
    menu.setAttribute('aria-expanded', String(this.flyout?.optionId === option.id));
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openFlyout(option.id, row);
    });
    // notion-motion.md Round 56 §5 (status), Round 57 §2 (select): a click on the row opens its menu.
    row.addEventListener('click', () => this.openFlyout(option.id, row));
    row.append(handle, label, menu);

    return row;
  }

  /** The current default keeps the row (shot 23); picking it again changes nothing. */
  private setDefault(optionId: string): void {
    if (optionId === this.defaultId) return;
    this.defaultId = optionId;
    this.opts.onSetDefault?.(optionId);
    this.closeFlyout();
    this.render();
  }

  /**
   * notion-motion.md Round 57 §4: Notion asks first. Escape closes only the dialog;
   * Continue closes the option menu. The hold keeps the menu's own Escape and outside
   * presses off it while the dialog is up.
   */
  private confirmDefault(optionId: string): void {
    const flyout = this.flyout;
    const option = this.options.find((o) => o.id === optionId);

    if (flyout === null || option === undefined || optionId === this.defaultId) return;
    const release = flyout.popover.hold();
    const params = { name: option.label };
    const host = flyout.root.closest<HTMLElement>('[data-blok-popover]');

    void openDatabaseConfirm({
      title: this.opts.i18n.t('tools.database.statusDefaultConfirm', params),
      description: this.opts.i18n.t('tools.database.statusDefaultConfirmDescription', params),
      // notion-motion.md Round 58 §2: the phrase is bold and Continue a red fill.
      emphasis: this.t('tools.database.statusDefaultConfirmEmphasis'),
      confirmLabel: this.t('tools.database.buttonConfirmContinue'),
      cancelLabel: this.t('tools.database.layoutCancel'),
      destructive: true,
      filled: true,
      focusConfirm: true,
      roomy: true,
      directionSource: flyout.root,
      // Inside the menu: focus on a dialog outside it would close the menus. The top layer keeps it above them.
      ...(host === null ? {} : { container: host, topLayer: true }),
    }).then((confirmed) => {
      release();
      if (confirmed) {
        this.setDefault(optionId);
      } else if (this.flyout === flyout) {
        flyout.root.querySelector<HTMLElement>('[data-blok-database-option-name]')?.focus();
      }
    });
  }

  // ─── Option menu (notion-motion.md Round 56 §5, Round 57 §2) ───

  /** Its right edge on the row's right. The hold must start before the menu takes focus. */
  private openFlyout(optionId: string, row: HTMLElement): void {
    this.closeFlyout();
    if (this.adding !== null) {
      this.adding = null;
      this.render();
    }
    // The redraw above replaces the row.
    const anchor = row.isConnected ? row : this.root.querySelector<HTMLElement>(`[data-blok-database-select-option="${CSS.escape(optionId)}"]`) ?? row;
    const release = this.opts.hold?.() ?? ((): void => undefined);
    const root = document.createElement('div');
    const popover = new CellPopover({
      anchor,
      content: root,
      panel: true,
      surfaceClass: `${OPTION_MENU_CLASS} ${ROW_OPTION_MENU_CLASS}`,
      minWidth: `${OPTION_MENU_WIDTH}px`,
      gap: 0,
      alignEnd: true,
      // An edit redraws the list and drops this row; the list itself stays.
      positionContext: this.root,
      onEscape: () => this.closeFlyout(),
      onDismiss: () => this.closeFlyout(),
    });

    this.flyout = { popover, root, optionId, release, groupMenu: null };
    this.markOpen(optionId, true);
    popover.show();
    this.renderFlyout();
    // notion-motion.md Round 58 §4: the whole name is selected on open only, not on a later redraw.
    root.querySelector<HTMLInputElement>('input[data-blok-database-option-name]')?.select();
  }

  /** notion-motion.md Round 58 §4: the row › turns while its menu is open. */
  private markOpen(optionId: string, open: boolean): void {
    this.root
      .querySelector(`[data-blok-database-select-option="${CSS.escape(optionId)}"] [data-blok-database-select-option-menu]`)
      ?.setAttribute('aria-expanded', String(open));
  }

  private closeFlyout(): void {
    const flyout = this.flyout;

    if (flyout === null) return;
    this.closeGroupMenu();
    this.flyout = null;
    this.markOpen(flyout.optionId, false);
    flyout.popover.close();
    flyout.release();
  }

  private renderFlyout(): void {
    const flyout = this.flyout;

    if (flyout === null) return;
    const optionId = flyout.optionId;
    const option = this.options.find((o) => o.id === optionId);

    if (option === undefined) {
      this.closeFlyout();

      return;
    }
    const update = (changes: Partial<Pick<SelectOption, 'label' | 'color'>>): void => {
      this.set(this.options.map((o) => (o.id === optionId ? { ...o, ...changes } : o)));
      this.render();
    };
    const { panel, name } = buildOptionPanel(option, {
      t: (key) => this.t(key),
      onRename: (label) => update({ label }),
      onRecolor: (color) => {
        update({ color });
        this.renderFlyout();
      },
      status: this.isStatus,
      ...(this.isStatus && this.opts.onSetDefault !== undefined ? { onSetDefault: () => this.confirmDefault(optionId) } : {}),
      ...(this.isStatus ? {
        group: {
          label: statusGroupOf(this.withOptions(this.options), optionId)?.name ?? '',
          onOpen: (groupRow: HTMLElement) => this.openGroupMenu(groupRow),
        },
      } : {}),
      onDelete: () => this.confirmDelete(optionId),
    });

    flyout.root.replaceChildren(panel);
    name.focus();
  }

  /**
   * notion-motion.md Round 81 §1: the cell path's centred confirm. The option menu closes as it
   * opens; after it the cursor goes back to the menu around the list. It mounts in that menu:
   * focus on a dialog outside it would close the menus. The hold starts after the option
   * menu's release, which would undo it.
   */
  private confirmDelete(optionId: string): void {
    const host = this.root.closest<HTMLElement>('[data-blok-popover]');

    this.closeFlyout();
    const release = this.opts.hold?.() ?? ((): void => undefined);
    const confirm = new AbortController();

    this.deleteConfirm = confirm;
    void confirmOptionDelete((key) => this.t(key), {
      directionSource: this.root,
      signal: confirm.signal,
      ...(host === null ? {} : { container: host, topLayer: true }),
    }).then((confirmed) => {
      if (this.deleteConfirm !== confirm || confirm.signal.aborted) {
        release();

        return;
      }
      this.deleteConfirm = null;
      if (confirmed) {
        this.set(this.options.filter((o) => o.id !== optionId));
        this.render();
      }
      release(true);
    });
  }

  /** Group ›: the status groups, the option's own checked (notion-motion.md Round 57 §4). */
  private openGroupMenu(groupRow: HTMLElement): void {
    const flyout = this.flyout;

    if (flyout === null) return;
    this.closeGroupMenu();
    const release = flyout.popover.hold();
    const list = document.createElement('div');
    const current = statusGroupOf(this.withOptions(this.options), flyout.optionId)?.id;

    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', this.t('tools.database.groupStatusGroup'));
    statusGroupsOf(this.opts.property).forEach((group) => {
      const item = document.createElement('button');

      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(group.id === current));
      item.setAttribute('data-blok-database-option-group-pick', group.id);
      item.append(group.name);
      if (group.id === current) {
        const check = document.createElement('span');

        check.setAttribute('data-blok-database-select-option-check', '');
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = IconCheck;
        item.appendChild(check);
      }
      item.addEventListener('click', () => this.moveToGroup(flyout.optionId, group.id));
      list.appendChild(item);
    });
    const popover = new CellPopover({
      anchor: groupRow,
      content: list,
      panel: true,
      surfaceClass: GROUP_MENU_CLASS,
      minWidth: `${GROUP_MENU_WIDTH}px`,
      gap: 0,
      alignEnd: true,
      onEscape: () => this.closeGroupMenu(),
      onDismiss: () => this.closeGroupMenu(),
    });

    flyout.groupMenu = { popover, release, row: groupRow };
    groupRow.setAttribute('aria-expanded', 'true');
    popover.show();
    list.querySelector<HTMLElement>('[data-blok-database-option-group-pick]')?.focus();
  }

  private closeGroupMenu(): void {
    const flyout = this.flyout;
    const menu = flyout?.groupMenu ?? null;

    if (flyout === null || menu === null) return;
    flyout.groupMenu = null;
    menu.row.setAttribute('aria-expanded', 'false');
    menu.popover.close();
    menu.release();
  }

  /** The option goes to the top of its new group (notion-motion.md Round 57 §4). */
  private moveToGroup(optionId: string, groupId: string): void {
    this.closeGroupMenu();
    const property = this.withOptions(this.options);

    if (statusGroupOf(property, optionId)?.id !== groupId) {
      const peers = this.options.filter((o) => o.id !== optionId && statusGroupOf(property, o.id)?.id === groupId);
      const first = byPosition(peers).at(0);
      const position = DatabaseModel.positionBetween(null, first?.position ?? null);

      this.set(this.options.map((o) => (o.id === optionId ? { ...o, groupId, position } : o)));
      this.render();
    }
    this.renderFlyout();
  }
}

export const createOptionsEditor = (options: OptionsEditorOptions): HTMLElement => new OptionsEditor(options).root;
