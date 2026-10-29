import type { I18n } from '../../../../types';
import type { DateDisplayChange } from './date-format';
import type { FormulaProblem } from '../computed-properties';
import type { DatabaseHelpLinks, DatabaseMap, DatabasePerson, DateReminderOffset, PropertyDefinition, PropertyValue, SelectOption } from '../types';

/** The relation picker's way to open a page over itself (notion-spec-2 §19.2). */
export interface RelatedPeek {
  mode: 'center';
  onClose: () => void;
}

/**
 * What every cell renderer and editor needs from its host: the table, a board
 * card, a list row or the row drawer.
 */
export interface CellContext {
  i18n: Pick<I18n, 't'>;
  /** A read-only cell renders, but `openCellEditor` does nothing (checkbox included). */
  readOnly: boolean;
  /**
   * Options of a select or multi-select property. Pass the saved list, not a
   * localized copy: the editor writes this list back through `onOptionsChange`.
   * Falls back to `property.config.options`.
   */
  options?: SelectOption[];
  /**
   * Receives the whole new option list after a create, rename, recolor, delete
   * or reorder. Each option keeps a unique `id`; `position` is a fractional key.
   * Without it, the select editor cannot create or edit options.
   */
  onOptionsChange?: (options: SelectOption[]) => void;
  /** BCP 47 tag for date text and the calendar. Defaults to `navigator.language`. */
  locale?: string;
  /** First day of the week, 0 = Sunday … 6 = Saturday. Defaults to the locale's. */
  weekStart?: number;
  /** 12- or 24-hour time. Defaults to the locale's. A property's own time format wins. */
  hourCycle?: 'h12' | 'h23';
  /**
   * Text that replaces the value when the editor opens: a key typed on a
   * selected table cell. Text editors take it as the value, select editors as
   * the search. The date editor ignores it.
   */
  initialText?: string;
  /** The host's people, for names and avatars. Without it a person shows a placeholder and cannot be edited. */
  people?: DatabasePerson[];
  /** The current user's id, listed first in the person editor. */
  me?: string;
  /** A form question's selection cap, independent of the property schema. */
  maxSelections?: number;
  /** Stores a picked file and gives its URL. Without it the files editor offers links only. */
  uploadFile?: (file: File) => Promise<{ url: string; name?: string }>;
  /** Anchors the relative date format. Defaults to the current time. */
  now?: Date;
  /**
   * Formula and rollup: the property their value shows as (its result type).
   * Without it they show as text.
   */
  valueProperty?: (property: PropertyDefinition) => PropertyDefinition;
  /** The row the cell belongs to. `formulaProblem` needs it. */
  rowId?: string;
  /** Why a formula cell has no value. The cell then shows a warning mark with the reason on hover. */
  formulaProblem?: (property: PropertyDefinition, rowId: string) => FormulaProblem | undefined;
  /** A related row's title, '' when untitled, undefined when unknown. */
  relationTitle?: (property: PropertyDefinition, rowId: string) => string | undefined;
  /** A related row's own page icon (an emoji), undefined when it has none. */
  relationIcon?: (property: PropertyDefinition, rowId: string) => string | undefined;
  /**
   * Opens a related row. Without it a relation chip is plain text. With `peek`
   * it opens in that mode and returns true when `peek.onClose` will run as the
   * page closes.
   */
  openRelated?: (property: PropertyDefinition, rowId: string, peek?: RelatedPeek) => boolean | void;
  /** Rows a relation cell can pick, for the relation editor. */
  relationCandidates?: (property: PropertyDefinition) => Array<{ id: string; title: string }>;
  /**
   * notion-spec-2 §21.2: makes a page titled as typed in the related database
   * and returns its id, or null when refused. Undefined when it cannot.
   */
  relationCreator?: (property: PropertyDefinition) => ((title: string) => string | null) | undefined;
  /**
   * A form's page picker (research/19 §3b): the related database's name. The
   * relation editor then reads "Select a page" under "Search…" and "In <name>".
   */
  relationScope?: (property: PropertyDefinition) => string;
  /**
   * The table and the row page (research/16 §4, research/22 §3): a plain click
   * on a url, email or phone link follows it. Elsewhere a plain click is left
   * to the host, which edits the value.
   */
  followLinks?: boolean;
  /**
   * An editor opens over its cell, not below it. `true` is the table cell
   * (research/22 §4); 'value' is the row page's value (notion-spec §7):
   * level with its top, its right edge on the value's.
   */
  coverCell?: boolean | 'value';
  /**
   * The table grid: Tab saves and closes a text-like editor, so focus stays in
   * the grid. Elsewhere Tab moves to the next field.
   */
  tabCloses?: boolean;
  /** The table (research/16 §4): a url shows without its http(s) scheme. */
  shortUrls?: boolean;
  /** Date: the cell's stored reminder. The cell shows an alarm and the date in the accent. */
  reminder?: DateReminderOffset;
  /** Created by: the row is an anonymous form answer, shown as "Anonymous". */
  anonymous?: boolean;
  /** The host's small map (`config.map.renderPlace`) for a place's hover card. Without it the card has no map. */
  renderPlace?: DatabaseMap['renderPlace'];
  /** The host's place search (`config.map.geocode`). Without it the Place editor is a plain address field. */
  geocode?: DatabaseMap['geocode'];
  /** The host's "Current Location" (`config.map.currentLocation`). Without it the row is hidden. */
  currentLocation?: DatabaseMap['currentLocation'];
  /** The host's help URLs (`config.helpLinks`). The date picker links to `reminders`. */
  helpLinks?: DatabaseHelpLinks;
  /** Every editor `openCellEditor` opens joins this set while open, so the host can close them all at once. */
  openEditors?: Set<CellEditorHandle>;
}

