import { nanoid } from 'nanoid';

import { IconCheck, IconChevronRight, IconMenu, IconPlus } from '../../../components/icons';
import type { I18n } from '../../../../types';
import { DatabaseModel } from '../database-model';
import { orderedStatusOptions, statusGroupOf, statusGroupsOf } from '../property-values';
import { sortedSelectOptions } from '../../../shared/database/value-helpers';
import type { PropertyDefinition, SelectOption } from '../types';
import { createOptionPill } from './display';
import { pickOptionColor, shownStatusOption } from './option-colors';
import { OptionDrag, buildDeletePrompt, buildOptionPanel, placeDroppedOption } from './option-editing';
import { CellPopover } from './cell-popover';

export interface OptionsEditorOptions {
  /** Shown labels: pass the localized property. */
  property: PropertyDefinition;
  i18n: Pick<I18n, 't'>;
  /** The whole new list after each add, rename, recolour, delete or move. */
  onChange: (options: SelectOption[]) => void;
  /** Status only: "Set as default" picked another option (research/30 §10f). */
  onSetDefault?: (optionId: string) => void;
  /** Keeps the menu around the list open under a status option's menu, until the release. */
  hold?: () => () => void;
  /** The menu around the list calls `close` when it closes, so a status option's menu goes with it. */
  onHostClose?: (close: () => void) => void;
}

/** notion-motion.md Round 56 §5: the status option menu is 220 wide, like the select editor's. */
const OPTION_MENU_CLASS = 'blok-database-option-menu';
const STATUS_OPTION_MENU_CLASS = 'blok-database-status-option-menu';
const GROUP_MENU_CLASS = 'blok-database-option-group-menu';
const OPTION_MENU_WIDTH = 220;

