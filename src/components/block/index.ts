import type {
  BlockAPI as BlockAPIInterface,
  BlockTool as IBlockTool,
  BlockToolData,
  BlockTune as IBlockTune,
  SanitizerConfig,
  ToolConfig,
  ToolboxConfigEntry,
  PopoverItemParams
} from '../../../types';

import type { SavedData } from '../../../types/data-formats';
import { twMerge } from '../utils/tw';
import $, { toggleEmptyMark } from '../dom';
import * as _ from '../utils';
import type ApiModules from '../modules/api';
import BlockAPI from './api';
import SelectionUtils from '../selection';
import type BlockToolAdapter from '../tools/block';

import type BlockTuneAdapter from '../tools/tune';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type ToolsCollection from '../tools/collection';
import EventsDispatcher from '../utils/events';
import type { MenuConfigItem } from '../../../types/tools';
import { isMutationBelongsToElement } from '../utils/mutations';
import type { BlokEventMap } from '../events';
import { FakeCursorAboutToBeToggled, FakeCursorHaveBeenSet, RedactorDomChanged } from '../events';
import type { RedactorDomChangedPayload } from '../events/RedactorDomChanged';
import { convertBlockDataToString, isSameBlockData } from '../utils/blocks';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import {
  BLOK_ELEMENT_ATTR,
  BLOK_ELEMENT_CONTENT_ATTR,
  BLOK_ELEMENT_CONTENT_SELECTOR,
  BLOK_SELECTED_ATTR,
  BLOK_STRETCHED_ATTR,
} from '../constants';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

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
export default class Block extends EventsDispatcher<BlockEvents> {

  /**
   * Tailwind styles for the Block elements
   */
  private static readonly styles = {
    wrapper: 'relative opacity-100 animate-fade-in first:mt-0 [&_a]:cursor-pointer [&_a]:underline [&_a]:text-link [&_b]:font-bold [&_i]:italic',
    content: 'relative mx-auto transition-colors duration-150 ease-out max-w-content',
    contentSelected: 'bg-selection rounded-[4px] [&_[contenteditable]]:select-none [&_img]:opacity-55 [&_[data-blok-tool=stub]]:opacity-55',
    contentStretched: 'max-w-none',
  };

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
   * Stores last successfully extracted block data
   */
  private lastSavedData: BlockToolData;

  /**
   * Cached inputs
   */
  private cachedInputs: HTMLElement[] = [];

  /**
   * Stores last successfully extracted tunes data
   */
  private lastSavedTunes: { [name: string]: BlockTuneData } = {};

  /**
   * We'll store a reference to the tool's rendered element to access it later
   */
  private toolRenderedElement: HTMLElement | null = null;

  /**
   * Reference to the content wrapper element for style toggling
   */
  private contentElement: HTMLElement | null = null;

  /**
   * Tool class instance
   */
  private readonly toolInstance: IBlockTool;

  /**
   * User provided Block Tunes instances
   */
  private readonly tunesInstances: Map<string, IBlockTune> = new Map();

  /**
   * Blok provided Block Tunes instances
   */
  private readonly defaultTunesInstances: Map<string, IBlockTune> = new Map();

  /**
   * Promise that resolves when the block is ready (rendered)
   */
  public ready: Promise<void>;

  /**
   * Resolver for ready promise
   */
  private readyResolver: (() => void) | null = null;

  /**
   * If there is saved data for Tune which is not available at the moment,
   * we will store it here and provide back on save so data is not lost
   */
  private unavailableTunesData: { [name: string]: BlockTuneData } = {};

  /**
   * Focused input index
   * @type {number}
   */
  private inputIndex = 0;

  /**
   * Common blok event bus
   */
  private readonly blokEventBus: EventsDispatcher<BlokEventMap> | null = null;

  /**
   * Current block API interface
   */
  private readonly blockAPI: BlockAPIInterface;

  /**
   * Cleanup function for draggable behavior
   */
  private draggableCleanup: (() => void) | null = null;

  /**
   * Cleanup function for drop target behavior
   */
  private dropTargetCleanup: (() => void) | null = null;

