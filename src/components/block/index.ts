import type {
  BlockAPI as BlockAPIInterface,
  BlockTool as IBlockTool,
  BlockToolData,
  SanitizerConfig,
  ToolConfig,
  ToolboxConfigEntry,
  PopoverItemParams
} from '../../../types';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { SavedData } from '../../../types/data-formats';
import { Dom as $, toggleEmptyMark } from '../dom';
import type { BlokEventMap } from '../events';
import type { API as ApiModules } from '../modules/api';
import type { DragController } from '../modules/drag/DragController';
import type { BlockToolAdapter } from '../tools/block';
import type { ToolsCollection } from '../tools/collection';
import type { BlockTuneAdapter } from '../tools/tune';
import { generateBlockId, isFunction, log } from '../utils';
import { isSameBlockData } from '../utils/blocks';
import { EventsDispatcher } from '../utils/events';

import { BlockAPI } from './api';
import { DataPersistenceManager } from './data-persistence-manager';
import { InputManager } from './input-manager';
import { MutationHandler } from './mutation-handler';
import { SelectionManager } from './selection-manager';
import { StyleManager } from './style-manager';
import { ToolRenderer } from './tool-renderer';
import { TunesManager } from './tunes-manager';

/**
 * Interface describes Block class constructor argument
 */
type BlockSaveResult = SavedData & { tunes: { [name: string]: BlockTuneData } };

interface BlockConstructorOptions {
  /**
   * Block's id. Should be passed for existed block, and omitted for a new one.
   */
  id?: string;

  /**
   * Initial Block data
   */
  data: BlockToolData;

  /**
   * Tool object
   */
  tool: BlockToolAdapter;

  /**
   * Blok's API methods
   */
  api: ApiModules;

  /**
   * This flag indicates that the Block should be constructed in the read-only mode.
   */
  readOnly: boolean;

  /**
   * Tunes data for current Block
   */
  tunesData: { [name: string]: BlockTuneData };

  /**
   * Parent block id for hierarchical structure (Notion-like flat-with-references model).
   * When present, this block is a child of the block with the specified id.
   */
  parentId?: string;

  /**
   * Array of child block ids (Notion-like flat-with-references model).
   * References blocks that are children of this block.
   */
  contentIds?: string[];

  /**
   * When true, bind internal mutation watchers immediately instead of deferring via requestIdleCallback.
   * Use for user-created blocks where mutations need to be tracked right away.
   * Note: This controls Block-internal events (MutationObserver, input focus).
   * Module-level events (keyboard handlers) are controlled separately by BlockManager.
   */
  bindMutationWatchersImmediately?: boolean;
}

/**
 * @class Block
 * @classdesc This class describes blok`s block, including block`s HTMLElement, data and tool
 * @property {BlockToolAdapter} tool — current block tool (Paragraph, for example)
 * @property {object} CSS — block`s css classes
 */

/**
 * Available Block Tool API methods
 */
export enum BlockToolAPI {
  RENDERED = 'rendered',
  MOVED = 'moved',
  UPDATED = 'updated',
  REMOVED = 'removed',

  ON_PASTE = 'onPaste',
}

/**
 * Names of events used in Block
 */
interface BlockEvents {
  'didMutated': Block,
}

/**
 * @classdesc Abstract Block class that contains Block information, Tool name and Tool class instance
 * @property {BlockToolAdapter} tool - Tool instance
 * @property {HTMLElement} holder - Div element that wraps block content with Tool's content.
 * @property {HTMLElement} pluginsContent - HTML content that returns by Tool's render function
 */
export class Block extends EventsDispatcher<BlockEvents> {

  /**
   * Block unique identifier
   */
  public id: string;

  /**
   * Parent block id for hierarchical structure (Notion-like flat-with-references model).
   * Null if this is a root-level block.
   */
  public parentId: string | null;

  /**
   * Array of child block ids (Notion-like flat-with-references model).
   * Empty array if block has no children.
   */
  public contentIds: string[];

  /**
   * Block Tool`s name
   */
  public readonly name: string;

  /**
   * Instance of the Tool Block represents
   */
  public readonly tool: BlockToolAdapter;

  /**
   * User Tool configuration
   */
  public readonly settings: ToolConfig;

  /**
   * Wrapper for Block`s content
   */
  public readonly holder: HTMLDivElement;

