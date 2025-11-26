'use strict';

import type { EditorConfig, API } from '../types';
import type { EditorModules } from './types-internal/editor-modules';

/**
 * Apply polyfills
 */
import '@babel/register';

import './components/polyfills';
import Core from './components/core';
import * as _ from './components/utils';
import { destroy as destroyTooltip } from './components/utils/tooltip';

/**
 * Editor.js
 * @license Apache-2.0
 * @see Editor.js <https://editorjs.io>
 * @author CodeX Team <https://codex.so>
 */
export default class EditorJS {
  /**
   * Store user-provided configuration for later export
   */
  private readonly initialConfiguration: EditorConfig|string|undefined;

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
    return _.getEditorVersion();
  }

  /**
   * @param {EditorConfig|string|undefined} [configuration] - user configuration
   */
  constructor(configuration?: EditorConfig|string) {
    this.initialConfiguration = _.isObject(configuration)
      ? { ...configuration }
      : configuration;

    /**
     * Set default onReady function or use the one from configuration if provided
     */
     
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
     
    this.destroy = (): void => {};

    /**
     * We need to export isReady promise in the constructor
     * as it can be used before other API methods are exported
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
   * @param {Core} editor — Editor's instance
   */
  public exportAPI(editor: Core): void {
    const fieldsToExport = [ 'configuration' ];
    const destroy = (): void => {
      Object.values(editor.moduleInstances)
        .forEach((moduleInstance) => {
          if (moduleInstance === undefined || moduleInstance === null) {
            return;
          }

          if (_.isFunction((moduleInstance as { destroy?: () => void }).destroy)) {
            (moduleInstance as { destroy: () => void }).destroy();
          }

          const listeners = (moduleInstance as { listeners?: { removeAll?: () => void } }).listeners;

          if (listeners && _.isFunction(listeners.removeAll)) {
            listeners.removeAll();
          }
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
      if (field !== 'configuration') {
        (this as Record<string, unknown>)[field] = (editor as unknown as Record<string, unknown>)[field];

        return;
      }

      const coreConfiguration = (editor as unknown as { configuration?: EditorConfig|string|undefined }).configuration;
      const configurationToExport = _.isObject(this.initialConfiguration)
        ? this.initialConfiguration
        : coreConfiguration ?? this.initialConfiguration;

      if (configurationToExport === undefined) {
        return;
      }

      (this as Record<string, unknown>)[field] = configurationToExport as EditorConfig|string;
    });

    this.destroy = destroy;

    const apiMethods = editor.moduleInstances.API.methods;
    const eventsDispatcherApi = editor.moduleInstances.EventsAPI?.methods ?? apiMethods.events;

    if (eventsDispatcherApi !== undefined) {
      const defineDispatcher = (target: object): void => {
        if (!Object.prototype.hasOwnProperty.call(target, 'eventsDispatcher')) {
          Object.defineProperty(target, 'eventsDispatcher', {
            value: eventsDispatcherApi,
            configurable: true,
            enumerable: true,
            writable: false,
          });
        }
      };

      defineDispatcher(apiMethods);
      defineDispatcher(this as Record<string, unknown>);
    }

    if (Object.getPrototypeOf(apiMethods) !== EditorJS.prototype) {
      Object.setPrototypeOf(apiMethods, EditorJS.prototype);
    }

    Object.setPrototypeOf(this, apiMethods);

    const moduleAliases = Object.create(null) as Record<string, unknown>;
    const moduleInstances = editor.moduleInstances as Partial<EditorModules>;
    const moduleInstancesRecord = moduleInstances as unknown as Record<string, unknown>;

    const getAliasName = (name: string): string => (
      /^[A-Z]+$/.test(name)
        ? name.toLowerCase()
        : name.charAt(0).toLowerCase() + name.slice(1)
    );

    Object.keys(moduleInstancesRecord)
      .forEach((name) => {
        const alias = getAliasName(name);

        Object.defineProperty(moduleAliases, alias, {
          configurable: true,
          enumerable: true,
          get: () => moduleInstancesRecord[name],
        });
      });

    type ToolbarModuleWithSettings = {
      blockSettings?: unknown;
      inlineToolbar?: unknown;
    };

    const toolbarModule = moduleInstances.Toolbar as unknown as ToolbarModuleWithSettings | undefined;
    const blockSettingsModule = moduleInstances.BlockSettings;

    if (toolbarModule !== undefined && blockSettingsModule !== undefined && toolbarModule.blockSettings === undefined) {
      toolbarModule.blockSettings = blockSettingsModule;
    }

    const inlineToolbarModule = moduleInstances.InlineToolbar;

    if (toolbarModule !== undefined && inlineToolbarModule !== undefined && toolbarModule.inlineToolbar === undefined) {
      toolbarModule.inlineToolbar = inlineToolbarModule;
    }

    Object.defineProperty(this, 'module', {
      value: moduleAliases,
      configurable: true,
      enumerable: false,
      writable: false,
    });

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
            const apiMethodGroup = editor.moduleInstances.API.methods[apiKey] as unknown as Record<string, unknown>;

            (this as Record<string, unknown>)[alias] = apiMethodGroup[name];
          });
      });
  }
}
