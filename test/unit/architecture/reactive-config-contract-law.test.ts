/**
 * Reactive config contract LAW.
 *
 * `BlokState` (types/configs/blok-config.d.ts) is the machine-checked list of
 * config fields that are LIVE — every key declared there MUST have a public
 * runtime setter on the editor API. This test holds the single source-of-truth
 * map from state key → setter path; the adapters phase extends this contract
 * (each BlokState field must get a reactive path in all three adapters).
 *
 * If you add a field to BlokState: add its setter here AND implement it.
 * If you add a runtime setter for a config field: declare the field in
 * BlokState (not BlokMountOptions) and register it here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { Paragraph } from '../../../src/tools/paragraph';

/**
 * Single source of truth: BlokState key → the public API setter that services it.
 * The `assert` function receives a booted editor's API methods and must prove
 * the setter exists.
 */
const REACTIVE_CONTRACT: Record<string, {
  setter: string;
  /** Source fingerprint of the setter call every adapter must contain. */
  adapterCall: RegExp;
  assert: (api: Core['moduleInstances']['API']['methods']) => void;
}> = {
  readOnly: {
    setter: 'readOnly.set(state, { hideControls })',
    adapterCall: /\.readOnly\.set\(/,
    assert: (api) => expect(typeof api.readOnly.set).toBe('function'),
  },
  hideToolbar: {
    setter: 'toolbar.setHidden(hidden)',
    adapterCall: /\.toolbar\.setHidden\(/,
    assert: (api) => expect(typeof api.toolbar.setHidden).toBe('function'),
  },
  inlineToolbar: {
    setter: 'tools.setInlineToolbar(config)',
    adapterCall: /\.tools\.setInlineToolbar\(/,
    assert: (api) => expect(typeof api.tools.setInlineToolbar).toBe('function'),
  },
};

/**
 * The reactive sync surface of each framework adapter: the file that owns the
 * in-place effects/watches for BlokState fields. Every BlokState setter must
 * be called somewhere in it — a missing fingerprint means the adapter treats
 * a live field as mount-only (the drift this law exists to catch).
 */
const ADAPTER_SYNC_SURFACES: Record<string, string> = {
  react: 'packages/react/src/useBlok.ts',
  vue: 'packages/vue/src/useBlok.ts',
  angular: 'packages/angular/src/blok-editor.component.ts',
};

/**
 * Extracts the top-level optional field names declared in the BlokState
 * interface of the published config types.
 * @returns declared BlokState keys, in declaration order
 */
const readBlokStateKeys = (): string[] => {
  const source = readFileSync(
    resolve(__dirname, '../../../types/configs/blok-config.d.ts'),
    'utf-8'
  );

  const interfaceMatch = source.match(/export interface BlokState \{([\s\S]*?)\n\}/);

  if (interfaceMatch === null) {
    throw new Error('BlokState interface not found in types/configs/blok-config.d.ts');
  }

  const body = interfaceMatch[1];

  return Array.from(body.matchAll(/^ {2}([a-zA-Z0-9_]+)\?:/gm)).map((match) => match[1]);
};

/**
 * Minimal replica of Blok.destroy()'s module teardown so a Core booted
 * directly (to reach moduleInstances) does not leak listeners between tests.
 * @param core - booted core instance
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as { markDestroyed?: () => void };

    if (typeof instance.markDestroyed === 'function') {
      instance.markDestroyed();
    }
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    };

    if (typeof instance.destroy === 'function') {
      instance.destroy();
    }

    if (instance.listeners && typeof instance.listeners.removeAll === 'function') {
      instance.listeners.removeAll();
    }
  });
};

describe('reactive config contract law', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    if (core) {
      destroyCore(core);
    }
    core = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('BlokState declares exactly the keys registered in the reactive contract', () => {
    expect(readBlokStateKeys().sort()).toEqual(Object.keys(REACTIVE_CONTRACT).sort());
  });

  it('BlokState is non-empty (non-vacuity floor)', () => {
    expect(readBlokStateKeys().length).toBeGreaterThanOrEqual(3);
  });

  it('every BlokState key has its public setter on a booted editor API', async () => {
    core = new Core({
      holder,
      tools: { paragraph: { class: Paragraph } },
    });
    await core.isReady;

    const api = core.moduleInstances.API.methods;

    Object.values(REACTIVE_CONTRACT).forEach(({ assert }) => {
      assert(api);
    });
  });

  it('every framework adapter calls every BlokState setter (parity)', () => {
    const missing = Object.entries(ADAPTER_SYNC_SURFACES).flatMap(([adapter, surfacePath]) => {
      const source = readFileSync(resolve(__dirname, '../../../', surfacePath), 'utf-8');

      return Object.entries(REACTIVE_CONTRACT)
        .filter(([, { adapterCall }]) => !adapterCall.test(source))
        .map(([stateKey]) => `${adapter} (${surfacePath}) has no reactive path for "${stateKey}"`);
    });

    expect(missing).toEqual([]);
  });

  it('BlokConfig still composes mount options and state (published-types shape)', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../types/configs/blok-config.d.ts'),
      'utf-8'
    );

    expect(source).toMatch(/export interface BlokConfig extends BlokMountOptions, BlokState/);
  });
});