  /**
   * Tunes used by Tool
   */
  public readonly tunes: ToolsCollection<BlockTuneAdapter>;

  /**
   * Tool's user configuration
   */
  public readonly config: ToolConfig;

  /**
   * Tool class instance
   */
  private readonly toolInstance: IBlockTool;

  /**
   * Manages block tunes
   */
  private readonly tunesManager: TunesManager;

  /**
   * Promise that resolves when the block is ready (rendered)
   */
  public ready: Promise<void>;

  /**
   * Common blok event bus
   */
  private readonly blokEventBus: EventsDispatcher<BlokEventMap> | null = null;

  /**
   * Manages input elements within the block
   */
  private readonly inputManager: InputManager;

  /**
   * Handles mutation observation and filtering
   */
  private readonly mutationHandler: MutationHandler;

  /**
   * Current block API interface
   */
  private readonly blockAPI: BlockAPIInterface;

  /**
   * Cleanup function for draggable behavior
   */
  private draggableCleanup: (() => void) | null = null;

  /**
   * Manages tool element composition and rendering
   */
  private readonly toolRenderer: ToolRenderer;

  /**
   * Manages block visual state including stretched mode
   */
  private readonly styleManager: StyleManager;

  /**
   * Manages block selection logic including fake cursor
   */
  private readonly selectionManager: SelectionManager;

  /**
   * Manages data extraction, caching, and in-place updates
   */
  private readonly dataPersistenceManager: DataPersistenceManager;


  /**
   * @param options - block constructor options
   * @param [options.id] - block's id. Will be generated if omitted.
   * @param options.data - Tool's initial data
   * @param options.tool — block's tool
   * @param options.api - Blok API module for pass it to the Block Tunes
   * @param options.readOnly - Read-Only flag
   * @param [options.parentId] - parent block id for hierarchical structure
   * @param [options.contentIds] - array of child block ids
   * @param [eventBus] - Blok common event bus. Allows to subscribe on some Blok events. Could be omitted when "virtual" Block is created. See BlocksAPI@composeBlockData.
   */
  constructor({
    id = generateBlockId(),
    data,
    tool,
    readOnly,
    tunesData,
    parentId,
    contentIds,
    bindMutationWatchersImmediately = false,
  }: BlockConstructorOptions, eventBus?: EventsDispatcher<BlokEventMap>) {
    super();

    // Set basic properties
    this.name = tool.name;
    this.id = id;
    this.parentId = parentId ?? null;
    this.contentIds = contentIds ?? [];
    this.settings = tool.settings;
    this.config = this.settings;
    this.blokEventBus = eventBus || null;
    this.blockAPI = new BlockAPI(this);

    this.tool = tool;
    this.toolInstance = tool.create(data, this.blockAPI, readOnly);
    this.tunes = tool.tunes;

    // Initialize tunes manager (needed by ToolRenderer)
    this.tunesManager = new TunesManager(this.tunes, tunesData, this.blockAPI);

    // Initialize ToolRenderer to create the DOM structure
    this.toolRenderer = new ToolRenderer(
      this.toolInstance,
      this.name,
      this.id,
      this.tunesManager,
      this.config
    );

    // Compose the block and get the holder
    this.holder = this.toolRenderer.compose();
    this.ready = this.toolRenderer.ready;

    // Initialize StyleManager with holder and content element
    this.styleManager = new StyleManager(
      this.holder,
      this.toolRenderer.contentElement
    );

    // Initialize SelectionManager with dependencies
    this.selectionManager = new SelectionManager(
      this.holder,
      () => this.toolRenderer.contentElement,
      () => this.styleManager.stretched,
      this.blokEventBus,
      this.styleManager
    );

    // Initialize input manager (needed by DataPersistenceManager)
    this.inputManager = new InputManager(
      this.holder,
      () => this.didMutated()
    );

    // Initialize mutation handler
    this.mutationHandler = new MutationHandler(
      () => this.toolRenderer.toolRenderedElement,
      this.blokEventBus,
      (mutations) => this.didMutated(mutations)
    );

    // Initialize DataPersistenceManager
    this.dataPersistenceManager = new DataPersistenceManager(
      this.toolInstance,
      () => this.toolRenderer.toolRenderedElement,
      this.tunesManager,
      this.name,
      () => this.isEmpty,
      this.inputManager,
      () => this.call(BlockToolAPI.UPDATED),
      () => this.toggleInputsEmptyMark(),
      data,
      tunesData
    );

    // Bind block mutation watchers and input events
    // - Immediately if bindMutationWatchersImmediately is true (for user-created blocks)
    // - Deferred via requestIdleCallback otherwise (for initial load optimization)
    const bindEvents = (): void => {
      this.mutationHandler.watch();
      this.inputManager.addInputEvents();
      this.toggleInputsEmptyMark();
    };

    if (bindMutationWatchersImmediately) {
      bindEvents();
    } else {
      window.requestIdleCallback(bindEvents);
    }
  }

