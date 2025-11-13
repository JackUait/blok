import * as _ from '../utils';

/**
 * Event listener information
 *
 * @interface ListenerData
 */
export interface ListenerData {
  /**
   * Listener unique identifier
   */
  id: string;

  /**
   * Element where to listen to dispatched events
   */
  element: EventTarget;

  /**
   * Event to listen
   */
  eventType: string;

  /**
   * Event handler
   *
   * @param {Event} event - event object
   */
  handler: (event: Event) => void;

  /**
   * @see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
   */
  options: boolean | AddEventListenerOptions;
}

interface NormalizedListenerOptions {
  capture: boolean;
  once: boolean;
  passive: boolean;
  signal?: AbortSignal | null;
}

/**
 * Editor.js Listeners helper
 *
 * Decorator for event listeners assignment
 *
 * @author Codex Team
 * @version 2.0.0
 */

/**
 * @typedef {Listeners} Listeners
 * @property {ListenerData[]} allListeners - listeners store
 */
export default class Listeners {
  /**
   * Stores all listeners data to find/remove/process it
   *
   * @type {ListenerData[]}
   */
  private allListeners: ListenerData[] = [];

  /**
   * Assigns event listener on element and returns unique identifier
   *
   * @param {EventTarget} element - DOM element that needs to be listened
   * @param {string} eventType - event type
   * @param {Function} handler - method that will be fired on event
   * @param {boolean|AddEventListenerOptions} options - useCapture or {capture, passive, once}
   */
  public on(
    element: EventTarget,
    eventType: string,
    handler: (event: Event) => void,
    options: boolean | AddEventListenerOptions = false
  ): string | undefined {
    const alreadyExist = this.findOne(element, eventType, handler, options);

    if (alreadyExist) {
      return undefined;
    }

    const id = _.generateId('l');
    const assignedEventData: ListenerData = {
      id,
      element,
      eventType,
      handler,
      options,
    };

    this.allListeners.push(assignedEventData);
    element.addEventListener(eventType, handler, options);

    return id;
  }

  /**
   * Removes event listener from element
   *
   * @param {EventTarget} element - DOM element that we removing listener
   * @param {string} eventType - event type
   * @param {Function} handler - remove handler, if element listens several handlers on the same event type
   * @param {boolean|AddEventListenerOptions} options - useCapture or {capture, passive, once}
   */
  public off(
    element: EventTarget,
    eventType: string,
    handler?: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): void {
    const existingListeners = this.findAll(element, eventType, handler, options);

    existingListeners.forEach((listener, i) => {
      const index = this.allListeners.indexOf(existingListeners[i]);

      if (index > -1) {
        this.allListeners.splice(index, 1);

        listener.element.removeEventListener(listener.eventType, listener.handler, listener.options);
      }
    });
  }

  /**
   * Removes listener by id
   *
   * @param {string} id - listener identifier
   */
  public offById(id: string): void {
    const listener = this.findById(id);

    if (!listener) {
      return;
    }

    listener.element.removeEventListener(listener.eventType, listener.handler, listener.options);
    const index = this.allListeners.indexOf(listener);

    if (index > -1) {
      this.allListeners.splice(index, 1);
    }
  }

  /**
   * Finds and returns first listener by passed params
   *
   * @param {EventTarget} element - event target
   * @param {string} [eventType] - event type
   * @param {Function} [handler] - event handler
   * @param {boolean|AddEventListenerOptions} [options] - event options
   * @returns {ListenerData|null}
   */
  public findOne(
    element: EventTarget,
    eventType?: string,
    handler?: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): ListenerData | null {
    const foundListeners = this.findAll(element, eventType, handler, options);

    return foundListeners[0] ?? null;
  }

  /**
   * Return all stored listeners by passed params
   *
   * @param {EventTarget} element - event target
   * @param {string} eventType - event type
   * @param {Function} handler - event handler
   * @param {boolean|AddEventListenerOptions} [options] - event options
   * @returns {ListenerData[]}
   */
  public findAll(
    element: EventTarget,
    eventType?: string,
    handler?: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): ListenerData[] {
    if (!element) {
      return [];
    }

    const foundByEventTargets = this.findByEventTarget(element);

    return foundByEventTargets.filter((listener) => {
      const matchesEventType = eventType === undefined || listener.eventType === eventType;
      const matchesHandler = handler === undefined || listener.handler === handler;
      const matchesOptions = this.areOptionsEqual(listener.options, options);

      return matchesEventType && matchesHandler && matchesOptions;
    });
  }

  /**
   * Removes all listeners
   */
  public removeAll(): void {
    this.allListeners.forEach((current) => {
      current.element.removeEventListener(current.eventType, current.handler, current.options);
    });

    this.allListeners = [];
  }

  /**
   * Module cleanup on destruction
   */
  public destroy(): void {
    this.removeAll();
  }

  /**
   * Search method: looks for listener by passed element
   *
   * @param {EventTarget} element - searching element
   * @returns {Array} listeners that found on element
   */
  private findByEventTarget(element: EventTarget): ListenerData[] {
    return this.allListeners.filter((listener) => listener.element === element);
  }

  /**
   * Search method: looks for listener by passed event type
   *
   * @param {string} eventType - event type
   * @returns {ListenerData[]} listeners that found on element
   */
  private findByType(eventType: string): ListenerData[] {
    return this.allListeners.filter((listener) => listener.eventType === eventType);
  }

  /**
   * Search method: looks for listener by passed handler
   *
   * @param {Function} handler - event handler
   * @returns {ListenerData[]} listeners that found on element
   */
  private findByHandler(handler: (event: Event) => void): ListenerData[] {
    return this.allListeners.filter((listener) => listener.handler === handler);
  }

  /**
   * Returns listener data found by id
   *
   * @param {string} id - listener identifier
   * @returns {ListenerData}
   */
  private findById(id: string): ListenerData | undefined {
    return this.allListeners.find((listener) => listener.id === id);
  }

  /**
   * Normalizes listener options to a comparable shape
   *
   * @param {boolean|AddEventListenerOptions} [options] - event options
   * @returns {NormalizedListenerOptions}
   */
  private normalizeListenerOptions(options?: boolean | AddEventListenerOptions): NormalizedListenerOptions {
    if (typeof options === 'boolean') {
      return {
        capture: options,
        once: false,
        passive: false,
      };
    }

    if (!options) {
      return {
        capture: false,
        once: false,
        passive: false,
      };
    }

    return {
      capture: options.capture ?? false,
      once: options.once ?? false,
      passive: options.passive ?? false,
      signal: options.signal,
    };
  }

  /**
   * Compares stored listener options with provided ones
   *
   * @param {boolean|AddEventListenerOptions} storedOptions - stored event options
   * @param {boolean|AddEventListenerOptions} [providedOptions] - provided event options
   * @returns {boolean}
   */
  private areOptionsEqual(
    storedOptions: boolean | AddEventListenerOptions,
    providedOptions?: boolean | AddEventListenerOptions
  ): boolean {
    if (providedOptions === undefined) {
      return true;
    }

    const storedNormalized = this.normalizeListenerOptions(storedOptions);
    const providedNormalized = this.normalizeListenerOptions(providedOptions);

    return (
      storedNormalized.capture === providedNormalized.capture &&
      storedNormalized.once === providedNormalized.once &&
      storedNormalized.passive === providedNormalized.passive &&
      storedNormalized.signal === providedNormalized.signal
    );
  }
}
