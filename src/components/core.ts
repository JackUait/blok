import type { BlokConfig, OutputData } from '../../types';
import type { PersistedDocument } from '../../types/configs/blok-config';
import type { BlokModules } from '../types-internal/blok-modules';

import { Dom as $ } from './dom';
import { CriticalError } from './errors/critical';
import type { BlokEventMap } from './events';
import { Modules } from './modules';
import type { Collaboration } from './modules/collaboration';
import type { Renderer } from './modules/renderer';
import { LogLevels, isEmpty, isFunction, isObject, isString, log, setLogLevel } from './utils';
import { cloneOutputBlocks } from './utils/clone-output-blocks';
import { expandPersistenceConfig, unwrapPersistedDocument } from './utils/persistence';
import { expandServerConfig } from './utils/server-config';
import { normalizeOutputBlocks } from '../shared/output-data';
import { EventsDispatcher } from './utils/events';

/**
 * A collaboration `doc` becomes one path segment of the sync URL, so it must be
 * a single segment: not empty, no `/` (raw or `%2f`/`%2F`), and not a `.`/`..`
 * dot segment — any of which would retarget the request at another document or
 * the whole collection. Mirrors the server's `IsSingleSegment` guard. Accepts
 * `unknown` so a JS consumer dropping `doc` is refused, not a crash.
 * @param doc - the configured document id
 */
const isSingleDocSegment = (doc: unknown): boolean =>
  typeof doc === 'string' &&
  doc.length > 0 &&
  !doc.includes('/') &&
  !doc.toLowerCase().includes('%2f') &&
  doc !== '.' &&
  doc !== '..';

/**
 * Blok core class. Bootstraps modules.
 */
export class Core {
  /**
   * Blok configuration passed by user to the constructor
   */
  public config: BlokConfig;

  /**
   * Object with core modules instances
   */
  public moduleInstances: BlokModules = {} as BlokModules;

  /**
   * Promise that resolves when all core modules are prepared and UI is rendered on the page
   */
  public isReady: Promise<void>;

  /**
   * Common Blok Event Bus
   */
  private eventsDispatcher: EventsDispatcher<BlokEventMap> = new EventsDispatcher();

  /**
   * @param {BlokConfig} config - user configuration
   */
  constructor(config?: BlokConfig|string) {
    /**
     * Ready promise. Resolved if Blok is ready to work, rejected otherwise
     */
    // Initialize config to satisfy TypeScript's definite assignment check
    // The setter will properly assign and process the config
    this.config = {};

    this.isReady = new Promise((resolve, reject) => {
      Promise.resolve()
        .then(async () => {
          this.configuration = config;
          this.validate();
          this.init();
          await this.start();
          await this.render();

          const { BlockManager, Caret, UI, ModificationsObserver } = this.moduleInstances;

          UI.checkEmptiness();
          ModificationsObserver.enable();

          /**
           * A collaboration session is still empty at this point — its blocks
           * arrive with the first sync — so there is nothing to focus yet.
           */
          if (
            (this.configuration).autofocus === true &&
            this.configuration.readOnly !== true &&
            BlockManager.blocks.length > 0
          ) {
            Caret.setToBlock(BlockManager.blocks[0], Caret.positions.START);
          }

          resolve();
        })
        .catch((error) => {
          log(`Blok is not ready because of ${error}`, 'error');

          /**
           * Reject this.isReady promise
           */
          reject(error);
        });
    });
  }

  /**
   * Setting for configuration
   * @param {BlokConfig|string|undefined} config - Blok's config to set
   */
  /**
   * One-shot document load, consumed by the first render. Null once used, so a
   * re-render never re-fetches. Resolves with either shape a store may answer
   * with — the envelope is unwrapped where it is awaited.
   */
  private pendingPersistedLoad: (() => Promise<OutputData | PersistedDocument | null>) | null = null;