  /**
   * Makes this block draggable using the provided drag handle element
   * Called by the toolbar when it moves to this block
   * @param dragHandle - The element to use as the drag handle
   * @param dragManager - DragManager instance to handle drag operations
   */
  public setupDraggable(dragHandle: HTMLElement, dragManager: DragController): void {
    /** Clean up any existing draggable */
    this.cleanupDraggable();

    /** Set up drag handling via DragManager (pointer-based, not native HTML5 drag) */
    this.draggableCleanup = dragManager.setupDragHandle(dragHandle, this);
  }

  /**
   * Cleans up the draggable behavior
   * Called when the toolbar moves away from this block
   */
  public cleanupDraggable(): void {
    if (this.draggableCleanup) {
      this.draggableCleanup();
      this.draggableCleanup = null;
    }
  }

  /**
   * Calls Tool's method
   *
   * Method checks tool property {MethodName}. Fires method with passes params If it is instance of Function
   * @param {string} methodName - method to call
   * @param {object} params - method argument
   */
  public call(methodName: string, params?: object): void {
    /**
     * call Tool's method with the instance context
     */
    const method = (this.toolInstance as unknown as Record<string, unknown>)[methodName];

    if (!isFunction(method)) {
      return;
    }

    try {

      method.call(this.toolInstance, params);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      log(`Error during '${methodName}' call: ${errorMessage}`, 'error');
    }
  }

  /**
   * Call plugins merge method
   * @param {BlockToolData} data - data to merge
   */
  public async mergeWith(data: BlockToolData): Promise<void> {
    if (!isFunction(this.toolInstance.merge)) {
      throw new Error(`Block tool "${this.name}" does not support merging`);
    }

    await this.toolInstance.merge(data);
  }

  /**
   * Returns the horizontal offset of the content at the hovered element.
   * Delegates to the tool's getContentOffset method if implemented.
   *
   * @param hoveredElement - The element that is currently being hovered
   * @returns Object with left offset in pixels, or undefined if no offset should be applied
   */
  public getContentOffset(hoveredElement: Element): { left: number } | undefined {
    if (typeof this.toolInstance.getContentOffset === 'function') {
      return this.toolInstance.getContentOffset(hoveredElement);
    }

    return undefined;
  }

  /**
   * Extracts data from Block
   * Groups Tool's save processing time
   * @returns {object}
   */
  public async save(): Promise<undefined | BlockSaveResult> {
    const result = await this.dataPersistenceManager.save();

    if (result === undefined) {
      return undefined;
    }

    // Override id with the actual block id
    result.id = this.id;

    return result;
  }

  /**
   * Uses Tool's validation method to check the correctness of output data
   * Tool's validation method is optional
   * @description Method returns true|false whether data passed the validation or not
   * @param {BlockToolData} data - data to validate
   * @returns {Promise<boolean>} valid
   */
  public async validate(data: BlockToolData): Promise<boolean> {
    return this.dataPersistenceManager.validate(data);
  }

  /**
   * Returns data to render in Block Tunes menu.
   * Splits block tunes into 2 groups: block specific tunes and common tunes
   */
  public getTunes(): {
      toolTunes: PopoverItemParams[];
      commonTunes: PopoverItemParams[];
      } {
    /** Tool's tunes: may be defined as return value of optional renderSettings method */
    const tunesDefinedInTool = typeof this.toolInstance.renderSettings === 'function' ? this.toolInstance.renderSettings() : [];

    return this.tunesManager.getMenuConfig(tunesDefinedInTool);
  }

  /**
   * Update current input index with selection anchor node
   */
  public updateCurrentInput(): void {
    this.inputManager.updateCurrentInput();
  }

