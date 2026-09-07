import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HandlersAPI } from '../../../../../src/components/modules/api/handlers';
import { expandPersistenceConfig } from '../../../../../src/components/utils/persistence';
import type { BlokConfig } from '../../../../../types';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';

const build = (config: Partial<BlokConfig> = {}): { api: HandlersAPI; config: BlokConfig } => {
  const full: BlokConfig = { ...config };
  const moduleConfig: ModuleConfig = {
    config: full,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  return { api: new HandlersAPI(moduleConfig), config: full };
};

describe('HandlersAPI mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the public surface', () => {
    it('exposes exactly one method, bound to the instance', () => {
      const { api, config } = build();
      const onChange = vi.fn();

      expect(Object.keys(api.methods)).toStrictEqual(['set']);

      api.methods.set({ onChange });

      expect(config.onChange).toBe(onChange);
    });
  });

  describe('installing a handler', () => {
    it.each(['onChange', 'onEnter', 'onSubmit', 'onBeforeRender', 'onAfterRender'] as const)(
      'writes %s straight through',
      (key) => {
        const { api, config } = build();
        const handler = vi.fn();

        api.set({ [key]: handler });

        expect(config[key]).toBe(handler);
      },
    );

    it('touches only the keys the caller passed', () => {
      const original = vi.fn();
      const { api, config } = build({ onEnter: original });

      api.set({ onChange: vi.fn() });

      expect(config.onEnter).toBe(original);
    });

    it('leaves a key alone when it is absent, and unsets it when present as undefined', () => {
      const original = vi.fn();
      const absent = build({ onEnter: original });

      absent.api.set({});
      expect(absent.config.onEnter).toBe(original);

      const present = build({ onEnter: original });

      present.api.set({ onEnter: undefined });
      expect(present.config.onEnter).toBeUndefined();
    });

    it('unsets a handler that is present but not callable', () => {
      const { api, config } = build({ onChange: vi.fn() });

      api.set({ onChange: 'not a function' as unknown as BlokConfig['onChange'] });

      expect(config.onChange).toBeUndefined();
    });

    it('replaces a handler that is already installed', () => {
      const first = vi.fn();
      const second = vi.fn();
      const { api, config } = build({ onChange: first });

      api.set({ onChange: second });

      expect(config.onChange).toBe(second);
    });
  });

  describe('onSave with persistence configured', () => {
    const withQueue = (): { api: HandlersAPI; config: BlokConfig; save: ReturnType<typeof vi.fn> } => {
      const save = vi.fn(async () => undefined);
      const expanded = expandPersistenceConfig({
        persistence: { load: async () => null, save },
      });
      const moduleConfig: ModuleConfig = {
        config: expanded,
        eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      };

      return { api: new HandlersAPI(moduleConfig), config: expanded, save };
    };

    const document = { blocks: [] } as never;

    it('composes the host handler with the save queue rather than replacing it', async () => {
      const { api, config, save } = withQueue();
      const onSave = vi.fn();

      api.set({ onSave });

      expect(config.onSave).not.toBe(onSave);

      config.onSave?.(document, {} as never);
      await Promise.resolve();

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('keeps the queue when the host handler is unset', async () => {
      const { api, config, save } = withQueue();

      api.set({ onSave: vi.fn() });
      api.set({ onSave: undefined });

      expect(config.onSave).toBeDefined();

      config.onSave?.(document, {} as never);
      await Promise.resolve();

      expect(save).toHaveBeenCalledTimes(1);
    });

    it('replaces only the host half when the handler changes', async () => {
      const { api, config } = withQueue();
      const first = vi.fn();
      const second = vi.fn();

      api.set({ onSave: first });
      api.set({ onSave: second });

      config.onSave?.(document, {} as never);
      await Promise.resolve();

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('onSave with no persistence configured', () => {
    it('writes the host handler through unchanged', () => {
      const { api, config } = build();
      const onSave = vi.fn();

      api.set({ onSave });

      expect(config.onSave).toBe(onSave);
    });

    it('unsets it again', () => {
      const { api, config } = build({ onSave: vi.fn() });

      api.set({ onSave: undefined });

      expect(config.onSave).toBeUndefined();
    });
  });
});
