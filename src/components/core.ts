import type { BlokConfig } from '../../types';
import type { BlokModules } from '../types-internal/blok-modules';

import { Dom as $ } from './dom';
import { CriticalError } from './errors/critical';
import type { BlokEventMap } from './events';
import { Modules } from './modules';
import type { Renderer } from './modules/renderer';
import { LogLevels, isEmpty, isFunction, isObject, isString, log, setLogLevel } from './utils';
import { EventsDispatcher } from './utils/events';

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

          if ((this.configuration).autofocus === true && this.configuration.readOnly !== true) {
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
        holder: config,
      };
    }

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
    this.config.tools = this.config.tools || {};
    this.config.i18n = this.config.i18n || {};
    this.config.data = this.config.data || { blocks: [] };

    this.config.onReady = this.config.onReady || ((): void => {});

    this.config.onChange = this.config.onChange || ((): void => {});
    this.config.inlineToolbar = this.config.inlineToolbar !== undefined ? this.config.inlineToolbar : true;

    /**
     * Initialize default Block to pass data to the Renderer
     */
    if (isEmpty(this.config.data) || this.config.data.blocks.length === 0) {
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

    return renderer.render(this.config.data.blocks);
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
