import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { ModuleConfig } from '../../../../types-internal/module-config';
import type { EventsDispatcher } from '../../../utils/events';
import type { BlokEventMap } from '../../../events';
import { Listeners } from '../../../utils/listeners';

/**
 * Base class for all UI controllers.
 * Provides common functionality for binding/unbinding event listeners.
 */
export abstract class Controller {
  /**
   * Blok modules list
   */
  protected Blok: BlokModules;

  /**
   * Blok configuration object
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
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    this.config = config;
    this.eventsDispatcher = eventsDispatcher;
    // Blok is initialized via the state setter after construction
    this.Blok = {} as BlokModules;
  }

  /**
   * Blok modules setter
   */
  public set state(Blok: BlokModules) {
    this.Blok = Blok;
  }

  /**
   * Enable the controller by binding all event listeners
   * Subclasses should override this method to bind their specific listeners
   */
  public enable(): void {
    // Subclasses implement
  }

  /**
   * Disable the controller by unbinding all event listeners
   */
  public disable(): void {
    this.listeners.removeAll();
    this.readOnlyMutableListeners.clearAll();
  }
}
