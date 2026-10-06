import { composeBaseSanitizeConfig } from '../../shared/sanitize-schema';
import { isEmpty, isObject } from '../utils';
import { log } from '../utils/logger';
import { safeHref } from '../utils/sanitize-url';

import { BaseToolAdapter,  InternalBlockToolSettings, UserSettings  } from './base';
import type { ConstructorOptions } from './base';
import { ToolsCollection } from './collection';
import type { RichTextFormat } from '../../../types/rich-text';
import type { ChildToolRestrictions } from '../../../types/tools';
import type { InlineToolAdapter } from './inline';
import type { BlockTuneAdapter } from './tune';

import type {
  AssetKind,
  BlockAPI,
  BlockOrigin,
  BlockTool as IBlockTool,
  BlockToolData,
  BlockToolConstructable,
  ConversionConfig,
  PasteConfig, SanitizerConfig, ToolboxConfig,
  ToolboxConfigEntry
} from '@/types';
import type { BlockToolAdapter as BlockToolAdapterInterface } from '@/types/tools/adapters/block-tool-adapter';
import { ToolType } from '@/types/tools/adapters/tool-type';

/** A tool's link reaches an href on copy, paste and the copy-link tune. */
const isLink = (value: unknown): value is { url: string; text: string } =>
  isObject(value) &&
  typeof value.url === 'string' &&
  value.url !== '' &&
  safeHref(value.url) !== null &&
  typeof value.text === 'string';

/**
 * Class to work with Block tools constructables
 */
export class BlockToolAdapter extends BaseToolAdapter<ToolType.Block, IBlockTool> implements BlockToolAdapterInterface {
  /**
   * Tool type — Block
   */
  public type: ToolType.Block = ToolType.Block;

  /**
   * InlineTool collection for current Block Tool
   */
  public inlineTools: ToolsCollection<InlineToolAdapter> = new ToolsCollection<InlineToolAdapter>();

  /**
   * BlockTune collection for current Block Tool
   */
  public tunes: ToolsCollection<BlockTuneAdapter> = new ToolsCollection<BlockTuneAdapter>();

  /**
   * Cache for sanitize configuration
   */
  private _sanitizeConfig: SanitizerConfig | undefined;

  /**
   * Cache for base sanitize configuration
   */
  private _baseSanitizeConfig: SanitizerConfig | undefined;

  private readonly richTextFormatOption: RichTextFormat | undefined;

  constructor(options: ConstructorOptions & { richTextFormat?: RichTextFormat }) {
    super(options);
    this.richTextFormatOption = options.richTextFormat;
  }

  /**
   * Creates new Tool instance
   * @param data - Tool data
   * @param block - BlockAPI for current Block
   * @param readOnly - True if Blok is in read-only mode
   * @param origin - why this instance is being constructed (creation vs restore).
   *   Defaults to `'api'` so a construction path that has not been updated can
   *   never be mistaken for a user gesture.
   * @param replaySource - with a replay origin: this client's undo/redo or a peer's change
   */
  public create(
    data: BlockToolData,
    block: BlockAPI,
    readOnly: boolean,
    origin: BlockOrigin = 'api',
    replaySource?: 'history' | 'remote'
  ): IBlockTool {
    return new this.constructable({
      data,
      block,
      readOnly,
      origin,
      ...(replaySource !== undefined ? { replaySource } : {}),
      api: this.api,
      config: this.settings,
    }) as IBlockTool;
  }

  /**
   * Returns true if read-only mode is supported by Tool
   */
  public get isReadOnlySupported(): boolean {
    return (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.IsReadOnlySupported] === true;
  }

  /**
   * Returns true if the Tool's prototype has a setReadOnly method,
   * enabling the in-place read-only toggle path (no save/clear/render cycle).
   */
  public get supportsInPlaceReadOnly(): boolean {
    const prototype = (this.constructable as unknown as { prototype?: { setReadOnly?: unknown } })?.prototype;

    return typeof prototype?.setReadOnly === 'function';
  }

  /**
   * Returns true if the Tool's prototype has a setData method, enabling the
   * in-place data update path (no recompose of the Block).
   *
   * Probes the PROTOTYPE, not a live Block: every Block exposes `setData`, but
   * `DataPersistenceManager` falls back to writing innerHTML for tools that do
   * not implement it — a fallback that must never stand in for a real update.
   */
  public get supportsInPlaceSetData(): boolean {
    const prototype = (this.constructable as unknown as { prototype?: { setData?: unknown } })?.prototype;

    return typeof prototype?.setData === 'function';
  }

