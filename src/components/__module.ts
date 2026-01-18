import type { BlokConfig } from '../../types';
import type { BlokModules } from '../types-internal/blok-modules';
import type { ModuleConfig } from '../types-internal/module-config';

import type { BlokEventMap } from './events';
import type { EventsDispatcher } from './utils/events';
import { Listeners } from './utils/listeners';

/**
 * The type <T> of the Module generic.
 * It describes the structure of nodes used in modules.
 */
export type ModuleNodes = Record<string, unknown>;

/**
 * @abstract
 * @class      Module
 * @classdesc  All modules inherits from this class.
 * @typedef {Module} Module
 * @property {object} config - Blok user settings
 * @property {BlokModules} Blok - List of Blok modules
 */
export class Module<T extends ModuleNodes = Record<string, HTMLElement>> {
  /**
   * Each module can provide some UI elements that will be stored in this property
   */

  public nodes: T = {} as T;

  /**
   * Blok modules list
   * @type {BlokModules}
   */
  protected Blok: BlokModules;

  /**
   * Blok configuration object
   * @type {BlokConfig}
   */
  protected config: BlokConfig;

  /**
   * Blok event dispatcher class
   */
  protected eventsDispatcher: EventsDispatcher<BlokEventMap>;

  /**
   * Util for bind/unbind DOM event listeners
   */
  protected listeners: Listeners = new Listeners();

  /**
   * This object provides methods to push into set of listeners that being dropped when read-only mode is enabled
   */
  protected readOnlyMutableListeners = {
    /**
     * Assigns event listener on DOM element and pushes into special array that might be removed
     * @param {EventTarget} element - DOM Element
     * @param {string} eventType - Event name
     * @param {Function} handler - Event handler
     * @param {boolean|AddEventListenerOptions} options - Listening options
     */
    on: (
      element: EventTarget,
      eventType: string,
      handler: (event: Event) => void,
      options: boolean | AddEventListenerOptions = false
    ): void => {
      const listenerId = this.listeners.on(element, eventType, handler, options);

      if (listenerId) {
        this.mutableListenerIds.push(listenerId);
      }
    },

    /**
     * Clears all mutable listeners
     */
    clearAll: (): void => {
      for (const id of this.mutableListenerIds) {
        this.listeners.offById(id);
      }

      this.mutableListenerIds = [];
    },
  };

  /**
   * The set of listener identifiers which will be dropped in read-only mode
   */
  private mutableListenerIds: string[] = [];

  /**
   * @class
   * @param options - Module options
   * @param options.config - Module config
   * @param options.eventsDispatcher - Common event bus
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    if (new.target === Module) {
      throw new TypeError('Constructors for abstract class Module are not allowed.');
    }

    this.config = config;
    this.eventsDispatcher = eventsDispatcher;
    // Blok is initialized via the state setter after construction
    this.Blok = {} as BlokModules;
  }

  /**
   * Blok modules setter
   * @param {BlokModules} Blok - Blok's Modules
   */
  public set state(Blok: BlokModules) {
    this.Blok = Blok;
  }

  /**
   * Remove memorized nodes
   */
  public removeAllNodes(): void {
    for (const key in this.nodes) {
      const node = this.nodes[key];

      if (node instanceof HTMLElement) {
        node.remove();
      }
    }
  }

  /**
   * Returns true if current direction is RTL (Right-To-Left).
   *
   * This reads from config.i18n.direction which is set by the I18n module during prepare().
   * Should only be accessed after modules have been initialized.
   */
  protected get isRtl(): boolean {
    return this.config.i18n?.direction === 'rtl';
  }
}