  public set configuration(config: BlokConfig|string|undefined) {
    /**
     * Place config into the class property
     * @type {BlokConfig}
     */
    if (isObject(config)) {
      this.config = {
        ...config,
      };
    } else {
      /**
       * Process zero-configuration or with only holder
       * Make config object
       */
      this.config = {
        holder: config as string | undefined,
      };
    }

    /**
     * Refuse a broken `collaboration` config here, before any expansion runs,
     * so a refused config never builds a persistence save queue it will not use.
     */
    this.validateCollaborationConfig();

    /**
     * `server` is sugar over options that already exist. Expanding it here —
     * before validate() and before any module reads the config — is what keeps
     * the rest of the editor from ever learning the key.
     */
    this.config = expandServerConfig(this.config);

    this.config = expandPersistenceConfig(this.config);

    /**
     * Read BEFORE `data` is defaulted below — after that every config has data
     * and "the host supplied none" is no longer answerable. Loading over data
     * the host passed would discard it, so persistence only fills a gap.
     *
     * Bound from the EXPANDED config: the expansion wraps `load` to record the
     * document version the next save has to report back.
     */
    const persistence = this.config.persistence;

    this.pendingPersistedLoad = persistence !== undefined && this.config.data == null
      ? persistence.load.bind(persistence)
      : null;

    /**
     * If holder is empty then set a default value
     */
    if (this.config.holder == null) {
      this.config.holder = 'blok';
    }

    if (this.config.logLevel == null) {
      this.config.logLevel = LogLevels.VERBOSE;
    }

    setLogLevel(this.config.logLevel);

    /**
     * If default Block's Tool was not passed, use the Paragraph Tool
     */
    this.config.defaultBlock = this.config.defaultBlock ?? 'paragraph';

    const toolsConfig = this.config.tools;
    const defaultBlockName = this.config.defaultBlock;
    const hasDefaultBlockTool = toolsConfig != null &&
      Object.prototype.hasOwnProperty.call(toolsConfig, defaultBlockName);
    const initialBlocks = this.config.data?.blocks;
    const hasInitialBlocks = Array.isArray(initialBlocks) && initialBlocks.length > 0;

    if (
      defaultBlockName &&
      defaultBlockName !== 'paragraph' &&
      !hasDefaultBlockTool &&
      !hasInitialBlocks
    ) {
      log(
        `Default block "${defaultBlockName}" is not configured. Falling back to "paragraph" tool.`,
        'warn'
      );

      this.config.defaultBlock = 'paragraph';

      const existingTools = this.config.tools as Record<string, unknown> | undefined;
      const updatedTools: Record<string, unknown> = {
        ...(existingTools ?? {}),
      };
      const paragraphEntry = updatedTools.paragraph;

      updatedTools.paragraph = this.createParagraphToolConfig(paragraphEntry);

      this.config.tools = updatedTools as BlokConfig['tools'];
    }

    /**
     * Height of Blok's bottom area that allows to set focus on the last Block
     * @type {number}
     */

    this.config.minHeight = this.config.minHeight !== undefined ? this.config.minHeight : 300;

    /**
     * Default block type
     * Uses in case when there is no blocks passed
     * @type {{type: (*), data: {text: null}}}
     */
    const defaultBlockData = {
      type: this.config.defaultBlock,
      data: {},
    };

    if (this.config.placeholder === undefined) {
      this.config.placeholder = false;
    }
    this.config.sanitizer = this.config.sanitizer ?? {};

    this.config.hideToolbar = this.config.hideToolbar ?? false;
    this.config.toolbarPosition = this.config.toolbarPosition ?? 'left';
    this.config.tools = this.config.tools || {};
    this.config.i18n = this.config.i18n || {};
    this.config.data = this.config.data || { blocks: [] };

    /**
     * The caller owns `config.data` (often frozen store state): deep-clone it
     * at this boundary so the editor never mutates or retains their objects.
     */
    if (Array.isArray(this.config.data.blocks)) {
      this.config.data = {
        ...this.config.data,
        // Normalize the loose wire shape (null data/ids) into the strict
        // saved shape before cloning.
        blocks: cloneOutputBlocks(normalizeOutputBlocks(this.config.data.blocks)),
      };
    }

    this.config.onReady = this.config.onReady || ((): void => {});

    /**
     * `onChange` is deliberately NOT defaulted to a no-op.
     *
     * Its PRESENCE (together with `onSave`'s) is the arming signal for the whole
     * change-observation pipeline — `ModificationsObserver.particularBlockChanged`
     * bails when neither is a function, and all three framework adapters omit the
     * key entirely when their host passes no handler so an unobserved editor stays
     * disarmed. Injecting a no-op here satisfied that gate for EVERY editor, which
     * made the gate dead code and the published `BlokConfig.onChange` contract a
     * lie — and pushed hosts into passing an always-truthy dummy handler (often an
     * `onSave` one, which additionally forces a full document serialization per
     * change batch) to "arm the pipeline" it was already arming for them.
     *
     * Every read of `config.onChange` is `isFunction`-guarded, so leaving it
     * undefined is safe.
     */
    this.config.inlineToolbar = this.config.inlineToolbar !== undefined ? this.config.inlineToolbar : true;

    /**
     * Initialize default Block to pass data to the Renderer.
     *
     * NOT under collaboration: the document arrives from the sync service, and
     * a default block injected here would be rendered as "last known" on the
     * offline degrade path — a phantom paragraph the server never had.
     */
    if (
      this.config.collaboration === undefined &&
      (isEmpty(this.config.data) || this.config.data.blocks.length === 0)
    ) {
      this.config.data = { blocks: [ defaultBlockData ] };
    }

    this.config.readOnly = this.config.readOnly ?? false;
  }