  /**
   * Allows to say Blok that Block was changed. Used to manually trigger Blok's 'onChange' callback
   * Can be useful for block changes invisible for blok core.
   */
  public dispatchChange(): void {
    this.didMutated();
  }

  /**
   * Updates the block's data in-place without destroying the DOM element.
   * This preserves focus and caret position during updates like undo/redo.
   *
   * @param newData - the new data to apply to the block
   * @returns true if the update was performed in-place, false if a full re-render is needed
   */
  public async setData(newData: BlockToolData): Promise<boolean> {
    return this.dataPersistenceManager.setData(newData);
  }

  /**
   * Call Tool instance destroy method
   */
  public destroy(): void {
    this.mutationHandler.destroy();
    this.inputManager.destroy();

    /** Clean up drag and drop */
    if (this.draggableCleanup) {
      this.draggableCleanup();
      this.draggableCleanup = null;
    }

    super.destroy();

    if (isFunction(this.toolInstance.destroy)) {
      this.toolInstance.destroy();
    }
  }

  /**
   * Tool could specify several entries to be displayed at the Toolbox (for example, "Heading 1", "Heading 2", "Heading 3")
   * This method returns the entry that is related to the Block (depended on the Block data)
   */
  public async getActiveToolboxEntry(): Promise<ToolboxConfigEntry | undefined> {
    const toolboxSettings = this.tool.toolbox;

    if (!toolboxSettings) {
      return undefined;
    }

    /**
     * If Tool specifies just the single entry, treat it like an active
     */
    if (toolboxSettings.length === 1) {
      return Promise.resolve(toolboxSettings[0]);
    }

    /**
     * If we have several entries with their own data overrides,
     * find those who matches some current data property
     *
     * Example:
     *  Tools' toolbox: [
     *    {title: "Heading 1", data: {level: 1} },
     *    {title: "Heading 2", data: {level: 2} }
     *  ]
     *
     *  the Block data: {
     *    text: "Heading text",
     *    level: 2
     *  }
     *
     *  that means that for the current block, the second toolbox item (matched by "{level: 2}") is active
     */
    const blockData = await this.data;

    return toolboxSettings.find((item) => {
      return item.data !== undefined && isSameBlockData(item.data, blockData);
    });
  }

  /**
   * Exports Block data as string using conversion config
   */
  public async exportDataAsString(): Promise<string> {
    return this.dataPersistenceManager.exportDataAsString(this.tool.conversionConfig ?? {});
  }

  /**
   * Find and return all editable elements (contenteditable and native inputs) in the Tool HTML
   */
  public get inputs(): HTMLElement[] {
    return this.inputManager.inputs;
  }

  /**
   * Return current Tool's input
   * If Block doesn't contain inputs, return undefined
   */
  public get currentInput(): HTMLElement | undefined {
    return this.inputManager.currentInput;
  }

  /**
   * Returns the current input index (for caret restoration)
   */
  public get currentInputIndex(): number {
    return this.inputManager.currentInputIndex;
  }

  /**
   * Set input index to the passed element
   * @param element - HTML Element to set as current input
   */
  public set currentInput(element: HTMLElement | undefined) {
    this.inputManager.currentInput = element;
  }

  /**
   * Return first Tool's input
   * If Block doesn't contain inputs, return undefined
   */
  public get firstInput(): HTMLElement | undefined {
    return this.inputManager.firstInput;
  }

  /**
   * Return last Tool's input
   * If Block doesn't contain inputs, return undefined
   */
  public get lastInput(): HTMLElement | undefined {
    return this.inputManager.lastInput;
  }

  /**
   * Return next Tool's input or undefined if it doesn't exist
   * If Block doesn't contain inputs, return undefined
   */
  public get nextInput(): HTMLElement | undefined {
    return this.inputManager.nextInput;
  }

  /**
   * Return previous Tool's input or undefined if it doesn't exist
   * If Block doesn't contain inputs, return undefined
   */
  public get previousInput(): HTMLElement | undefined {
    return this.inputManager.previousInput;
  }

  /**
   * Get Block's JSON data
   * @returns {object}
   */
  public get data(): Promise<BlockToolData> {
    return this.dataPersistenceManager.data;
  }

  /**
   * Returns last successfully extracted block data
   */
  public get preservedData(): BlockToolData {
    return this.dataPersistenceManager.preservedData;
  }