  /**
   * Returns true when the Tool exclusively manages its own child blocks, so the
   * user may never nest an arbitrary block into it.
   *
   * A table's contentIds ARE its cell blocks; a column_list's ARE its columns.
   * Adopting an outside block into one of those makes it a rogue child the tool
   * then renders wherever its own children go (a table drops it into the first
   * cell). Blocks whose children are plain user content — toggle, callout, a
   * paragraph with nested blocks — are NOT tool-owned and stay nestable.
   */
  public get ownsChildren(): boolean {
    return (this.constructable as unknown as Record<string, boolean | undefined>)[InternalBlockToolSettings.OwnsChildren] === true;
  }

  /**
   * Which block tools may be DIRECT children of this Tool's block, or undefined
   * when it accepts any child.
   *
   * `ownsChildren` is all-or-nothing and clamps MOVES only; this is the
   * selective, insert-aware counterpart, and the generic form of the Table
   * tool's `restrictedTools` (whose enforcement is hard-wired to table cells).
   * A container that declares it no longer has to defend itself downstream by
   * filtering `child.name` in render and styling around a foreign child.
   */
  public get childTools(): ChildToolRestrictions | undefined {
    return (this.constructable as unknown as Record<string, ChildToolRestrictions | undefined>)[
      InternalBlockToolSettings.ChildTools
    ];
  }

  /**
   * False when the Tool's block never has children. `childTools` cannot say
   * this: an empty `allow` reads as "no restriction".
   */
  public get acceptsChildren(): boolean {
    return (this.constructable as unknown as Record<string, boolean | undefined>)[InternalBlockToolSettings.AcceptsChildren] !== false;
  }

  /**
   * How the block menu is laid out: `titled` heads it with the tool's name
   * and puts Turn into first; `trash` reads Delete as "Move to Trash".
   */
  public get blockMenu(): { titled: boolean; trash: boolean } {
    const menu: unknown = (this.constructable as unknown as Record<string, unknown>)[InternalBlockToolSettings.BlockMenu];
    const read = (key: 'titled' | 'trash'): boolean =>
      typeof menu === 'object' && menu !== null && (menu as Record<string, unknown>)[key] === true;

    return { titled: read('titled'), trash: read('trash') };
  }

  /**
   * The data Duplicate and Alt-drag insert instead of a copy or a link.
   * Undefined means no hook, a throwing hook or a null answer.
   * @param data - the block's saved data
   */
  public duplicateData(data: BlockToolData): BlockToolData | undefined {
    const duplicateData = (this.constructable as unknown as Record<string, unknown>)[InternalBlockToolSettings.DuplicateData];

    if (typeof duplicateData !== 'function') {
      return undefined;
    }

    try {
      const copy: unknown = duplicateData.call(this.constructable, data, this.settings);

      return typeof copy === 'object' && copy !== null && !Array.isArray(copy) ? copy as BlockToolData : undefined;
    } catch (error) {
      log(`Tool «${this.name}» duplicateData() threw; copying the block as usual.`, 'warn', error);

      return undefined;
    }
  }

