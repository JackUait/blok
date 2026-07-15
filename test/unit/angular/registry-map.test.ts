import { describe, it, expect, vi } from 'vitest';

import { setRegistry, getRegistry, removeRegistry } from '../../../packages/angular/src/registry-map';
import type { BlockPortalRegistry } from '../../../packages/angular/src/block-portal-registry';

const stub = (): BlockPortalRegistry =>
  ({ register: vi.fn(), unregister: vi.fn(), flush: vi.fn(), destroyAll: vi.fn() } as never);

describe('registry-map', () => {
  it('associates a registry with an editor and reads it back', () => {
    const editor = {};
    const registry = stub();

    setRegistry(editor, registry);

    expect(getRegistry(editor)).toBe(registry);
  });

  it('returns undefined for an unknown editor', () => {
    expect(getRegistry({})).toBeUndefined();
  });

  it('removes the association', () => {
    const editor = {};

    setRegistry(editor, stub());
    removeRegistry(editor);

    expect(getRegistry(editor)).toBeUndefined();
  });
});
