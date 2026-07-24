/**
 * #41: first-class host-i18n bridge in blok-react.
 *
 * A host that owns its own locale state (a language switcher) had two
 * disconnected resolvers and no library-neutral entry point: it had to build
 * an `i18n` config object by hand. `<BlokEditor locale="…" />` is the neutral
 * shorthand — a plain BCP-47 string routed to `editor.i18n.update({ locale })`
 * in place — and `getDirection`/`normalizeLocale` are re-exported so the host
 * can compute `dir` itself while owning the subscription.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import React from 'react';

import { BlokEditor } from '../../../packages/react/src/BlokEditor';

interface MockInstance {
  i18n: { update: ReturnType<typeof vi.fn> };
}

let instances: MockInstance[] = [];

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady = Promise.resolve();
    public destroy = vi.fn();
    public readOnly = { set: vi.fn().mockResolvedValue(true) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };
    public render = vi.fn();
    public save = vi.fn().mockResolvedValue({ blocks: [] });
    public on = vi.fn();
    public off = vi.fn();
    public i18n = { update: vi.fn().mockResolvedValue(undefined) };
    public config: Record<string, unknown>;
    constructor(config: { holder: HTMLElement }) {
      this.config = config;
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      instances.push(this);
    }
  },
}));

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('BlokEditor locale prop', () => {
  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a plain locale string through editor.i18n.update on change', async () => {
    const { rerender } = render(<BlokEditor locale="en" />);

    await flush();
    expect(instances).toHaveLength(1);
    expect(instances[0].i18n.update).not.toHaveBeenCalled();

    rerender(<BlokEditor locale="ru-RU" />);
    await flush();

    expect(instances).toHaveLength(1);
    expect(instances[0].i18n.update).toHaveBeenCalledWith({ locale: 'ru-RU' });
  });

  it('does not forward locale as a container div attribute', async () => {
    render(<BlokEditor locale="en" data-testid="host" />);

    await flush();

    expect(screen.getByTestId('host')).not.toHaveAttribute('locale');
  });
});

/**
 * The barrel (`packages/react/src/index.ts`) imports `@bloklabs/core/view`,
 * which the root `unit` vitest project (a protected config) does not alias, so
 * it can't be imported here. Assert the public re-export at the source level
 * instead — the runtime helpers themselves are covered by the core tests.
 */
describe('blok-react re-exports the host-i18n direction helpers', () => {
  const indexSource = readFileSync(
    join(__dirname, '../../../packages/react/src/index.ts'),
    'utf-8',
  );
  const typesSource = readFileSync(
    join(__dirname, '../../../packages/react/types/index.d.ts'),
    'utf-8',
  );

  it('re-exports getDirection and normalizeLocale from the package root', () => {
    expect(indexSource).toMatch(/export\s*\{[^}]*\bgetDirection\b[^}]*\}\s*from\s*'@bloklabs\/core\/locales'/);
    expect(indexSource).toMatch(/export\s*\{[^}]*\bnormalizeLocale\b[^}]*\}\s*from\s*'@bloklabs\/core\/locales'/);
  });

  it('declares the re-exported helpers in the published types', () => {
    expect(typesSource).toMatch(/getDirection/);
    expect(typesSource).toMatch(/normalizeLocale/);
  });
});