/**
 * Editor callbacks. They go in with the call, not onto the handle, because a
 * checkbox commits before `openCellEditor` returns.
 */
export interface CellEditorCallbacks {
  /**
   * The new value. Text, url, number and single select commit once and close.
   * Multi-select and date commit live, so this can fire several times while the
   * editor is open; each call carries the whole new value, not a delta.
   */
  onCommit: (value: PropertyValue) => void;
  /** Text: the field's text on every key, before any commit. A bulk edit previews it in every row. */
  onDraft?: (text: string) => void;
  /** The editor closed with nothing committed (Escape where it cancels, no change, or an invalid number). */
  onCancel?: () => void;
  /** The editor closed, after any commit or cancel. Hosts restore focus here. */
  onClose?: () => void;
  /** The status editor's "Edit property" footer: open the property menu. Without it there is no footer. */
  onEditProperty?: () => void;
  /**
   * Date: the Remind row's new choice, null for None. Without it the picker has
   * no Remind row. Not called on Clear: the host drops the reminder with the value.
   * `picked`: the user chose it in the Remind menu; false when it is the
   * property default (or a choice dropped because it no longer fits the time).
   */
  onReminderChange?: (reminder: DateReminderOffset | null, picked: boolean) => void;
  /**
   * Date: a Date format, Time format or Time zone pick. It changes the
   * property, not the cell. Without it the picker has no format rows: pass it
   * only where the user may edit the property.
   */
  onDateDisplayChange?: (change: DateDisplayChange) => void;
  /**
   * Date: a bulk edit (research/21 §6). The value is the first selected row's;
   * the Remind row still opens on the property default, and the first change
   * writes even when it equals that value.
   */
  bulk?: boolean;
}

export type CellEditorContext = CellContext & CellEditorCallbacks;

export interface CellEditorHandle {
  /** False once the editor closed, and from the start for checkbox and read-only. */
  readonly isOpen: boolean;
  /** Closes the editor as an outside click does: a pending text draft commits. */
  close(): void;
  /** Closes the editor and drops a pending text draft. Live commits already made stay. */
  cancel(): void;
}

export type CellRenderer = (property: PropertyDefinition, value: PropertyValue | undefined, ctx: CellContext) => HTMLElement;
