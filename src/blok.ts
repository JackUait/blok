'use strict';

import type { BlokConfig, API } from '../types';
import type { BlokModules } from './types-internal/blok-modules';

/**
 * Apply polyfills
 */
import '@babel/register';

import './components/polyfills';
import { Core } from './components/core';
import { getBlokVersion, isObject, isFunction } from './components/utils';
import { destroy as destroyTooltip } from './components/utils/tooltip';
import { DATA_ATTR } from './components/constants/data-attributes';

/**
 * Export version as a named export
 */
export const version = getBlokVersion();

/**
 * Re-export DATA_ATTR for querying editor elements
 */
export { DATA_ATTR } from './components/constants/data-attributes';

/**
 * Blok
 * @license Apache-2.0
 */
class Blok {
  /**
   * Store user-provided configuration for later export
   */
  private readonly initialConfiguration: BlokConfig|string|undefined;

  /**
   * Promise that resolves when core modules are ready and UI is rendered on the page
   */
  public isReady: Promise<void>;

  /**
   * Stores destroy method implementation.
   * Clear heap occupied by Blok and remove UI components from the DOM.
   */
  public destroy: () => void;

  /** Blok version */
  public static get version(): string {
    return getBlokVersion();
  }

  /**
   * Data attributes used by the editor.
   * Single source of truth for all data-blok-* attributes.
   *
   * @example
   * // Query editor elements
   * document.querySelectorAll(`[${Blok.DATA_ATTR.element}]`);
   *
   * // Check if block is selected
   * block.getAttribute(Blok.DATA_ATTR.selected) === 'true';
   */
  public static DATA_ATTR = DATA_ATTR;

  /**
   * @param {BlokConfig|string|undefined} [configuration] - user configuration
   */
  constructor(configuration?: BlokConfig|string) {
    this.initialConfiguration = isObject(configuration)
      ? { ...configuration }
      : configuration;

    /**
     * Set default onReady function or use the one from configuration if provided
     */

    const onReady = (isObject(configuration) && isFunction(configuration.onReady))
      ? configuration.onReady
      : () => {};

    /**
     * Create a Blok instance
     */
    const blok = new Core(configuration);

    /**
     * Initialize destroy with a no-op function that will be replaced in exportAPI
     */

    this.destroy = (): void => {};

    /**
     * We need to export isReady promise in the constructor
     * as it can be used before other API methods are exported
     * @type {Promise<void>}
     */
    this.isReady = blok.isReady.then(() => {
      this.exportAPI(blok);
      /**
       * @todo pass API as an argument. It will allow to use Blok's API when blok is ready
       */
      onReady();
    });
  }

  /**
   * Export external API methods
   * @param {Core} blok — Blok's instance
   */
  public exportAPI(blok: Core): void {
    const fieldsToExport = [ 'configuration' ];
    const destroy = (): void => {
      Object.values(blok.moduleInstances)
        .forEach((moduleInstance) => {
          if (moduleInstance === undefined || moduleInstance === null) {
            return;
          }

          if (isFunction((moduleInstance as { destroy?: () => void }).destroy)) {
            (moduleInstance as { destroy: () => void }).destroy();
          }

          const listeners = (moduleInstance as { listeners?: { removeAll?: () => void } }).listeners;

          if (listeners && isFunction(listeners.removeAll)) {
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
        (this as Record<string, unknown>)[field] = (blok as unknown as Record<string, unknown>)[field];

        return;
      }

      const coreConfiguration = (blok as unknown as { configuration?: BlokConfig|string|undefined }).configuration;
      const configurationToExport = isObject(this.initialConfiguration)
        ? this.initialConfiguration
        : coreConfiguration ?? this.initialConfiguration;

      if (configurationToExport === undefined) {
        return;
      }

      (this as Record<string, unknown>)[field] = configurationToExport as BlokConfig|string;
    });

    this.destroy = destroy;

    const apiMethods = blok.moduleInstances.API.methods;
    const eventsDispatcherApi = blok.moduleInstances.EventsAPI?.methods ?? apiMethods.events;

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

    if (Object.getPrototypeOf(apiMethods) !== Blok.prototype) {
      Object.setPrototypeOf(apiMethods, Blok.prototype);
    }

    Object.setPrototypeOf(this, apiMethods);

    const moduleAliases = Object.create(null) as Record<string, unknown>;
    const moduleInstances = blok.moduleInstances as Partial<BlokModules>;
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

    delete (this as Partial<Blok>).exportAPI;

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
            const apiMethodGroup = blok.moduleInstances.API.methods[apiKey] as unknown as Record<string, unknown>;

            (this as Record<string, unknown>)[alias] = apiMethodGroup[name];
          });
      });
  }
}

export { Blok };
