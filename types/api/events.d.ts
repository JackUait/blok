import { BlokEditorEventMap } from '../events/editor-events';

/**
 * Describes Blok`s events API.
 *
 * Well-known editor lifecycle events (see {@link BlokEditorEventMap}, e.g.
 * `'blocks:rendered'` and `'block:rendered'`) get fully typed payloads.
 * Arbitrary string event names are still accepted for custom events.
 */
export interface Events {
  /**
   * Emits a typed editor lifecycle event.
   *
   * @param eventName - one of the well-known editor event names
   * @param data - payload matching the event
   */
  emit<Name extends keyof BlokEditorEventMap>(eventName: Name, data: BlokEditorEventMap[Name]): void;

  /**
   * Emits an event.
   *
   * @param {string} eventName
   * @param {any} data
   */
  emit(eventName: string, data?: any): void;

  /**
   * Unsubscribe from a typed editor lifecycle event.
   *
   * @param eventName - one of the well-known editor event names
   * @param callback - the handler to remove
   */
  off<Name extends keyof BlokEditorEventMap>(eventName: Name, callback: (data: BlokEditorEventMap[Name]) => void): void;

  /**
   * Unsubscribe from event.
   *
   * @param {string} eventName
   * @param {(data: any) => void} callback
   */
  off(eventName: string, callback: (data?: any) => void): void;

  /**
   * Subscribe to a typed editor lifecycle event.
   *
   * @param eventName - one of the well-known editor event names
   * @param callback - receives a typed payload
   */
  on<Name extends keyof BlokEditorEventMap>(eventName: Name, callback: (data: BlokEditorEventMap[Name]) => void): void;

  /**
   * Subscribe to event.
   *
   * @param {string} eventName
   * @param {(data: any) => void} callback
   */
  on(eventName: string, callback: (data?: any) => void): void;
}
