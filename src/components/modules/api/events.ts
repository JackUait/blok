import Module from '../../__module';
import type { Events } from '../../../../types/api';
import type { EditorEventMap } from '../../events';

/**
 * @class EventsAPI
 * provides with methods working with Toolbar
 */
export default class EventsAPI extends Module {
  /**
   * Available methods
   * @returns {Events}
   */
  public get methods(): Events {
    return {
      emit: (eventName: keyof EditorEventMap, data: EditorEventMap[keyof EditorEventMap] | undefined): void => this.emit(eventName, data),
      off: (eventName: keyof EditorEventMap, callback: (data?: unknown) => void): void => this.off(eventName, callback),
      on: (eventName: keyof EditorEventMap, callback: () => void): void => this.on(eventName, callback),
    };
  }

  /**
   * Subscribe on Events
   * @param {string} eventName - event name to subscribe
   * @param {Function} callback - event handler
   */
  public on(eventName: keyof EditorEventMap, callback: (data?: unknown) => void): void {
    this.eventsDispatcher.on(eventName, callback);
  }

  /**
   * Emit event with data
   * @param {string} eventName - event to emit
   * @param {object} data - event's data
   */
  public emit(eventName: keyof EditorEventMap, data: EditorEventMap[keyof EditorEventMap] | undefined): void {
    this.eventsDispatcher.emit(
      eventName,
      data
    );
  }

  /**
   * Unsubscribe from Event
   * @param {string} eventName - event to unsubscribe
   * @param {Function} callback - event handler
   */
  public off(eventName: keyof EditorEventMap, callback: (data?: unknown) => void): void {
    this.eventsDispatcher.off(eventName, callback);
  }
}