  /**
   * The data a toolbox insert waits for. Undefined means no hook; a rejection
   * means insert nothing.
   */
  public prepareInsert(): Promise<BlockToolData> | undefined {
    const prepareInsert = (this.constructable as unknown as Record<string, unknown>)[InternalBlockToolSettings.PrepareInsert];

    if (typeof prepareInsert !== 'function') {
      return undefined;
    }

    return new Promise<unknown>((resolve) => resolve(prepareInsert.call(this.constructable, this.settings)))
      .then((data) => {
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          throw new Error(`Tool «${this.name}» prepareInsert() did not return block data`);
        }

        return data as BlockToolData;
      });
  }

  /**
   * True when a copy of the Tool's block rebuilds its children from its own
   * data, so Duplicate and Alt-drag leave them out.
   */
  public get copiesOwnChildren(): boolean {
    return (this.constructable as unknown as Record<string, boolean | undefined>)[InternalBlockToolSettings.CopiesOwnChildren] === true;
  }

  /** True when the Tool declares `copyAsLink`, without calling it. */
  public get hasCopyAsLink(): boolean {
    return typeof (this.constructable as unknown as Record<string, unknown>)[InternalBlockToolSettings.CopyAsLink] === 'function';
  }

  /**
   * The link a copy carries. Undefined means no hook or a throwing hook;
   * null means the hook returned no valid link.
   * @param data - the block's saved data
   */
  public copyAsLink(data: BlockToolData): { url: string; text: string } | null | undefined {
    const copyAsLink = (this.constructable as unknown as Record<string, unknown>)[InternalBlockToolSettings.CopyAsLink];

    if (typeof copyAsLink !== 'function') {
      return undefined;
    }

    try {
      const link: unknown = copyAsLink.call(this.constructable, data, this.settings);

      return isLink(link) ? link : null;
    } catch (error) {
      log(`Tool «${this.name}» copyAsLink() threw; copying the block without a link.`, 'warn', error);

      return undefined;
    }
  }

  /**
   * Returns true when Enter on this container's empty LAST child must create
   * the new line INSIDE the container rather than escaping it.
   *
   * The escape is Blok's default (Notion's callout behaviour), so a layout
   * container that owns its trailing line — a column, a column_list, a toggle,
   * a host's card — opts out by declaring the flag. It is per-tool policy, not
   * something core can read off the DOM: a callout renders the same
   * `data-blok-nested-blocks` slot as a column and deliberately keeps the
   * escape.
   */
  public get keepsChildrenOnEnter(): boolean {
    return (this.constructable as unknown as Record<string, boolean | undefined>)[InternalBlockToolSettings.KeepsChildrenOnEnter] === true;
  }

  /**
   * True when deleting this Tool's block deletes its whole subtree rather than
   * promoting its children to the block's parent.
   */
  public get deletesChildren(): boolean {
    return this.layoutLever(InternalBlockToolSettings.DeletesChildren);
  }

  /**
   * True when the block is a pure layout piece: no hover toolbar, never a
   * selection unit, and its descendants are laid out flush (no depth indent).
   */
  public get isLayout(): boolean {
    return this.layoutLever(InternalBlockToolSettings.IsLayout);
  }

  /**
   * A declared lever wins. Undeclared, the names `column` and `column_list`
   * keep the rules core applied to them by name before these levers existed,
   * so a host tool registered under those names behaves as it did.
   * @param setting - the static to read
   */
  private layoutLever(setting: InternalBlockToolSettings): boolean {
    const declared = (this.constructable as unknown as Record<string, boolean | undefined>)[setting];

    return declared ?? (this.name === 'column' || this.name === 'column_list');
  }

  /**
   * Returns the media asset kind the Tool stores at `data.url`, or undefined
   * for non-media tools. Lets consumers enumerate the media-bearing tool set
   * (via `api.tools.getBlockTools()`) for orphaned-asset cleanup without
   * hardcoding each tool's data shape.
   */
  public get assetKind(): AssetKind | undefined {
    return (this.constructable as unknown as Record<string, AssetKind | undefined>)[InternalBlockToolSettings.AssetKind];
  }

  /**
   * CSS radius of the rounded frame the Tool draws at its edge, or undefined
   * for a square block.
   */
  public get frameRadius(): string | undefined {
    const value = (this.constructable as unknown as Record<string, unknown>)[InternalBlockToolSettings.FrameRadius];

    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  /**
   * Upgrade a stored block's data through the Tool's own `upgradeData` hook, if
   * it declares one. Lets a Tool migrate a legacy data shape it once wrote into
   * the shape it reads today — the shapes core's global grammar migration can't
   * know about (columns, custom media). Called at load, before construction.
   *
   * Returns the data unchanged when the Tool declares no hook. A hook that
   * throws must never break document load: the original data is returned and the
   * failure is surfaced as a console warning, so a bad migration degrades to
   * "unmigrated" rather than a blank editor.
   * @param data - the stored block data
   * @returns the upgraded data (or the original on absence/error)
   */
  public upgradeData(data: BlockToolData): BlockToolData {
    const upgrade = (this.constructable as unknown as Record<string, ((data: BlockToolData) => BlockToolData) | undefined>)[InternalBlockToolSettings.UpgradeData];

    if (typeof upgrade !== 'function') {
      return data;
    }

    try {
      return upgrade.call(this.constructable, data);
    } catch (error) {
      log(`Tool «${this.name}» upgradeData() threw; loading the block with its stored data instead.`, 'warn', error);

      return data;
    }
  }

  /**
   * Returns true if Tool supports linebreaks
   */
  public get isLineBreaksEnabled(): boolean {
    return (this.constructable as unknown as Record<string, boolean | undefined>)[InternalBlockToolSettings.IsEnabledLineBreaks] ?? false;
  }

  /**
   * Returns Tool toolbox configuration (internal or user-specified).
   *
   * Merges internal and user-defined toolbox configs based on the following rules:
   *
   * - If both internal and user-defined toolbox configs are arrays their items are merged.
   * Length of the second one is kept.
   *
   * - If both are objects their properties are merged.
   *
   * - If one is an object and another is an array than internal config is replaced with user-defined
   * config. This is made to allow user to override default tool's toolbox representation (single/multiple entries)
   *
   * Additionally, if the tool's config contains a `toolboxStyles` array, only toolbox entries
   * whose `data.style` matches one of the specified styles will be included.
   */
  /**
   * Replaces the USER-level toolbox setting on this live adapter, so runtime
   * `tools.update(name, { toolbox })` calls reach an already-built adapter
   * (its settings were spread-copied at construction and would otherwise stay
   * frozen). `false` hides the tool from insertion surfaces; an object merges
   * over the tool's internal toolbox config; `undefined` restores defaults.
   * @param toolbox - new user toolbox setting
   */
  public setUserToolboxSetting(toolbox: ToolboxConfig | false | undefined): void {
    this.config[UserSettings.Toolbox] = toolbox;
  }

  public get toolbox(): ToolboxConfigEntry[] | undefined {
    const toolToolboxSettings = (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.Toolbox];
    const userToolboxSettings = this.config[UserSettings.Toolbox];

    if (!toolToolboxSettings || isEmpty(toolToolboxSettings)) {
      return;
    }
    if (userToolboxSettings === false) {
      return;
    }

    const mergedEntries = this.mergeToolboxSettings(toolToolboxSettings, userToolboxSettings);
    const filteredByStyles = this.filterToolboxEntriesByStyles(mergedEntries);

    return this.filterToolboxEntriesByLevels(filteredByStyles);
  }

  /**
   * Merges tool's internal toolbox settings with user-defined settings
   */
  private mergeToolboxSettings(
    toolSettings: ToolboxConfig,
    userSettings: ToolboxConfig | undefined | null
  ): ToolboxConfigEntry[] {
    /**
     * Return tool's toolbox settings if user settings are not defined
     */
    if (userSettings === undefined || userSettings === null) {
      return Array.isArray(toolSettings) ? toolSettings : [ toolSettings ];
    }

    /**
     * User provided single entry to override array of tool entries
     */
    if (!Array.isArray(userSettings) && Array.isArray(toolSettings)) {
      return [ userSettings ];
    }

    /**
     * Both are single entries - merge them
     */
    if (!Array.isArray(userSettings)) {
      return [
        {
          ...toolSettings,
          ...userSettings,
        },
      ];
    }

    /**
     * User provided array but tool has single entry
     */
    if (!Array.isArray(toolSettings)) {
      return userSettings;
    }

    /**
     * Both are arrays - merge item by item
     */
    return userSettings.map((item, i) => {
      const toolToolboxEntry = toolSettings[i];

      if (toolToolboxEntry) {
        return {
          ...toolToolboxEntry,
          ...item,
        };
      }

      return item;
    });
  }

  /**
   * Filters toolbox entries based on toolboxStyles config if specified.
   * This allows tools like List to show only specific variants in the toolbox.
   */
  private filterToolboxEntriesByStyles(entries: ToolboxConfigEntry[]): ToolboxConfigEntry[] {
    const toolboxStyles = this.settings.toolboxStyles as string[] | undefined;

    if (!toolboxStyles || !Array.isArray(toolboxStyles) || toolboxStyles.length === 0) {
      return entries;
    }

    return entries.filter(entry => {
      const entryData = entry.data as { style?: string } | undefined;

      if (!entryData || !entryData.style) {
        return true; // Keep entries without style data
      }

      return toolboxStyles.includes(entryData.style);
    });
  }

  /**
   * Filters toolbox entries based on levels config if specified.
   * This allows tools like Header to show only configured heading levels in the toolbox.
   */
  private filterToolboxEntriesByLevels(entries: ToolboxConfigEntry[]): ToolboxConfigEntry[] {
    const levels = this.settings.levels as number[] | undefined;

    if (!levels || !Array.isArray(levels) || levels.length === 0) {
      return entries;
    }

    return entries.filter(entry => {
      const entryData = entry.data as { level?: number } | undefined;

      if (!entryData || entryData.level === undefined) {
        return true; // Keep entries without level data
      }

      return levels.includes(entryData.level);
    });
  }

  /**
   * Returns Tool conversion configuration
   */
  public get conversionConfig(): ConversionConfig | undefined {
    return (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.ConversionConfig];
  }

  /**
   * Returns enabled inline tools for Tool.
   * Defaults to true (all inline tools) unless explicitly set to false or array.
   */
  public get enabledInlineTools(): boolean | string[] {
    const setting = this.config[UserSettings.EnabledInlineTools];

    // Default to true if not specified
    if (setting === undefined) {
      return true;
    }

    return setting;
  }

  /**
   * Returns enabled tunes for Tool
   */
  public get enabledBlockTunes(): boolean | string[] | undefined {
    return this.config[UserSettings.EnabledBlockTunes];
  }

  /**
   * User-provided search terms from tool settings.
   * These are merged with library-defined searchTerms in the toolbox config.
   */
  public get searchTerms(): string[] | undefined {
    return (this.config as Record<string, unknown>).searchTerms as string[] | undefined;
  }

  /**
   * Returns Tool paste configuration
   */
  public get pasteConfig(): PasteConfig {
    return (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.PasteConfig] ?? {};
  }

  /**
   * Returns true if Tool has onPaste handler
   */
  public get hasOnPasteHandler(): boolean {
    const prototype = (this.constructable as unknown as { prototype?: { onPaste?: unknown } })?.prototype;

    return typeof prototype?.onPaste === 'function';
  }

  /**
   * Fields holding inline HTML: those whose rule in the tool's OWN sanitize
   * config is a tag map. Read from `super.sanitizeConfig`, not the merged
   * getter — for a tool with no rules of its own the merged config is the flat
   * inline-tool tag map, whose keys are tag names, not fields.
   */
  public get richTextFields(): string[] {
    const toolRules = super.sanitizeConfig;

    return Object.keys(toolRules).filter(field => isObject(toolRules[field]));
  }

  /** What hosts receive for {@link richTextFields}. */
  public get richTextFormat(): RichTextFormat {
    return this.richTextFormatOption ?? 'html';
  }

  /**
   * Returns sanitize configuration for Block Tool including configs from related Inline Tools and Block Tunes
   */
  public get sanitizeConfig(): SanitizerConfig {
    if (this._sanitizeConfig) {
      return this._sanitizeConfig;
    }

    const toolRules = super.sanitizeConfig;
    const baseConfig = this.baseSanitizeConfig;

    if (isEmpty(toolRules)) {
      this._sanitizeConfig = baseConfig;

      return baseConfig;
    }

    const toolConfig = {} as SanitizerConfig;

    for (const fieldName in toolRules) {
      if (!Object.prototype.hasOwnProperty.call(toolRules, fieldName)) {
        continue;
      }

      const rule = toolRules[fieldName];

      /**
       * If rule is object, merge it with Inline Tools configuration
       *
       * Otherwise pass as it is
       */
      if (isObject(rule)) {
        toolConfig[fieldName] = Object.assign({}, baseConfig, rule);
      } else {
        toolConfig[fieldName] = rule;
      }
    }

    this._sanitizeConfig = toolConfig;

    return toolConfig;
  }

  /**
   * Returns sanitizer configuration composed from sanitize config of Inline Tools enabled for Tool
   */
  public get baseSanitizeConfig(): SanitizerConfig {
    if (this._baseSanitizeConfig) {
      return this._baseSanitizeConfig;
    }

    const baseConfig = composeBaseSanitizeConfig([
      ...Array.from(this.inlineTools.values()).map(tool => tool.sanitizeConfig),
      ...Array.from(this.tunes.values()).map(tune => tune.sanitizeConfig),
    ]);

    this._baseSanitizeConfig = baseConfig;

    return baseConfig;
  }

  /**
   * Drops the memoized sanitize configs so the next access recomposes them
   * from the current inline tools / tunes. Internal — called by the Tools
   * module when the enabled inline-tool set changes at runtime
   * (tools.setInlineToolbar); not part of the published adapter interface.
   */
  public invalidateSanitizeCache(): void {
    this._sanitizeConfig = undefined;
    this._baseSanitizeConfig = undefined;
  }
}