  /**
   * Returns last successfully extracted tune data
   */
  public get preservedTunes(): { [name: string]: BlockTuneData } {
    return this.dataPersistenceManager.preservedTunes;
  }

  /**
   * Returns tool's sanitizer config
   * @returns {object}
   */
  public get sanitize(): SanitizerConfig {
    return this.tool.sanitizeConfig;
  }

  /**
   * is block mergeable
   * We plugin have merge function then we call it mergeable
   * @returns {boolean}
   */
  public get mergeable(): boolean {
    return isFunction(this.toolInstance.merge);
  }

  /**
   * If Block contains inputs, it is focusable
   */
  public get focusable(): boolean {
    return this.inputs.length !== 0;
  }

  /**
   * Check block for emptiness
   * @returns {boolean}
   */
  public get isEmpty(): boolean {
    const emptyText = $.isEmpty(this.pluginsContent, '/');
    const emptyMedia = !this.hasMedia;

    return emptyText && emptyMedia;
  }

  /**
   * Check if block has a media content such as images, iframe and other
   * @returns {boolean}
   */
  public get hasMedia(): boolean {
    /**
     * This tags represents media-content
     * @type {string[]}
     */
    const mediaTags = [
      'img',
      'iframe',
      'video',
      'audio',
      'source',
      'input',
      'textarea',
      'twitterwidget',
    ];

    return !!this.holder.querySelector(mediaTags.join(','));
  }

  /**
   * Set selected state
   * We don't need to mark Block as Selected when it is empty
   * @param {boolean} state - 'true' to select, 'false' to remove selection
   */
  public set selected(state: boolean) {
    this.selectionManager.selected = state;
  }

  /**
   * Returns True if it is Selected
   * @returns {boolean}
   */
  public get selected(): boolean {
    return this.selectionManager.selected;
  }

  /**
   * Set stretched state
   * @param {boolean} state - 'true' to enable, 'false' to disable stretched state
   */
  public setStretchState(state: boolean): void {
    this.styleManager.setStretchState(state, this.selected);
  }

  /**
   * Backward-compatible setter for stretched state
   * @param state - true to enable, false to disable stretched state
   */
  public set stretched(state: boolean) {
    this.setStretchState(state);
  }

  /**
   * Return Block's stretched state
   * @returns {boolean}
   */
  public get stretched(): boolean {
    return this.styleManager.stretched;
  }


  /**
   * Returns Plugins content
   * @returns {HTMLElement}
   */
  public get pluginsContent(): HTMLElement {
    return this.toolRenderer.pluginsContent;
  }

  /**
   * Is fired when DOM mutation has been happened
   * @param mutationsOrInputEvent - actual changes
   *   - MutationRecord[] - any DOM change
   *   - InputEvent — <input> change (from InputManager callback)
   *   - undefined — manual triggering of block.dispatchChange()
   */
  private readonly didMutated = (mutationsOrInputEvent: MutationRecord[] | InputEvent | undefined = undefined): void => {
    const result = this.mutationHandler.handleMutation(mutationsOrInputEvent);

    if (result.newToolRoot) {
      // The tool renderer's reference will be updated when next accessed via getter
      // No action needed here as toolRenderer.toolRenderedElement is a getter
    }

    if (!result.shouldFireUpdate) {
      return;
    }

    this.inputManager.dropCache();
    this.inputManager.updateCurrentInput();
    this.toggleInputsEmptyMark();
    this.call(BlockToolAPI.UPDATED);
    this.emit('didMutated', this);
  };

  /**
   * Remove redactor dom change event listener.
   * Can be called to stop watching mutations before destroying the block.
   */
  public unwatchBlockMutations(): void {
    this.mutationHandler.unwatch();
  }

  /**
   * Refreshes the reference to the tool's root element by inspecting the block content.
   * Call this after operations (like onPaste) that might cause the tool to replace its element,
   * especially when mutation observers haven't been set up yet.
   */
  public refreshToolRootElement(): void {
    this.toolRenderer.refreshToolRootElement(this.holder);
    this.inputManager.dropCache();
  }

  /**
   * Mark inputs with 'data-blok-empty' attribute with the empty state
   */
  private toggleInputsEmptyMark(): void {
    this.inputs.forEach(toggleEmptyMark);
  }
}