interface Flyout {
  popover: CellPopover;
  root: HTMLElement;
  optionId: string;
  release: () => void;
  groupMenu: { popover: CellPopover; release: () => void } | null;
  deletePrompt: boolean;
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
  private panelOptionId: string | null = null;
  /** The group whose add field is open; '' for a select. */
  private adding: string | null = null;
  private readonly drag: OptionDrag;
  private defaultId: string | undefined;
  private flyout: Flyout | null = null;

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
    opts.onHostClose?.(() => this.closeFlyout());
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
   * Escape steps back from a panel or the add field. Window capture runs
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
    this.panelOptionId = null;
    this.adding = null;
    this.render();
  };

  private syncEscape(): void {
    window.removeEventListener('keydown', this.handleKey, true);
    if (this.panelOptionId !== null || this.adding !== null) {
      window.addEventListener('keydown', this.handleKey, true);
    }
  }

  private render(): void {
    this.syncEscape();
    if (this.panelOptionId !== null) {
      this.renderPanel(this.panelOptionId);

      return;
    }
    const sections = this.isStatus
      ? statusGroupsOf(this.opts.property).map((group) => ({ id: group.id, label: group.name }))
      : [{ id: '', label: this.t('tools.database.editOptions') }];
    const rows: HTMLElement[] = [];

    for (const section of sections) {
      rows.push(this.heading(section.id, section.label));
      if (this.adding === section.id) {
        rows.push(this.addField(section.id));
      }
      this.options
        .filter((option) => !this.isStatus || statusGroupOf(this.withOptions(this.options), option.id)?.id === section.id)
        .forEach((option) => rows.push(this.row(option)));
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

  private addField(groupId: string): HTMLElement {
    const input = document.createElement('input');

    input.type = 'text';
    input.setAttribute('data-blok-database-options-add-input', '');
    input.setAttribute('data-blok-database-option-name', '');
    input.setAttribute('aria-label', this.t('tools.database.addOption'));
    input.placeholder = this.t('tools.database.addOption');
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
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.isStatus) {
        this.openFlyout(option.id, row);

        return;
      }
      this.panelOptionId = option.id;
      this.render();
    });
    // notion-motion.md Round 56 §5: a click on a status option row opens its menu.
    if (this.isStatus) row.addEventListener('click', () => this.openFlyout(option.id, row));
    row.append(handle, label, menu);

    return row;
  }

  private renderPanel(optionId: string): void {
    const option = this.options.find((o) => o.id === optionId);

    if (option === undefined) {
      this.panelOptionId = null;
      this.render();

      return;
    }
    const update = (changes: Partial<Pick<SelectOption, 'label' | 'color'>>): void =>
      this.set(this.options.map((o) => (o.id === optionId ? { ...o, ...changes } : o)));
    const { panel, name } = buildOptionPanel(option, {
      t: (key) => this.t(key),
      onRename: (label) => update({ label }),
      onRecolor: (color) => {
        update({ color });
        this.render();
      },
      status: this.isStatus,
      ...(this.isStatus && this.opts.onSetDefault !== undefined ? { onSetDefault: () => this.setDefault(optionId) } : {}),
      onDelete: () => {
        const { prompt, confirm } = buildDeletePrompt({
          t: (key) => this.t(key),
          onConfirm: () => {
            this.panelOptionId = null;
            this.set(this.options.filter((o) => o.id !== optionId));
            this.render();
          },
          onCancel: () => this.render(),
        });

        this.root.replaceChildren(prompt);
        confirm.focus();
      },
    });

    this.root.replaceChildren(panel);
    name.focus();
  }

  /** The current default keeps the row (shot 23); picking it again changes nothing. */
  private setDefault(optionId: string): void {
    if (optionId === this.defaultId) return;
    this.defaultId = optionId;
    this.opts.onSetDefault?.(optionId);
    this.panelOptionId = null;
    this.closeFlyout();
    this.render();
  }

  // ─── Status option menu (notion-motion.md Round 56 §5) ───

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
      surfaceClass: `${OPTION_MENU_CLASS} ${STATUS_OPTION_MENU_CLASS}`,
      minWidth: `${OPTION_MENU_WIDTH}px`,
      gap: 0,
      alignEnd: true,
      onEscape: () => (this.flyout?.deletePrompt === true ? this.renderFlyout() : this.closeFlyout()),
      onDismiss: () => this.closeFlyout(),
    });

    this.flyout = { popover, root, optionId, release, groupMenu: null, deletePrompt: false };
    popover.show();
    this.renderFlyout();
  }

  private closeFlyout(): void {
    const flyout = this.flyout;

    if (flyout === null) return;
    this.closeGroupMenu();
    this.flyout = null;
    flyout.popover.close();
    flyout.release();
  }

  private renderFlyout(): void {
    const flyout = this.flyout;

    if (flyout === null) return;
    flyout.deletePrompt = false;
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
      status: true,
      ...(this.opts.onSetDefault !== undefined ? { onSetDefault: () => this.setDefault(optionId) } : {}),
      group: {
        label: statusGroupOf(this.withOptions(this.options), optionId)?.name ?? '',
        onOpen: (groupRow) => this.openGroupMenu(groupRow),
      },
      onDelete: () => {
        const { prompt, confirm } = buildDeletePrompt({
          t: (key) => this.t(key),
          onConfirm: () => {
            this.closeFlyout();
            this.set(this.options.filter((o) => o.id !== optionId));
            this.render();
          },
          onCancel: () => this.renderFlyout(),
        });

        flyout.root.replaceChildren(prompt);
        flyout.deletePrompt = true;
        confirm.focus();
      },
    });

    flyout.root.replaceChildren(panel);
    name.focus();
  }

  /** Group ›: the status groups, the option's own checked. Its look and place are unmeasured. */
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
      aside: { side: 'right', gap: 0, flip: true },
      onEscape: () => this.closeGroupMenu(),
      onDismiss: () => this.closeGroupMenu(),
    });

    flyout.groupMenu = { popover, release };
    popover.show();
    list.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }

  private closeGroupMenu(): void {
    const flyout = this.flyout;
    const menu = flyout?.groupMenu ?? null;

    if (flyout === null || menu === null) return;
    flyout.groupMenu = null;
    menu.popover.close();
    menu.release();
  }

  /** The option goes to the end of its new group, as a new one would (where Notion puts it is unmeasured). */
  private moveToGroup(optionId: string, groupId: string): void {
    this.closeGroupMenu();
    const property = this.withOptions(this.options);

    if (statusGroupOf(property, optionId)?.id !== groupId) {
      const peers = this.options.filter((o) => o.id !== optionId && statusGroupOf(property, o.id)?.id === groupId);
      const last = byPosition(peers).at(-1);
      const position = DatabaseModel.positionBetween(last?.position ?? null, null);

      this.set(this.options.map((o) => (o.id === optionId ? { ...o, groupId, position } : o)));
      this.render();
    }
    this.renderFlyout();
  }
}

export const createOptionsEditor = (options: OptionsEditorOptions): HTMLElement => new OptionsEditor(options).root;
