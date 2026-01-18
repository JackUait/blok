import type { Events } from '../../../../types/api';
import { Module } from '../../__module';
import type { BlokEventMap } from '../../events';

/**
 * @class EventsAPI
 * provides with methods working with Toolbar
 */
export class EventsAPI extends Module {
  /**
   * Available methods
   * @returns {Events}
   */
  public get methods(): Events {
    return {
      emit: (eventName: keyof BlokEventMap, data: BlokEventMap[keyof BlokEventMap] | undefined): void => this.emit(eventName, data),
      off: (eventName: keyof BlokEventMap, callback: (data?: unknown) => void): void => this.off(eventName, callback),
      on: (eventName: keyof BlokEventMap, callback: () => void): void => this.on(eventName, callback),
    };
  }

  /**
   * Subscribe on Events
   * @param {string} eventName - event name to subscribe
   * @param {Function} callback - event handler
   */
  public on(eventName: keyof BlokEventMap, callback: (data?: unknown) => void): void {
    this.eventsDispatcher.on(eventName, callback);
  }

  /**
   * Emit event with data
   * @param {string} eventName - event to emit
   * @param {object} data - event's data
   */
  public emit(eventName: keyof BlokEventMap, data: BlokEventMap[keyof BlokEventMap] | undefined): void {
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
  public off(eventName: keyof BlokEventMap, callback: (data?: unknown) => void): void {
    this.eventsDispatcher.off(eventName, callback);
  }
}
