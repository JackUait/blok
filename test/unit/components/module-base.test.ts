 
import { describe, it, expect, vi } from 'vitest';

import Module from '../../../src/components/__module';
import EventsDispatcher from '../../../src/components/utils/events';

import type { ModuleConfig } from '../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../types';
import type { BlokEventMap } from '../../../src/components/events';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type Listeners from '../../../src/components/utils/listeners';

const createModuleConfig = (configOverrides?: Partial<BlokConfig>): ModuleConfig => {
  const defaultConfig = {
    i18n: {
      direction: 'ltr',
    },
  } as BlokConfig;

  const mergedConfig = {
    ...defaultConfig,
    ...(configOverrides ?? {}),
    i18n: {
      ...defaultConfig.i18n,
      ...(configOverrides?.i18n ?? {}),
    },
  } as BlokConfig;

  return {
    config: mergedConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };
};

class ConcreteModule extends Module<{
  primary?: HTMLElement;
  secondary?: HTMLElement;
  misc?: HTMLElement;
}> {
  public exposeReadOnlyListeners(): Module['readOnlyMutableListeners'] {
    return this.readOnlyMutableListeners;
  }

  public overrideListeners(listeners: Pick<Listeners, 'on' | 'offById'>): void {
    this.listeners = listeners as Listeners;
  }

  public blokState(): BlokModules {
    return this.Blok;
  }

  public isRightToLeft(): boolean {
    return this.isRtl;
  }
}

const createConcreteModule = (configOverrides?: Partial<BlokConfig>): ConcreteModule => {
  return new ConcreteModule(createModuleConfig(configOverrides));
};

describe('Module base class', () => {
  it('throws when attempting to instantiate directly', () => {
    const createModuleInstance = (): Module =>
      new Module({
        config: {} as BlokConfig,
        eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      });

    expect(createModuleInstance).toThrow(TypeError);
  });

  it('accepts state setter to store Blok modules instance', () => {
    const moduleInstance = createConcreteModule();
    const blokModules = { blocks: {} } as unknown as BlokModules;

    moduleInstance.state = blokModules;

    expect(moduleInstance.blokState()).toBe(blokModules);
  });

  it('removes memorized HTMLElements via removeAllNodes()', () => {
    const moduleInstance = createConcreteModule();
    const first = document.createElement('div');
    const second = document.createElement('span');
    const firstRemoveSpy = vi.spyOn(first, 'remove');
    const secondRemoveSpy = vi.spyOn(second, 'remove');
    const mockObject = { remove: vi.fn() };

    moduleInstance.nodes.primary = first;
    moduleInstance.nodes.secondary = second;
    moduleInstance.nodes.misc = mockObject as unknown as HTMLElement;

    moduleInstance.removeAllNodes();

    expect(firstRemoveSpy).toHaveBeenCalledTimes(1);
    expect(secondRemoveSpy).toHaveBeenCalledTimes(1);
    expect(mockObject.remove).not.toHaveBeenCalled();
  });

  it('tracks read-only mutable listeners and clears them on demand', () => {
    const moduleInstance = createConcreteModule();
    const listeners = {
      on: vi.fn(),
      offById: vi.fn(),
    };

    listeners.on.mockReturnValueOnce('listener-1').mockReturnValueOnce(undefined);

    moduleInstance.overrideListeners(listeners as unknown as Listeners);

    const handler = vi.fn();
    const element = document.createElement('button');
    const { on, clearAll } = moduleInstance.exposeReadOnlyListeners();

    on(element, 'click', handler);
    on(element, 'mouseover', handler);

    clearAll();
    clearAll();

    expect(listeners.on).toHaveBeenCalledTimes(2);
    expect(listeners.offById).toHaveBeenCalledTimes(1);
    expect(listeners.offById).toHaveBeenCalledWith('listener-1');
  });

  it('detects RTL direction based on config', () => {
    const rtlModule = createConcreteModule({
      i18n: {
        direction: 'rtl',
      },
    });

    expect(rtlModule.isRightToLeft()).toBe(true);
    expect(createConcreteModule().isRightToLeft()).toBe(false);
  });
});
