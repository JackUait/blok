import { isEmpty, logLabeled } from '../utils';

/**
 * Event Dispatcher event listener
 */
type Listener<Data> = (data: Data) => void;

/**
 * Mapped type with subscriptions list
 *
 * event name -> array of callbacks
 */
type Subscriptions<EventMap> = {
  [Key in keyof EventMap]: Listener<EventMap[Key]>[];
};

/**
 * Provides methods for working with Event Bus:
 *    - {Function} on - appends subscriber to the event. If event doesn't exist - creates new one
 *    - {Function} emit - fires all subscribers with data
 *    - {Function off - unsubscribes callback
 */
export class EventsDispatcher<EventMap> {
  /**
   * All subscribers grouped by event name
   * Object with events` names as key and array of callback functions as value
   */
  private subscribers = <Subscriptions<EventMap>>{};

  /**
   * Subscribe any event on callback
   * @param eventName - event name
   * @param callback - subscriber
   */
  public on<Name extends keyof EventMap>(eventName: Name, callback: Listener<EventMap[Name]>): void {
    if (!(eventName in this.subscribers)) {
      this.subscribers[eventName] = [];
    }

    // group by events
    this.subscribers[eventName].push(callback);
  }

  /**
   * Subscribe any event on callback. Callback will be called once and be removed from subscribers array after call.
   * @param eventName - event name
   * @param callback - subscriber
   */
  public once<Name extends keyof EventMap>(eventName: Name, callback: Listener<EventMap[Name]>): void {
    if (!(eventName in this.subscribers)) {
      this.subscribers[eventName] = [];
    }

    const wrappedCallback = (data: EventMap[typeof eventName]): void => {
      const result = callback(data);

      const indexOfHandler = this.subscribers[eventName].indexOf(wrappedCallback);

      if (indexOfHandler !== -1) {
        this.subscribers[eventName].splice(indexOfHandler, 1);
      }

      return result;
    };

    // group by events
    this.subscribers[eventName].push(wrappedCallback);
  }

  /**
   * Emit callbacks with passed data
   * @param eventName - event name
   * @param data - subscribers get this data when they were fired
   */
  public emit<Name extends keyof EventMap>(eventName: Name, data?: EventMap[Name]): void {
    if (isEmpty(this.subscribers) || !this.subscribers[eventName]) {
      return;
    }

    // A listener that returns a value replaces the payload for the next one.
    // Public api.events behaviour since editor.js; pinned by row-move-to's
    // "replacement-payload forwarding" test. Internal listeners must return nothing.
    let payload = data;

    for (const callback of this.listenersToInvoke(eventName)) {
      const next = callback(payload as EventMap[Name]);

      payload = next !== undefined ? next : payload;
    }
  }

  /** Like emit, but a throwing subscriber is logged and the rest still run. */
  public emitNotification<Name extends keyof EventMap>(eventName: Name, data: EventMap[Name]): void {
    for (const callback of this.listenersToInvoke(eventName)) {
      try {
        callback(data);
      } catch (error) {
        logLabeled('A notification subscriber threw.', 'error', error);
      }
    }
  }

  /**
   * Walks a copy of the list, like DOM EventTarget dispatch: a `once` listener
   * removing itself must not skip the next one, a listener added during the
   * emit waits for the next emit, and one removed during it is skipped.
   * https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
   */
  private *listenersToInvoke<Name extends keyof EventMap>(eventName: Name): Generator<Listener<EventMap[Name]>> {
    for (const callback of [...(this.subscribers[eventName] ?? [])]) {
      // Re-read the field: destroy() replaces the whole map mid-emit.
      if (this.subscribers[eventName]?.includes(callback)) {
        yield callback;
      }
    }
  }

  /**
   * Unsubscribe callback from event
   * @param eventName - event name
   * @param callback - event handler
   */
  public off<Name extends keyof EventMap>(eventName: Name, callback: Listener<EventMap[Name]>): void {
    const subscribers = this.subscribers[eventName];

    if (subscribers === undefined) {
      console.warn(`EventDispatcher .off(): there is no subscribers for event "${eventName.toString()}". Probably, .off() called before .on()`);

      return;
    }

    const indexOfCallback = subscribers.indexOf(callback);

    if (indexOfCallback === -1) {
      return;
    }

    subscribers.splice(indexOfCallback, 1);
  }

  /**
   * Destroyer
   * clears subscribers list
   */
  public destroy(): void {
    this.subscribers = {} as Subscriptions<EventMap>;
  }
}
