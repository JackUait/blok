import { describeDatabaseRow } from '../../shared/tool-descriptions/database-row';
import { databaseRowSanitize } from '../../shared/tool-descriptions/sanitize/blocks';
import type { BlockTool, BlockToolConstructorOptions } from '../../../types/tools/block-tool';
import type { API, BlockAPI, SanitizerConfig } from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { LazySheet } from '../../components/utils/lazy-styles';
import { IconPage, IconPlus } from '../../components/icons';
import { isAnnotationBlock, mountChildBlocks, withSlotlessDescendants } from '../nested-blocks';
import type { ConvertedValue, DatabaseRowData, DateReminder, PropertyValue, TemplateRepeat } from '../database/types';
import { isReactionKey, reactionKey } from '../database/row-reactions';
import { overrideStatic } from '../../components/utils/override-static';

/** What the parent database answers when an empty page asks what to offer. */
interface RowPagePrompt {
  /** The layout's "Database templates" switch. */
  templates: boolean;
  list: Array<{ id: string; title: string }>;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(['properties', 'position', 'title', 'pageId', 'bodyBlocks', 'icon', 'cover', 'fullWidth', 'template', 'repeat', 'reminders', 'anonymous']);

/**
 * Top-level keys this version does not know, kept as they came. A full save
 * prunes every key it leaves out from the shared document, so dropping a
 * newer version's key here would delete it for every client.
 */
const unknownKeys = (data: DatabaseRowData): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !KNOWN_KEYS.has(key) && !isReactionKey(key)));