  /**
   * Returns private property
   * @returns {BlokConfig}
   */
  public get configuration(): BlokConfig {
    return this.config;
  }

  /**
   * Refuse a misconfigured `collaboration` block: the sync service owns the
   * document round-trip, so it cannot be paired with a persistence endpoint; it
   * derives the sync URL from `server`; and its `doc` becomes one path segment
   * of that URL. Refuse-don't-warn — throwing rejects the ready promise.
   */
  private validateCollaborationConfig(): void {
    const { collaboration } = this.config;

    if (collaboration === undefined) {
      return;
    }

    if (this.config.persistence !== undefined) {
      throw new Error('collaboration and persistence cannot be combined: the sync service owns the document round-trip');
    }

    if (this.config.server === undefined) {
      throw new Error('collaboration requires the server option');
    }

    if (!isSingleDocSegment(collaboration.doc)) {
      throw new Error('collaboration.doc must be a single path segment');
    }
  }

  /**
   * Checks for required fields in Blok's config
   */
  public validate(): void {
    const { holder } = this.config;

    /**
     * Check for a holder element's existence
     */
    if (isString(holder) && !$.get(holder)) {
      throw Error(`element with ID «${holder}» is missing. Pass correct holder's ID.`);
    }

    if (Boolean(holder) && isObject(holder) && !$.isElement(holder)) {
      throw Error('«holder» value must be an Element node');
    }
  }

  /**
   * Initializes modules:
   *  - make and save instances
   *  - configure
   */
  public init(): void {
    /**
     * Make modules instances and save it to the @property this.moduleInstances
     */
    this.constructModules();

    /**
     * Modules configuration
     */
    this.configureModules();
  }

  /**
   * Start Blok!
   *
   * Get list of modules that needs to be prepared and return a sequence (Promise)
   * @returns {Promise<void>}
   */
  public async start(): Promise<void> {
    const modulesToPrepare = [
      'I18n',
      'Tools',
      'UI',
      'BlockManager',
      'Paste',
      'BlockSelection',
      'RectangleSelection',
      'CrossBlockSelection',
      'ReadOnly',
      'ThemeManager',
    ];

    await modulesToPrepare.reduce(
      (promise, module) => promise.then(async () => {
        // log(`Preparing ${module} module`, 'time');

        try {
          const moduleInstance = this.moduleInstances[module as keyof BlokModules] as { prepare: () => Promise<void> | void };

          await moduleInstance.prepare();
        } catch (e) {
          /**
           * CriticalError's will not be caught
           * It is used when Blok is rendering in read-only mode with unsupported plugin
           */
          if (e instanceof CriticalError) {
            throw new Error(e.message);
          }
          log(`Module ${module} was skipped because of %o`, 'warn', e);
        }
        // log(`Preparing ${module} module`, 'timeEnd');
      }),
      Promise.resolve()
    );
  }

