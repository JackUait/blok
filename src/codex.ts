'use strict';

import type { EditorConfig, API } from '../types';

/**
 * Apply polyfills
 */
import '@babel/register';

import './components/polyfills';
import Core from './components/core';
import * as _ from './components/utils';
import { destroy as destroyTooltip } from './components/utils/tooltip';

declare const VERSION: string;

/**
 * Editor.js
 *
 * @license Apache-2.0
 * @see Editor.js <https://editorjs.io>
 * @author CodeX Team <https://codex.so>
 */
export default class EditorJS {
  /**
   * Promise that resolves when core modules are ready and UI is rendered on the page
   */
  public isReady: Promise<void>;

  /**
   * Stores destroy method implementation.
   * Clear heap occupied by Editor and remove UI components from the DOM.
   */
  public destroy: () => void;

  /** Editor version */
  public static get version(): string {
    return VERSION;
  }

  /**
   * @param {EditorConfig|string|undefined} [configuration] - user configuration
   */
  constructor(configuration?: EditorConfig|string) {
    /**
     * Set default onReady function or use the one from configuration if provided
     */
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const onReady = (_.isObject(configuration) && _.isFunction(configuration.onReady))
      ? configuration.onReady
      : () => {};

    /**
     * Create a Editor.js instance
     */
    const editor = new Core(configuration);

    /**
     * Initialize destroy with a no-op function that will be replaced in exportAPI
     */
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    this.destroy = (): void => {};

    /**
     * We need to export isReady promise in the constructor
     * as it can be used before other API methods are exported
     *
     * @type {Promise<void>}
     */
    this.isReady = editor.isReady.then(() => {
      this.exportAPI(editor);
      /**
       * @todo pass API as an argument. It will allow to use Editor's API when editor is ready
       */
      onReady();
    });
  }

  /**
   * Export external API methods
   *
   * @param {Core} editor — Editor's instance
   */
  public exportAPI(editor: Core): void {
    const fieldsToExport = [ 'configuration' ];
    const destroy = (): void => {
      Object.values(editor.moduleInstances)
        .forEach((moduleInstance) => {
          if (_.isFunction(moduleInstance.destroy)) {
            moduleInstance.destroy();
          }
          moduleInstance.listeners.removeAll();
        });

      destroyTooltip();

      for (const field in this) {
        if (Object.prototype.hasOwnProperty.call(this, field)) {
          delete (this as Record<string, unknown>)[field];
        }
      }

      Object.setPrototypeOf(this, null);
    };

    fieldsToExport.forEach((field) => {
      (this as Record<string, unknown>)[field] = (editor as unknown as Record<string, unknown>)[field];
    });

    this.destroy = destroy;

    Object.setPrototypeOf(this, editor.moduleInstances.API.methods);

    delete (this as Partial<EditorJS>).exportAPI;

    const shorthands = {
      blocks: {
        clear: 'clear',
        render: 'render',
      },
      caret: {
        focus: 'focus',
      },
      events: {
        on: 'on',
        off: 'off',
        emit: 'emit',
      },
      saver: {
        save: 'save',
      },
    };

    Object.entries(shorthands)
      .forEach(([key, methods]) => {
        Object.entries(methods)
          .forEach(([name, alias]) => {
            const apiKey = key as keyof API;
            const apiMethods = editor.moduleInstances.API.methods[apiKey] as unknown as Record<string, unknown>;

            (this as Record<string, unknown>)[alias] = apiMethods[name];
          });
      });
  }
}