const toRowData = (data: DatabaseRowData): DatabaseRowData => {
  const row: DatabaseRowData = {
    properties: { ...data.properties },
    position: data.position ?? 'a0',
  };

  // Only carry `title` when the stored row already has one. A row written
  // before this key existed must NOT gain it on load: inventing it here is a
  // whole-key write of a value nobody typed, and it would race a peer.
  if (typeof data.title === 'string') {
    row.title = data.title;
  }
  if (typeof data.pageId === 'string' && data.pageId.length > 0) {
    row.pageId = data.pageId;
  }
  if (data.bodyBlocks === true) {
    row.bodyBlocks = true;
  }
  if (typeof data.icon === 'string' && data.icon !== '') {
    row.icon = data.icon;
  }
  if (typeof data.cover === 'string' && data.cover !== '') {
    row.cover = data.cover;
  }
  if (typeof data.fullWidth === 'boolean') {
    row.fullWidth = data.fullWidth;
  }
  if (data.template === true) {
    row.template = true;
  }
  if (data.anonymous === true) {
    row.anonymous = true;
  }
  if (typeof data.repeat === 'object' && data.repeat !== null) {
    row.repeat = structuredClone(data.repeat);
  }
  if (typeof data.reminders === 'object' && data.reminders !== null && Object.keys(data.reminders).length > 0) {
    row.reminders = structuredClone(data.reminders);
  }
  Object.entries(data).forEach(([key, value]) => {
    if (isReactionKey(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(row, { [key]: structuredClone(value) });
    }
  });

  return row;
};

/**
 * DatabaseRowTool — lightweight block that stores a single database row.
 *
 * Not user-insertable (no toolbox entry). The parent DatabaseTool creates
 * and manages row blocks; this tool's job is to hold properties and position
 * as block data so rows participate in the block tree.
 *
 * Custom methods (updateProperties, updatePosition, getProperties, getPosition)
 * are accessed by the parent DatabaseTool via block.call('methodName', params),
 * which invokes tool instance methods by name through the Block adapter.
 */
export class DatabaseRowTool implements BlockTool {
  public static get describe(): typeof describeDatabaseRow {
    return describeDatabaseRow;
  }

  public static set describe(value: typeof describeDatabaseRow) {
    overrideStatic(this, 'describe', value);
  }

  /** Core loads these before the first render. Subclasses inherit it. */
  public static get 'blok.toolSheets'(): LazySheet[] {
    return ['database'];
  }

  private _data: DatabaseRowData;
  private unknown: Record<string, unknown>;
  private readonly api: API | undefined;
  private readonly block: BlockAPI | undefined;
  private readOnly: boolean;
  private bodySlot: HTMLElement | null = null;
  private placeholder: HTMLElement | null = null;
  /** The picker rows, in key order; empty when no picker is drawn. */
  private picks: HTMLButtonElement[] = [];
  private pickActions: Array<() => void> = [];
  private activePick = -1;

  constructor({ data, api, block, readOnly }: BlockToolConstructorOptions<DatabaseRowData>) {
    this._data = toRowData(data);
    this.unknown = unknownKeys(data);
    this.api = api;
    this.block = block;
    this.readOnly = readOnly;
  }

  /** A row deleted on its own tells its database; a deleted database sends its rows itself. */
  public removed(removal?: { deleted: boolean }): void {
    const parentId = this.block?.parentId;

    if (removal?.deleted !== true || parentId === null || parentId === undefined || this.block === undefined) return;
    this.api?.blocks.getById(parentId)?.call('rowDeleted', { rowId: this.block.id });
  }

  public render(): HTMLDivElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-tool', 'database-row');

    const bodySlot = document.createElement('div');

    bodySlot.setAttribute(DATA_ATTR.nestedBlocks, '');
    bodySlot.setAttribute('data-blok-database-row-body', '');
    // The slot holds only the page body; a write on a body holder is not a row edit.
    bodySlot.setAttribute(DATA_ATTR.mutationFree, 'true');
    const placeholder = document.createElement('div');

    placeholder.setAttribute('data-blok-database-row-empty', '');
    // A block dragged over the empty page drops in as its first child.
    placeholder.setAttribute(DATA_ATTR.dropInto, '');
    placeholder.setAttribute(DATA_ATTR.childStandIn, '');
    placeholder.setAttribute(DATA_ATTR.chrome, '');
    placeholder.setAttribute(DATA_ATTR.mutationFree, 'true');
    placeholder.setAttribute('contenteditable', 'false');
    // database.css hides it once the body slot has a block.
    placeholder.addEventListener('click', () => this.startBody());

    el.append(bodySlot, placeholder);
    this.bodySlot = bodySlot;
    this.placeholder = placeholder;
    this.drawPrompt();
    this.updatePlaceholder();

    return el;
  }

  /** The database calls this when its templates or its "Database templates" switch change. */
  public refreshPlaceholder(): void {
    this.drawPrompt();
  }

  /**
   * The empty-page prompt (research/10 §6). The parent database says whether
   * templates are on and which exist; until it is built, the plain line shows.
   */
  private drawPrompt(): void {
    const placeholder = this.placeholder;

    if (placeholder === null) return;
    const t = (key: string): string => this.api?.i18n.t(key) ?? '';
    const prompt = this.readPrompt();

    this.picks = [];
    this.pickActions = [];
    this.activePick = -1;
    placeholder.replaceChildren();
    if (prompt !== undefined && !prompt.templates) return;
    // No picker on a template's own page (plan Q8).
    if (prompt === undefined || this._data.template === true) {
      placeholder.textContent = t('tools.database.rowBodyEmpty');

      return;
    }
    if (prompt.list.length === 0) {
      const create = document.createElement('button');

      create.type = 'button';
      create.setAttribute('data-blok-database-row-create-template', '');
      create.textContent = t('tools.database.rowBodyCreateTemplate');
      create.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callParent('addTemplate');
      });
      placeholder.append(t('tools.database.rowBodyEmptyOr'), ' ', create);

      return;
    }
    const text = document.createElement('div');

    text.setAttribute('data-blok-database-row-empty-text', '');
    text.textContent = t('tools.database.rowBodyPickTemplate');
    const picker = document.createElement('div');

    picker.setAttribute('data-blok-database-row-picker', '');
    picker.setAttribute(DATA_ATTR.keyboardOwner, '');
    picker.addEventListener('keydown', (event) => this.onPickerKey(event));
    const rowId = this.block?.id ?? '';
    const entries: Array<[string, string, string, () => void]> = [
      ...prompt.list.map(({ id, title }): [string, string, string, () => void] =>
        [id, IconPage, title === '' ? t('tools.database.templateUntitled') : title, () => this.callParent('applyTemplate', { rowId, templateId: id })]),
      ['empty', IconPage, t('tools.database.cellEmpty'), () => this.startBody()],
      ['new', IconPlus, t('tools.database.templateNew'), () => this.callParent('addTemplate')],
    ];

    for (const [id, icon, label, action] of entries) {
      const pick = document.createElement('button');
      const glyph = document.createElement('span');
      const name = document.createElement('span');

      pick.type = 'button';
      pick.setAttribute('data-blok-database-row-pick', id);
      glyph.setAttribute('data-blok-database-row-pick-icon', '');
      glyph.innerHTML = icon;
      name.setAttribute('data-blok-database-row-pick-label', '');
      name.textContent = label;
      pick.append(glyph, name);
      pick.addEventListener('click', (event) => {
        event.stopPropagation();
        action();
      });
      picker.appendChild(pick);
      this.picks.push(pick);
      this.pickActions.push(action);
    }
    placeholder.append(text, picker);
  }

  private readPrompt(): RowPagePrompt | undefined {
    const received: RowPagePrompt[] = [];

    this.callParent('rowPagePrompt', { receive: (prompt: RowPagePrompt) => received.push(prompt) });

    return received[0];
  }

  private callParent(method: string, param?: unknown): void {
    const parentId = this.block?.parentId;

    if (parentId === null || parentId === undefined) return;
    this.api?.blocks.getById(parentId)?.call(method, param as never);
  }

  /**
   * ↑/↓ from the page title, as Blok's menus do: from no highlight ↓ goes to
   * the first row and ↑ to the last, and both wrap. `receive(false)` when no
   * picker is drawn, so the title keeps its own arrows.
   */
  public movePick(param: { step: 1 | -1; receive: (handled: boolean) => void }): void {
    const count = this.picks.length;

    // CSS hides the picker once the body has a block.
    if (count === 0 || this.readOnly || this.hasBody()) {
      param.receive(false);

      return;
    }
    const wrapsBack = this.activePick === -1 && param.step === -1;

    this.highlight(wrapsBack ? count - 1 : (this.activePick + param.step + count) % count);
    param.receive(true);
  }

  /** Enter on the page title: the highlighted pick, otherwise an empty page. */
  public enter(): void {
    const action = this.pickActions[this.activePick];

    if (action !== undefined && !this.readOnly && !this.hasBody()) {
      this.highlight(-1);
      action();

      return;
    }
    this.startBody();
  }

  private hasBody(): boolean {
    const id = this.block?.id;

    return id !== undefined && (this.api?.blocks.getChildren(id).some((child) => !isAnnotationBlock(child)) ?? false);
  }

  private highlight(index: number): void {
    this.picks.forEach((pick, i) => pick.toggleAttribute('data-active', i === index));
    this.activePick = index;
  }

  /** A pick that holds focus (after Tab) moves through the picker with the same keys. */
  private onPickerKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const at = this.picks.findIndex((pick) => pick === event.target);

    if (at === -1) return;
    event.preventDefault();
    this.activePick = at;
    this.movePick({ step: event.key === 'ArrowDown' ? 1 : -1, receive: () => undefined });
    this.picks[this.activePick]?.focus();
  }

  /**
   * Find-in-page calls this on a hidden ancestor of a match: the closed row
   * asks its database to open its page, which shows the body.
   */
  public expand(): void {
    const parentId = this.block?.parentId;
    const id = this.block?.id;

    if (parentId === null || parentId === undefined || id === undefined) {
      return;
    }
    this.api?.blocks.getById(parentId)?.call('openRow', { rowId: id });
  }

  /** Adds the first paragraph of an empty page body and puts the caret in it. */
  public startBody(): void {
    const api = this.api;
    const id = this.block?.id;

    if (this.readOnly || api === undefined || id === undefined) {
      return;
    }
    const first = api.blocks.getChildren(id).find((child) => !isAnnotationBlock(child));

    if (first !== undefined) {
      api.caret.setToBlock(first.id, 'start');

      return;
    }
    const paragraph = api.blocks.insertAt(undefined, undefined, { parentId: id, position: 'end' });

    this.bodySlot?.appendChild(paragraph.holder);
    api.caret.setToBlock(paragraph.id, 'start');
  }

  private updatePlaceholder(): void {
    this.placeholder?.classList.toggle('hidden', this.readOnly);
  }

  public rendered(): void {
    this.drawPrompt();
    this.mountBody();
  }

  /** Puts the row's child blocks in the body slot. Core does not place a new child there. */
  public mountBody(): void {
    const api = this.api;
    const id = this.block?.id;

    if (this.bodySlot === null || api === undefined || id === undefined) {
      return;
    }

    mountChildBlocks(this.bodySlot, withSlotlessDescendants(api.blocks.getChildren(id), (childId) => api.blocks.getChildren(childId)));
  }

  public save(_block: HTMLElement): DatabaseRowData {
    return this.snapshot();
  }

  private snapshot(): DatabaseRowData {
    const saved: DatabaseRowData = {
      ...structuredClone(this.unknown),
      properties: { ...this._data.properties },
      position: this._data.position,
    };

    if (this._data.title !== undefined) {
      saved.title = this._data.title;
    }
    if (this._data.pageId !== undefined) {
      saved.pageId = this._data.pageId;
    }
    if (this._data.bodyBlocks === true) {
      saved.bodyBlocks = true;
    }
    if (this._data.icon !== undefined) {
      saved.icon = this._data.icon;
    }
    if (this._data.cover !== undefined) {
      saved.cover = this._data.cover;
    }
    if (this._data.fullWidth !== undefined) {
      saved.fullWidth = this._data.fullWidth;
    }
    if (this._data.template === true) {
      saved.template = true;
    }
    if (this._data.anonymous === true) {
      saved.anonymous = true;
    }
    if (this._data.repeat !== undefined) {
      saved.repeat = structuredClone(this._data.repeat);
    }
    if (this._data.reminders !== undefined) {
      saved.reminders = structuredClone(this._data.reminders);
    }
    Object.entries(this._data).filter(([key]) => isReactionKey(key)).forEach(([key, value]) => {
      Object.assign(saved, { [key]: structuredClone(value) });
    });

    return saved;
  }

  /**
   * Take undo/redo or a peer's data in place. The row has no DOM to rebuild,
   * so recreating the block for it would only churn the parent's board.
   */
  public setData(data: DatabaseRowData): boolean {
    this._data = toRowData(data);
    this.unknown = unknownKeys(data);

    return true;
  }

  public validate(data: DatabaseRowData): boolean {
    return data.properties !== null && data.properties !== undefined && typeof data.properties === 'object'
      && (data.pageId === undefined || (typeof data.pageId === 'string' && data.pageId.length > 0));
  }

  public updateProperties(changes: Record<string, PropertyValue>): void {
    Object.assign(this._data.properties, changes);
  }

  /** All values at once: the row moved to a database with another schema. */
  public replaceProperties(param: { properties: Record<string, PropertyValue> }): void {
    this._data.properties = { ...param.properties };
  }

  /**
   * Write the row title to BOTH places it lives.
   *
   * `title` is top-level, so the CRDT stores it as a Y.Text and two people
   * typing at once merge per character. `properties[titlePropertyId]` is the
   * published copy consumers and the backend adapter read, so it keeps being
   * written — it is a mirror of the merged value, not a second source.
   *
   * The row cannot work the property id out on its own: it lives in the PARENT
   * database block's schema, so the parent passes it in.
   */
  public updateTitle(param: { title: string; titlePropertyId: string }): void {
    this._data.title = param.title;

    if (param.titlePropertyId !== '') {
      this._data.properties[param.titlePropertyId] = param.title;
    }
  }

  /**
   * Keep or clear the originals a type change could not carry over. `null`
   * clears one. Stored as a top-level `convertedValues` map keyed by property
   * id, so two peers' entries merge key by key.
   */
  public updateConvertedValues(changes: Record<string, ConvertedValue | null>): void {
    const before = (this.unknown.convertedValues ?? {}) as Record<string, ConvertedValue>;
    const added = Object.entries(changes)
      .filter((entry): entry is [string, ConvertedValue] => entry[1] !== null)
      .map(([id, value]): [string, ConvertedValue] => [id, structuredClone(value)]);
    const kept: Record<string, ConvertedValue> = Object.fromEntries([
      ...Object.entries(before).filter(([propertyId]) => !(propertyId in changes)),
      ...added,
    ]);
    const { convertedValues: _old, ...rest } = this.unknown;

    this.unknown = Object.keys(kept).length === 0 ? rest : { ...rest, convertedValues: kept };
  }

  public getTitle(): string | undefined {
    return this._data.title;
  }

  public updatePageId(param: { pageId: string }): void {
    if (param.pageId.length > 0) {
      this._data.pageId = param.pageId;
    }
  }

  /** Sets the page icon (an emoji); null removes it. */
  public updateIcon(param: { icon: string | null }): void {
    if (param.icon === null || param.icon === '') {
      delete this._data.icon;
    } else {
      this._data.icon = param.icon;
    }
  }

  /** Sets the page cover (an image URL); null removes it. */
  public updateCover(param: { cover: string | null }): void {
    if (param.cover === null || param.cover === '') {
      delete this._data.cover;
    } else {
      this._data.cover = param.cover;
    }
  }

  /** The page's own Full width; null hands the width back to the layout. */
  public updateFullWidth(param: { fullWidth: boolean | null }): void {
    if (param.fullWidth === null) {
      delete this._data.fullWidth;
    } else {
      this._data.fullWidth = param.fullWidth;
    }
  }

  /** A template's repeat schedule; null stops it. */
  public updateRepeat(param: { repeat: TemplateRepeat | null }): void {
    if (param.repeat === null) {
      delete this._data.repeat;
    } else {
      this._data.repeat = structuredClone(param.repeat);
    }
  }

  /** Sets date reminders by property id; null removes one. */
  public updateReminders(changes: Record<string, DateReminder | null>): void {
    const next: Record<string, DateReminder> = Object.fromEntries(
      Object.entries({ ...this._data.reminders, ...changes })
        .filter((entry): entry is [string, DateReminder] => entry[1] !== null)
        .map(([propertyId, reminder]) => [propertyId, structuredClone(reminder)])
    );
    if (Object.keys(next).length === 0) {
      delete this._data.reminders;
    } else {
      this._data.reminders = next;
    }
  }

  /** Adds one person's reaction; `at: null` removes it. Writes only that person's key; their last removal drops it. */
  public updateReaction(param: { userId: string; emoji: string; at: number | null }): void {
    const key = reactionKey(param.userId);
    const current: unknown = (this._data as Record<string, unknown>)[key];
    const own = Object.entries(typeof current === 'object' && current !== null ? current : {}).filter(([emoji]) => emoji !== param.emoji);
    const mine = param.at === null ? own : [...own, [param.emoji, param.at] as const];
    const { [key]: _old, ...rest } = this._data as Record<string, unknown>;

    this._data = (mine.length === 0 ? rest : { ...rest, [key]: Object.fromEntries(mine) }) as DatabaseRowData;
  }

  /** The legacy body was turned into child blocks; it must never be turned again. */
  public markBodyBlocks(): void {
    this._data.bodyBlocks = true;
  }

  public updatePosition(param: { position: string }): void {
    this._data.position = param.position;
  }

  public getProperties(): Record<string, PropertyValue> {
    return this._data.properties;
  }

  public getPosition(): string {
    return this._data.position;
  }

  /**
   * Hand a copy of the row's current data to `param.receive`.
   *
   * The parent reads rows through `block.call`, which drops return values, so
   * the copy goes to the callback it passes. The block's `preservedData` is
   * no substitute: it is the last SAVED data and lags every write.
   */
  public readData(param: { receive: (data: DatabaseRowData) => void }): void {
    param.receive(this.snapshot());
  }

  /**
   * Plain text and bare URLs: an HTML parse would cut text at `<` and turn `&` into `&amp;`.
   */
  public static get sanitize(): SanitizerConfig {
    return databaseRowSanitize();
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /** The row is where its page body sits: no toolbar or selection of its own, body not indented. */
  public static get isLayout(): boolean {
    return true;
  }

  /** Deleting a row deletes its page body. Promoting it would drop body blocks into the database. */
  public static get deletesChildren(): boolean {
    return true;
  }

  /** Enter on the last empty line of a page body adds a line there, never leaves the page. */
  public static get keepsChildrenOnEnter(): boolean {
    return true;
  }

  public static get childTools(): { deny: string[] } {
    return { deny: ['database-row'] };
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;
    this.updatePlaceholder();
  }
}

export type { DatabaseRowData };