  /**
   * Render initial data
   */
  private render(): Promise<void> {
    const renderer = this.moduleInstances['Renderer' as keyof BlokModules] as Renderer | undefined;

    if (!renderer) {
      throw new CriticalError('Renderer module is not initialized');
    }

    if (!this.config.data) {
      throw new CriticalError('Blok data is not initialized');
    }

    const data = this.config.data;
    const load = this.pendingPersistedLoad;

    this.pendingPersistedLoad = null;

    const collaboration = this.moduleInstances['Collaboration' as keyof BlokModules] as Collaboration | undefined;

    /**
     * Sync-first load: the sync service owns the document, so NOTHING is seeded
     * here — not the Yjs document from `config.data`, not a default block. The
     * editor comes up empty and read-only, and the blocks materialise through
     * the ordinary remote path when the first sync lands. `config.data` is
     * handed over as last-known, for the read-only degrade while offline.
     *
     * `pendingPersistedLoad` is always null here: the config setter refuses
     * collaboration combined with persistence.
     */
    if (collaboration?.isEnabled === true) {
      return collaboration.load(normalizeOutputBlocks(data.blocks));
    }

    // Idempotent re-normalization: `config.data` is declared with the loose
    // wire type, but prepare() already normalized it — this narrows the type
    // without a cast.
    if (load === null) {
      return renderer.render(normalizeOutputBlocks(data.blocks));
    }

    return load().then((result) => {
      const loaded = unwrapPersistedDocument(result);
      const blocks = loaded?.blocks;

      if (blocks !== undefined && blocks.length > 0) {
        this.config.data = { ...loaded, blocks: cloneOutputBlocks(normalizeOutputBlocks(blocks)) };

        return renderer.render(normalizeOutputBlocks(blocks));
      }

      return renderer.render(normalizeOutputBlocks(data.blocks));
    });
  }

  /**
   * Make modules instances and save it to the @property this.moduleInstances
   */
  private constructModules(): void {
    Object.entries(Modules).forEach(([key, module]) => {
      try {
        (this.moduleInstances as unknown as Record<string, BlokModules[keyof BlokModules]>)[key] = new module({
          config: this.configuration,
          eventsDispatcher: this.eventsDispatcher,
        });
      } catch (e) {
        log(`[constructModules] Module ${key} skipped because`, 'error', e);
      }
    });
  }

  /**
   * Modules instances configuration:
   *  - pass other modules to the 'state' property
   *  - ...
   */
  private configureModules(): void {
    for (const name in this.moduleInstances) {
      if (Object.prototype.hasOwnProperty.call(this.moduleInstances, name)) {
        /**
         * Module does not need self-instance
         */
        this.moduleInstances[name as keyof BlokModules].state = this.getModulesDiff(name);
      }
    }
  }

  /**
   * Creates paragraph tool configuration with preserveBlank setting
   * @param {unknown} paragraphEntry - existing paragraph entry from tools config
   * @returns {Record<string, unknown>} paragraph tool configuration
   */
  private createParagraphToolConfig(paragraphEntry: unknown): Record<string, unknown> {
    if (paragraphEntry === undefined) {
      return {
        config: {
          preserveBlank: true,
        },
      };
    }

    if (isFunction(paragraphEntry)) {
      return {
        class: paragraphEntry,
        config: {
          preserveBlank: true,
        },
      };
    }

    if (isObject(paragraphEntry)) {
      const paragraphSettings = paragraphEntry;
      const existingConfig = paragraphSettings.config;

      return {
        ...paragraphSettings,
        config: {
          ...(isObject(existingConfig) ? existingConfig : {}),
          preserveBlank: true,
        },
      };
    }

    return {
      config: {
        preserveBlank: true,
      },
    };
  }

  /**
   * Return modules without passed name
   * @param {string} name - module for witch modules difference should be calculated
   */
  private getModulesDiff(name: string): BlokModules {
    const diff = {} as BlokModules;

    for (const moduleName in this.moduleInstances) {
      /**
       * Skip module with passed name
       */
      if (moduleName === name) {
        continue;
      }
      (diff as unknown as Record<string, BlokModules[keyof BlokModules]>)[moduleName] = this.moduleInstances[moduleName as keyof BlokModules];
    }

    return diff;
  }
}