  /**
   * Current closest edge during drag hover
   */
  private currentClosestEdge: Edge | null = null;

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
    id = _.generateBlockId(),
    data,
    tool,
    readOnly,
    tunesData,
    parentId,
    contentIds,
  }: BlockConstructorOptions, eventBus?: EventsDispatcher<BlokEventMap>) {
    super();
    this.ready = new Promise((resolve) => {
      this.readyResolver = resolve;
    });
    this.name = tool.name;
    this.id = id;
    this.parentId = parentId ?? null;
    this.contentIds = contentIds ?? [];
    this.settings = tool.settings;
    this.config = this.settings;
    this.blokEventBus = eventBus || null;
    this.blockAPI = new BlockAPI(this);
    this.lastSavedData = data ?? {};
    this.lastSavedTunes = tunesData ?? {};


    this.tool = tool;
    this.toolInstance = tool.create(data, this.blockAPI, readOnly);

    /**
     * @type {BlockTuneAdapter[]}
     */
    this.tunes = tool.tunes;

    this.composeTunes(tunesData);

    const holderElement = this.compose();

    if (holderElement == null) {
      throw new Error(`Tool "${this.name}" did not return a block holder element during render()`);
    }

    this.holder = holderElement;

    /**
     * Bind block events in RIC for optimizing of constructing process time
     */
    window.requestIdleCallback(() => {
      /**
       * Start watching block mutations
       */
      this.watchBlockMutations();

      /**
       * Mutation observer doesn't track changes in "<input>" and "<textarea>"
       * so we need to track focus events to update current input and clear cache.
       */
      this.addInputEvents();

      /**
       * We mark inputs with [data-blok-empty] attribute
       * It can be useful for developers, for example for correct placeholder behavior
       */
      this.toggleInputsEmptyMark();

      /**
       * Set up drag and drop behavior for this block
       */
      if (!readOnly) {
        this.setupDragAndDrop();
      }
    });
  }

  /**
   * Sets up Pragmatic Drag and Drop for this block
   * Makes the block draggable (via drag handle) and a drop target
   */
  private setupDragAndDrop(): void {
    /** Find the drag handle element (settings toggler button) */

    /**
     * Drag handle might not be available immediately if the toolbar moves to a different block.
     * The draggable will be set up when the toolbar moves to this block.
     * For now, we only set up the drop target.
     */

    /** Set up drop target on the block holder */
    this.dropTargetCleanup = dropTargetForElements({
      element: this.holder,
      getData: ({ input, element }) => {
        const data = attachClosestEdge(
          { blockId: this.id },
          {
            input,
            element,
            allowedEdges: ['top', 'bottom'],
          }
        );

        return data;
      },
      onDragEnter: ({ self }) => {
        const edge = extractClosestEdge(self.data);

        this.currentClosestEdge = edge;
        this.updateDropIndicator(edge);
      },
      onDrag: ({ self }) => {
        const edge = extractClosestEdge(self.data);

        if (edge !== this.currentClosestEdge) {
          this.currentClosestEdge = edge;
          this.updateDropIndicator(edge);
        }
      },
      onDragLeave: () => {
        this.currentClosestEdge = null;
        this.updateDropIndicator(null);
      },
      onDrop: () => {
        this.currentClosestEdge = null;
        this.updateDropIndicator(null);
      },
    });
  }

  /**
   * Updates the drop indicator visual feedback
   * @param edge - The edge to show indicator on, or null to hide
   */
  private updateDropIndicator(edge: Edge | null): void {
    /** Remove any existing indicators */
    this.holder.removeAttribute('data-drop-indicator');

    if (edge) {
      this.holder.setAttribute('data-drop-indicator', edge);
    }
  }

  /**
   * Makes this block draggable using the provided drag handle element
   * Called by the toolbar when it moves to this block
   * @param dragHandle - The element to use as the drag handle
   */
  public setupDraggable(dragHandle: HTMLElement): void {
    /** Clean up any existing draggable */
    this.cleanupDraggable();

    /** Store reference for cleanup */
    this.currentDragHandle = dragHandle;

    /** Set the draggable attribute - required for native HTML5 drag and drop */
    dragHandle.setAttribute('draggable', 'true');

    this.draggableCleanup = draggable({
      element: dragHandle,
      getInitialData: () => ({
        blockId: this.id,
      }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        if (this.contentElement === null) {
          return;
        }

        const contentElement = this.contentElement;
        const isStretched = this.stretched;

        /**
         * Use the block content element as drag image, positioned 20px to the right of cursor
         */
        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: pointerOutsideOfPreview({ x: '20px', y: '0px' }),
          render({ container }) {
            const clone = contentElement.cloneNode(true) as HTMLElement;

            /** Remove selection styling from the clone */
            clone.className = twMerge(Block.styles.content, isStretched ? Block.styles.contentStretched : '');

            container.appendChild(clone);
          },
        });
      },
    });
  }

  /**
   * Reference to the current drag handle element
   */
  private currentDragHandle: HTMLElement | null = null;

  /**
   * Cleans up the draggable behavior
   * Called when the toolbar moves away from this block
   */
  public cleanupDraggable(): void {
    if (this.draggableCleanup) {
      this.draggableCleanup();
      this.draggableCleanup = null;
    }
    if (this.currentDragHandle) {
      this.currentDragHandle.removeAttribute('draggable');
      this.currentDragHandle = null;
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

    if (!_.isFunction(method)) {
      return;
    }

    try {

      method.call(this.toolInstance, params);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      _.log(`Error during '${methodName}' call: ${errorMessage}`, 'error');
    }
  }

  /**
   * Call plugins merge method
   * @param {BlockToolData} data - data to merge
   */
  public async mergeWith(data: BlockToolData): Promise<void> {
    if (!_.isFunction(this.toolInstance.merge)) {
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
    const extractedBlock = await this.extractToolData();

    if (extractedBlock === undefined) {
      return undefined;
    }

    const tunesData: { [name: string]: BlockTuneData } = { ...this.unavailableTunesData };

    [
      ...this.tunesInstances.entries(),
      ...this.defaultTunesInstances.entries(),
    ]
      .forEach(([name, tune]) => {
        if (_.isFunction(tune.save)) {
          try {
            tunesData[name] = tune.save();
          } catch (e) {
            _.log(`Tune ${tune.constructor.name} save method throws an Error %o`, 'warn', e);
          }
        }
      });

    /**
     * Measuring execution time
     */
    const measuringStart = window.performance.now();

    this.lastSavedData = extractedBlock;
    this.lastSavedTunes = { ...tunesData };

    const measuringEnd = window.performance.now();

    return {
      id: this.id,
      tool: this.name,
      data: extractedBlock,
      tunes: tunesData,
      time: measuringEnd - measuringStart,
    };
  }

  /**
   * Safely executes tool.save capturing possible errors without breaking the saver pipeline
   */
  private async extractToolData(): Promise<BlockToolData | undefined> {
    try {
      const extracted = await this.toolInstance.save(this.pluginsContent as HTMLElement);

      if (!this.isEmpty || extracted === undefined || extracted === null || typeof extracted !== 'object') {
        return extracted;
      }

      const normalized = { ...extracted } as Record<string, unknown>;
      const sanitizeField = (field: string): void => {
        const value = normalized[field];

        if (typeof value !== 'string') {
          return;
        }

        const container = document.createElement('div');

        container.innerHTML = value;

        if ($.isEmpty(container)) {
          normalized[field] = '';
        }
      };

      sanitizeField('text');
      sanitizeField('html');

      return normalized as BlockToolData;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));

      _.log(
        `Saving process for ${this.name} tool failed due to the ${normalizedError}`,
        'log',
        normalizedError
      );

      return undefined;
    }
  }

  /**
   * Uses Tool's validation method to check the correctness of output data
   * Tool's validation method is optional
   * @description Method returns true|false whether data passed the validation or not
   * @param {BlockToolData} data - data to validate
   * @returns {Promise<boolean>} valid
   */
  public async validate(data: BlockToolData): Promise<boolean> {
    if (this.toolInstance.validate instanceof Function) {
      return await this.toolInstance.validate(data);
    }

    return true;
  }

  /**
   * Returns data to render in Block Tunes menu.
   * Splits block tunes into 2 groups: block specific tunes and common tunes
   */
  public getTunes(): {
      toolTunes: PopoverItemParams[];
      commonTunes: PopoverItemParams[];
      } {
    const toolTunesPopoverParams: PopoverItemParams[] = [];
    const commonTunesPopoverParams: PopoverItemParams[] = [];
    const pushTuneConfig = (
      tuneConfig: MenuConfigItem | MenuConfigItem[] | HTMLElement | undefined,
      target: PopoverItemParams[]
    ): void => {
      if (!tuneConfig) {
        return;
      }

      if ($.isElement(tuneConfig)) {
        target.push({
          type: PopoverItemType.Html,
          element: tuneConfig,
        });

        return;
      }

      if (Array.isArray(tuneConfig)) {
        target.push(...tuneConfig);

        return;
      }

      target.push(tuneConfig);
    };

    /** Tool's tunes: may be defined as return value of optional renderSettings method */
    const tunesDefinedInTool = typeof this.toolInstance.renderSettings === 'function' ? this.toolInstance.renderSettings() : [];

    pushTuneConfig(tunesDefinedInTool, toolTunesPopoverParams);

    /** Common tunes: combination of default tunes (move up, move down, delete) and third-party tunes connected via tunes api */
    const commonTunes = [
      ...this.tunesInstances.values(),
      ...this.defaultTunesInstances.values(),
    ].map(tuneInstance => tuneInstance.render());

    /** Separate custom html from Popover items params for common tunes */
    commonTunes.forEach(tuneConfig => {
      pushTuneConfig(tuneConfig, commonTunesPopoverParams);
    });

    return {
      toolTunes: toolTunesPopoverParams,
      commonTunes: commonTunesPopoverParams,
    };
  }

  /**
   * Update current input index with selection anchor node
   */
  public updateCurrentInput(): void {
    /**
     * If activeElement is native input, anchorNode points to its parent.
     * So if it is native input use it instead of anchorNode
     *
     * If anchorNode is undefined, also use activeElement
     */
    const anchorNode = SelectionUtils.anchorNode;
    const activeElement = document.activeElement;

    const resolveInput = (node: Node | null): HTMLElement | undefined => {
      if (!node) {
        return undefined;
      }

      const element = node instanceof HTMLElement ? node : node.parentElement;

      if (element === null) {
        return undefined;
      }

      const directMatch = this.inputs.find((input) => input === element || input.contains(element));

      if (directMatch !== undefined) {
        return directMatch;
      }

      const closestEditable = element.closest($.allInputsSelector);

      if (!(closestEditable instanceof HTMLElement)) {
        return undefined;
      }

      const closestMatch = this.inputs.find((input) => input === closestEditable);

      if (closestMatch !== undefined) {
        return closestMatch;
      }

      return undefined;
    };

    if ($.isNativeInput(activeElement)) {
      this.currentInput = activeElement;

      return;
    }

    const candidateInput = resolveInput(anchorNode) ?? (activeElement instanceof HTMLElement ? resolveInput(activeElement) : undefined);

    if (candidateInput !== undefined) {
      this.currentInput = candidateInput;

      return;
    }

    if (activeElement instanceof HTMLElement && this.inputs.includes(activeElement)) {
      this.currentInput = activeElement;
    }
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
    // Check if tool supports setData method
    const toolSetData = (this.toolInstance as { setData?: (data: BlockToolData) => void | Promise<void> }).setData;

    if (typeof toolSetData === 'function') {
      try {
        await toolSetData.call(this.toolInstance, newData);
        this.lastSavedData = newData;

        return true;
      } catch (e) {
        _.log(`Tool ${this.name} setData failed: ${e instanceof Error ? e.message : String(e)}`, 'warn');

        return false;
      }
    }

    // For tools without setData, try to update innerHTML directly for simple text-based tools
    const pluginsContent = this.toolRenderedElement;

    if (!pluginsContent) {
      return false;
    }

    // Handle simple text-based blocks (like paragraph) with a 'text' property
    const hasTextProperty = 'text' in newData && typeof newData.text === 'string';
    const isContentEditable = pluginsContent.getAttribute('contenteditable') === 'true';

    if (hasTextProperty && isContentEditable) {
      pluginsContent.innerHTML = newData.text as string;
      this.lastSavedData = newData;
      this.dropInputsCache();
      this.toggleInputsEmptyMark();
      this.call(BlockToolAPI.UPDATED);

      return true;
    }

    // For other tools, fall back to full re-render
    return false;
  }

  /**
   * Call Tool instance destroy method
   */
  public destroy(): void {
    this.unwatchBlockMutations();
    this.removeInputEvents();

    /** Clean up drag and drop */
    if (this.draggableCleanup) {
      this.draggableCleanup();
      this.draggableCleanup = null;
    }
    if (this.dropTargetCleanup) {
      this.dropTargetCleanup();
      this.dropTargetCleanup = null;
    }

    super.destroy();

    if (_.isFunction(this.toolInstance.destroy)) {
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
      return isSameBlockData(item.data, blockData);
    });
  }

  /**
   * Exports Block data as string using conversion config
   */
  public async exportDataAsString(): Promise<string> {
    const blockData = await this.data;

    return convertBlockDataToString(blockData, this.tool.conversionConfig);
  }

  /**
   * Link to blok dom change callback. Used to remove listener on remove
   */
  private redactorDomChangedCallback: (payload: RedactorDomChangedPayload) => void = () => {};

  /**
   * Find and return all editable elements (contenteditable and native inputs) in the Tool HTML
   */
  public get inputs(): HTMLElement[] {
    /**
     * Return from cache if existed
     */
    if (this.cachedInputs.length !== 0) {
      return this.cachedInputs;
    }

    const inputs = $.findAllInputs(this.holder);

    /**
     * If inputs amount was changed we need to check if input index is bigger then inputs array length
     */
    if (this.inputIndex > inputs.length - 1) {
      this.inputIndex = inputs.length - 1;
    }

    /**
     * Cache inputs
     */
    this.cachedInputs = inputs;

    return inputs;
  }

  /**
   * Return current Tool`s input
   * If Block doesn't contain inputs, return undefined
   */
  public get currentInput(): HTMLElement | undefined {
    return this.inputs[this.inputIndex];
  }

  /**
   * Set input index to the passed element
   * @param element - HTML Element to set as current input
   */
  public set currentInput(element: HTMLElement | undefined) {
    if (element === undefined) {
      return;
    }

    const index = this.inputs.findIndex((input) => input === element || input.contains(element));

    if (index !== -1) {
      this.inputIndex = index;
    }
  }

  /**
   * Return first Tool`s input
   * If Block doesn't contain inputs, return undefined
   */
  public get firstInput(): HTMLElement | undefined {
    return this.inputs[0];
  }

  /**
   * Return first Tool`s input
   * If Block doesn't contain inputs, return undefined
   */
  public get lastInput(): HTMLElement | undefined {
    const inputs = this.inputs;

    return inputs[inputs.length - 1];
  }

  /**
   * Return next Tool`s input or undefined if it doesn't exist
   * If Block doesn't contain inputs, return undefined
   */
  public get nextInput(): HTMLElement | undefined {
    return this.inputs[this.inputIndex + 1];
  }

  /**
   * Return previous Tool`s input or undefined if it doesn't exist
   * If Block doesn't contain inputs, return undefined
   */
  public get previousInput(): HTMLElement | undefined {
    return this.inputs[this.inputIndex - 1];
  }

  /**
   * Get Block's JSON data
   * @returns {object}
   */
  public get data(): Promise<BlockToolData> {
    return this.save().then((savedObject) => {
      if (savedObject && !_.isEmpty(savedObject.data)) {
        return savedObject.data;
      } else {
        return {};
      }
    });
  }

  /**
   * Returns last successfully extracted block data
   */
  public get preservedData(): BlockToolData {
    return this.lastSavedData ?? {};
  }

  /**
   * Returns last successfully extracted tune data
   */
  public get preservedTunes(): { [name: string]: BlockTuneData } {
    return this.lastSavedTunes ?? {};
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
    return _.isFunction(this.toolInstance.merge);
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
    if (state) {
      this.holder.setAttribute(BLOK_SELECTED_ATTR, 'true');
    } else {
      this.holder.removeAttribute(BLOK_SELECTED_ATTR);
    }

    if (this.contentElement) {
      const stretchedClass = this.stretched ? Block.styles.contentStretched : '';

      this.contentElement.className = state
        ? twMerge(Block.styles.content, Block.styles.contentSelected)
        : twMerge(Block.styles.content, stretchedClass);
    }

    const fakeCursorWillBeAdded = state === true && SelectionUtils.isRangeInsideContainer(this.holder);
    const fakeCursorWillBeRemoved = state === false && SelectionUtils.isFakeCursorInsideContainer(this.holder);

    if (!fakeCursorWillBeAdded && !fakeCursorWillBeRemoved) {
      return;
    }

    this.blokEventBus?.emit(FakeCursorAboutToBeToggled, { state }); // mutex

    if (fakeCursorWillBeAdded) {
      SelectionUtils.addFakeCursor();
    }

    if (fakeCursorWillBeRemoved) {
      SelectionUtils.removeFakeCursor(this.holder);
    }

    this.blokEventBus?.emit(FakeCursorHaveBeenSet, { state });
  }

  /**
   * Returns True if it is Selected
   * @returns {boolean}
   */
  public get selected(): boolean {
    return this.holder.getAttribute(BLOK_SELECTED_ATTR) === 'true';
  }

  /**
   * Set stretched state
   * @param {boolean} state - 'true' to enable, 'false' to disable stretched state
   */
  public setStretchState(state: boolean): void {
    if (state) {
      this.holder.setAttribute(BLOK_STRETCHED_ATTR, 'true');
    } else {
      this.holder.removeAttribute(BLOK_STRETCHED_ATTR);
    }

    if (this.contentElement && !this.selected) {
      this.contentElement.className = state
        ? twMerge(Block.styles.content, Block.styles.contentStretched)
        : Block.styles.content;
    }
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
    return this.holder.getAttribute(BLOK_STRETCHED_ATTR) === 'true';
  }


  /**
   * Returns Plugins content
   * @returns {HTMLElement}
   */
  public get pluginsContent(): HTMLElement {
    if (this.toolRenderedElement === null) {
      throw new Error('Block pluginsContent is not yet initialized');
    }

    return this.toolRenderedElement;
  }

  /**
   * Make default Block wrappers and put Tool`s content there
   * @returns {HTMLDivElement}
   */
  private compose(): HTMLDivElement {
    const wrapper = $.make('div', Block.styles.wrapper) as HTMLDivElement;
    const contentNode = $.make('div', Block.styles.content);

    this.contentElement = contentNode;

    // Set data attributes for block element and content
    wrapper.setAttribute(BLOK_ELEMENT_ATTR, '');
    contentNode.setAttribute(BLOK_ELEMENT_CONTENT_ATTR, '');
    contentNode.setAttribute('data-blok-testid', 'block-content');
    const pluginsContent = this.toolInstance.render();

    wrapper.setAttribute('data-blok-testid', 'block-wrapper');

    if (this.name && !wrapper.hasAttribute('data-blok-component')) {
      wrapper.setAttribute('data-blok-component', this.name);
    }

    /**
     * Export id to the DOM three
     * Useful for standalone modules development. For example, allows to identify Block by some child node. Or scroll to a particular Block by id.
     */
    wrapper.setAttribute('data-blok-id', this.id);

    /**
     * Saving a reference to plugin's content element for guaranteed accessing it later
     * Handle both synchronous HTMLElement and Promise<HTMLElement> cases
     */
    if (pluginsContent instanceof Promise) {
      // Handle async render: resolve the promise and update DOM when ready
      pluginsContent.then((resolvedElement) => {
        this.toolRenderedElement = resolvedElement;
        this.addToolDataAttributes(resolvedElement, wrapper);
        contentNode.appendChild(resolvedElement);
        this.readyResolver?.();
      }).catch((error) => {
        _.log(`Tool render promise rejected: %o`, 'error', error);
        this.readyResolver?.();
      });
    } else {
      // Handle synchronous render
      this.toolRenderedElement = pluginsContent;
      this.addToolDataAttributes(pluginsContent, wrapper);
      contentNode.appendChild(pluginsContent);
      this.readyResolver?.();
    }

    /**
     * Block Tunes might wrap Block's content node to provide any UI changes
     *
     * <tune2wrapper>
     *   <tune1wrapper>
     *     <blockContent />
     *   </tune1wrapper>
     * </tune2wrapper>
     */
    const wrappedContentNode: HTMLElement = [...this.tunesInstances.values(), ...this.defaultTunesInstances.values()]
      .reduce((acc, tune) => {
        if (_.isFunction(tune.wrap)) {
          try {
            return tune.wrap(acc);
          } catch (e) {
            _.log(`Tune ${tune.constructor.name} wrap method throws an Error %o`, 'warn', e);

            return acc;
          }
        }

        return acc;
      }, contentNode);

    wrapper.appendChild(wrappedContentNode);

    return wrapper;
  }

  /**
   * Add data attributes to tool-rendered element based on tool name
   * @param element - The tool-rendered element
   * @param blockWrapper - Block wrapper that hosts the tool render
   * @private
   */
  private addToolDataAttributes(element: HTMLElement, blockWrapper: HTMLDivElement): void {
    /**
     * Add data-blok-component attribute to identify the tool type used for the block.
     * Some tools (like Paragraph) add their own class names, but we can rely on the tool name for all cases.
     */
    if (this.name && !blockWrapper.hasAttribute('data-blok-component')) {
      blockWrapper.setAttribute('data-blok-component', this.name);
    }

    const placeholderAttribute = 'data-blok-placeholder';
    const placeholder = this.config?.placeholder;
    const placeholderText = typeof placeholder === 'string' ? placeholder.trim() : '';

    /**
     * Paragraph tool handles its own placeholder via data-blok-placeholder-active attribute
     * with focus-only classes, so we skip the block-level placeholder for it.
     */
    if (this.name === 'paragraph') {
      return;
    }

    /**
     * Placeholder styling classes using Tailwind arbitrary variants.
     * Applied to ::before pseudo-element only when element is empty.
     * Uses arbitrary properties for `content: attr(data-blok-placeholder)`.
     */
    const placeholderClasses = [
      'empty:before:pointer-events-none',
      'empty:before:text-gray-text',
      'empty:before:cursor-text',
      'empty:before:content-[attr(data-blok-placeholder)]',
      '[&[data-blok-empty=true]]:before:pointer-events-none',
      '[&[data-blok-empty=true]]:before:text-gray-text',
      '[&[data-blok-empty=true]]:before:cursor-text',
      '[&[data-blok-empty=true]]:before:content-[attr(data-blok-placeholder)]',
    ];

    if (placeholderText.length > 0) {
      element.setAttribute(placeholderAttribute, placeholderText);
      element.classList.add(...placeholderClasses);

      return;
    }

    if (placeholder === false && element.hasAttribute(placeholderAttribute)) {
      element.removeAttribute(placeholderAttribute);
    }
  }

  /**
   * Instantiate Block Tunes
   * @param tunesData - current Block tunes data
   * @private
   */
  private composeTunes(tunesData: { [name: string]: BlockTuneData }): void {
    Array.from(this.tunes.values()).forEach((tune) => {
      const collection = tune.isInternal ? this.defaultTunesInstances : this.tunesInstances;

      collection.set(tune.name, tune.create(tunesData[tune.name], this.blockAPI));
    });

    /**
     * Check if there is some data for not available tunes
     */
    Object.entries(tunesData).forEach(([name, data]) => {
      if (!this.tunesInstances.has(name)) {
        this.unavailableTunesData[name] = data;
      }
    });
  }

  /**
   * Is fired when text input or contentEditable is focused
   */
  private handleFocus = (): void => {
    /**
     * Drop inputs cache to query the new ones
     */
    this.dropInputsCache();

    /**
     * Update current input
     */
    this.updateCurrentInput();
  };

  /**
   * Adds focus event listeners to all inputs and contenteditable
   */
  private addInputEvents(): void {
    this.inputs.forEach(input => {
      input.addEventListener('focus', this.handleFocus);

      /**
       * If input is native input add oninput listener to observe changes
       */
      if ($.isNativeInput(input)) {
        input.addEventListener('input', this.didMutated as EventListener);
      }
    });
  }

  /**
   * removes focus event listeners from all inputs and contenteditable
   */
  private removeInputEvents(): void {
    this.inputs.forEach(input => {
      input.removeEventListener('focus', this.handleFocus);

      if ($.isNativeInput(input)) {
        input.removeEventListener('input', this.didMutated as EventListener);
      }
    });
  }

  /**
   * Is fired when DOM mutation has been happened
   * @param mutationsOrInputEvent - actual changes
   *   - MutationRecord[] - any DOM change
   *   - InputEvent — <input> change
   *   - undefined — manual triggering of block.dispatchChange()
   */
  private readonly didMutated = (mutationsOrInputEvent: MutationRecord[] | InputEvent | undefined = undefined): void => {
    /**
     * Block API have dispatchChange() method. In this case, mutations list will be undefined.
     */
    const isManuallyDispatched = mutationsOrInputEvent === undefined;

    /**
     * True if didMutated has been called as "input" event handler
     */
    const isInputEventHandler = mutationsOrInputEvent instanceof InputEvent;

    /**
     * If tool updates its own root element, we need to renew it in our memory
     */
    if (!isManuallyDispatched && !isInputEventHandler) {
      this.detectToolRootChange(mutationsOrInputEvent);
    }

    /**
     * We won't fire a Block mutation event if mutation contain only nodes marked with 'data-blok-mutation-free' attributes
     */
    const shouldFireUpdate = (() => {
      if (isManuallyDispatched || isInputEventHandler) {
        return true;
      }

      /**
       * Update from 2023, Feb 17:
       *    Changed mutationsOrInputEvent.some() to mutationsOrInputEvent.every()
       *    since there could be a real mutations same-time with mutation-free changes,
       *    for example when Block Tune change: block is changing along with FakeCursor (mutation-free) removing
       *    — we should fire 'didMutated' event in that case
       */
      const everyRecordIsMutationFree = mutationsOrInputEvent.length > 0 && mutationsOrInputEvent.every((record) => {
        const { addedNodes, removedNodes, target } = record;
        const changedNodes = [
          ...Array.from(addedNodes),
          ...Array.from(removedNodes),
          target,
        ];

        return changedNodes.every((node) => {
          const elementToCheck: Element | null = !$.isElement(node)
            ? node.parentElement ?? null
            : node;

          if (elementToCheck === null) {
            return false;
          }

          return elementToCheck.closest('[data-blok-mutation-free="true"]') !== null;
        });
      });

      return !everyRecordIsMutationFree;
    })();

    /**
     * In case some mutation free elements are added or removed, do not trigger didMutated event
     */
    if (!shouldFireUpdate) {
      return;
    }

    this.dropInputsCache();

    /**
     * Update current input
     */
    this.updateCurrentInput();

    /**
     * We mark inputs with 'data-blok-empty' attribute, so new inputs should be marked as well
     */
    this.toggleInputsEmptyMark();

    this.call(BlockToolAPI.UPDATED);

    /**
     * Emit a Block Event with current Block instance.
     * Block Manager subscribed to these events
     */
    this.emit('didMutated', this);
  };

  /**
   * Listen common blok Dom Changed event and detect mutations related to the  Block
   */
  private watchBlockMutations(): void {
    /**
     * Save callback to a property to remove it on Block destroy
     * @param payload - event payload
     */
    this.redactorDomChangedCallback = (payload) => {
      const { mutations } = payload;

      const toolElement = this.toolRenderedElement;

      if (toolElement === null) {
        return;
      }

      /**
       * Filter mutations to only include those that belong to this block.
       * Previously, all mutations were passed when any belonged to the block,
       * which could include mutations from other parts of the blok.
       */
      const blockMutations = mutations.filter(record => isMutationBelongsToElement(record, toolElement));

      if (blockMutations.length > 0) {
        this.didMutated(blockMutations);
      }
    };

    this.blokEventBus?.on(RedactorDomChanged, this.redactorDomChangedCallback);
  }

  /**
   * Remove redactor dom change event listener
   */
  private unwatchBlockMutations(): void {
    this.blokEventBus?.off(RedactorDomChanged, this.redactorDomChangedCallback);
  }

  /**
   * Refreshes the reference to the tool's root element by inspecting the block content.
   * Call this after operations (like onPaste) that might cause the tool to replace its element,
   * especially when mutation observers haven't been set up yet.
   */
  public refreshToolRootElement(): void {
    const contentNode = this.holder.querySelector(BLOK_ELEMENT_CONTENT_SELECTOR);

    if (!contentNode) {
      return;
    }

    const firstChild = contentNode.firstElementChild as HTMLElement | null;

    if (firstChild && firstChild !== this.toolRenderedElement) {
      this.toolRenderedElement = firstChild;
      this.dropInputsCache();
    }
  }

  /**
   * Sometimes Tool can replace own main element, for example H2 -> H4 or UL -> OL
   * We need to detect such changes and update a link to tools main element with the new one
   * @param mutations - records of block content mutations
   */
  private detectToolRootChange(mutations: MutationRecord[]): void {
    const toolElement = this.toolRenderedElement;

    if (toolElement === null) {
      return;
    }

    mutations.forEach(record => {
      const toolRootHasBeenUpdated = Array.from(record.removedNodes).includes(toolElement);

      if (toolRootHasBeenUpdated) {
        const newToolElement = record.addedNodes[record.addedNodes.length - 1];

        this.toolRenderedElement = newToolElement as HTMLElement;
      }
    });
  }

  /**
   * Clears inputs cached value
   */
  private dropInputsCache(): void {
    this.cachedInputs = [];
  }

  /**
   * Mark inputs with 'data-blok-empty' attribute with the empty state
   */
  private toggleInputsEmptyMark(): void {
    this.inputs.forEach(toggleEmptyMark);
  }
}
