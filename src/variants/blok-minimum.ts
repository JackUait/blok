'use strict';

/**
 * Minimum bundle variant - Core editor only
 *
 * This entry point exports the Blok class WITHOUT bundled tools (Header, Paragraph, List).
 * Use this to measure the minimum bundle size when users provide all tools externally.
 *
 * This file is NOT part of the public API - it's only used for bundle size measurement.
 */

import type { BlokConfig } from '../../types';
import type { BlokModules } from '../types-internal/blok-modules';

import '@babel/register';
import '../components/polyfills';
import { Core } from '../components/core';
import { getBlokVersion, isObject, isFunction } from '../components/utils';
import { destroy as destroyTooltip } from '../components/utils/tooltip';
import { DATA_ATTR } from '../components/constants/data-attributes';

export const version = getBlokVersion();
export { DATA_ATTR };

/**
 * Blok - Minimum bundle (no bundled tools)
 */
class Blok {
  private readonly initialConfiguration: BlokConfig | string | undefined;
  public isReady: Promise<void>;
  public destroy: () => void;

  public static get version(): string {
    return getBlokVersion();
  }

  public static DATA_ATTR = DATA_ATTR;

  constructor(configuration?: BlokConfig | string) {
    this.initialConfiguration = isObject(configuration)
      ? { ...configuration }
      : configuration;

    const onReady =
      isObject(configuration) && isFunction(configuration.onReady)
        ? configuration.onReady
        : () => {};

    const blok = new Core(configuration);

    this.destroy = (): void => {};

    this.isReady = blok.isReady.then(() => {
      this.exportAPI(blok);
      onReady();
    });
  }

  public exportAPI(blok: Core): void {
    const fieldsToExport = ['configuration'];
    const destroy = (): void => {
      Object.values(blok.moduleInstances).forEach((moduleInstance) => {
        if (moduleInstance === undefined || moduleInstance === null) {
          return;
        }

        if (
          isFunction((moduleInstance as { destroy?: () => void }).destroy)
        ) {
          (moduleInstance as { destroy: () => void }).destroy();
        }

        const listeners = (
          moduleInstance as { listeners?: { removeAll?: () => void } }
        ).listeners;

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
        (this as Record<string, unknown>)[field] = (
          blok as unknown as Record<string, unknown>
        )[field];

        return;
      }

      const coreConfiguration = (
        blok as unknown as { configuration?: BlokConfig | string | undefined }
      ).configuration;
      const configurationToExport = isObject(this.initialConfiguration)
        ? this.initialConfiguration
        : (coreConfiguration ?? this.initialConfiguration);

      if (configurationToExport === undefined) {
        return;
      }

      (this as Record<string, unknown>)[field] = configurationToExport;
    });

    this.destroy = destroy;

    const apiMethods = blok.moduleInstances.API.methods;
    const eventsDispatcherApi =
      blok.moduleInstances.EventsAPI?.methods ?? apiMethods.events;

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
    const moduleInstancesRecord = moduleInstances as unknown as Record<
      string,
      unknown
    >;

    const getAliasName = (name: string): string =>
      /^[A-Z]+$/.test(name)
        ? name.toLowerCase()
        : name.charAt(0).toLowerCase() + name.slice(1);

    Object.keys(moduleInstancesRecord).forEach((name) => {
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

    const toolbarModule = moduleInstances.Toolbar as unknown as
      | ToolbarModuleWithSettings
      | undefined;
    const blockSettingsModule = moduleInstances.BlockSettings;

    if (
      toolbarModule !== undefined &&
      blockSettingsModule !== undefined &&
      toolbarModule.blockSettings === undefined
    ) {
      toolbarModule.blockSettings = blockSettingsModule;
    }

    const inlineToolbarModule = moduleInstances.InlineToolbar;

    if (
      toolbarModule !== undefined &&
      inlineToolbarModule !== undefined &&
      toolbarModule.inlineToolbar === undefined
    ) {
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

    type API = {
      blocks: Record<string, unknown>;
      caret: Record<string, unknown>;
      events: Record<string, unknown>;
      saver: Record<string, unknown>;
    };

    Object.entries(shorthands).forEach(([key, methods]) => {
      Object.entries(methods).forEach(([name, alias]) => {
        const apiKey = key as keyof API;
        const apiMethodGroup = blok.moduleInstances.API.methods[
          apiKey
        ] as unknown as Record<string, unknown>;

        (this as Record<string, unknown>)[alias] = apiMethodGroup[name];
      });
    });
  }
}

export { Blok };
