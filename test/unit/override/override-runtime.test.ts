import type { resolveOverrideEntry as ResolveOverrideEntry } from '../../../scripts/override/override-runtime.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let resolveOverrideEntry: typeof ResolveOverrideEntry;

type MutableGlobal = { __BLOK_DEV_OVERRIDE__?: unknown };

const g = globalThis as MutableGlobal;

const validRegistry = (entries: Record<string, unknown>): unknown => ({
  protocol: 1,
  version: '1.11.0-dev.abc1234',
  builtAt: '2026-08-20T00:00:00Z',
  entries,
});

describe('resolveOverrideEntry', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../scripts/override/override-runtime.mjs');
    resolveOverrideEntry = mod.resolveOverrideEntry;
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete g.__BLOK_DEV_OVERRIDE__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete g.__BLOK_DEV_OVERRIDE__;
  });

  it('returns null when no registry is set', () => {
    expect(resolveOverrideEntry('core', ['Blok'])).toBeNull();
  });

  it('returns the entry when the registry validates', () => {
    const core = { Blok: class {}, version: '1.11.0-dev.abc1234' };
    g.__BLOK_DEV_OVERRIDE__ = validRegistry({ core });
    expect(resolveOverrideEntry('core', ['Blok', 'version'])).toBe(core);
  });

  it('returns null on protocol mismatch', () => {
    g.__BLOK_DEV_OVERRIDE__ = { ...(validRegistry({ core: {} }) as Record<string, unknown>), protocol: 2 };
    expect(resolveOverrideEntry('core', [])).toBeNull();
  });

  it('rejects a DOM-clobbered registry (element named __BLOK_DEV_OVERRIDE__)', () => {
    g.__BLOK_DEV_OVERRIDE__ = document.createElement('img');
    expect(resolveOverrideEntry('core', [])).toBeNull();
  });

  it('rejects a Node entries object and a Node entry', () => {
    g.__BLOK_DEV_OVERRIDE__ = validRegistry({ core: document.createElement('form') });
    expect(resolveOverrideEntry('core', [])).toBeNull();
    g.__BLOK_DEV_OVERRIDE__ = { protocol: 1, entries: document.createElement('form') };
    expect(resolveOverrideEntry('core', [])).toBeNull();
  });

  it('rejects an HTMLCollection entry (nested-form clobbering)', () => {
    const form = document.createElement('form');
    g.__BLOK_DEV_OVERRIDE__ = validRegistry({ core: form.elements });
    expect(resolveOverrideEntry('core', [])).toBeNull();
  });

  it('returns null when the entry is absent (partial registries are allowed, silently)', () => {
    g.__BLOK_DEV_OVERRIDE__ = validRegistry({ tools: {} });
    expect(resolveOverrideEntry('core', ['Blok'])).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns once when an expected export is missing', () => {
    g.__BLOK_DEV_OVERRIDE__ = validRegistry({ core: { Blok: class {} } });
    expect(resolveOverrideEntry('core', ['Blok', 'version'])).toBeNull();
    expect(resolveOverrideEntry('core', ['Blok', 'version'])).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('never reads localStorage, meta tags, URL params, or DOM attributes', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const querySelector = vi.spyOn(document, 'querySelector');
    g.__BLOK_DEV_OVERRIDE__ = validRegistry({ core: { version: 'x' } });
    resolveOverrideEntry('core', ['version']);
    expect(getItem).not.toHaveBeenCalled();
    expect(querySelector).not.toHaveBeenCalled();
  });
});
