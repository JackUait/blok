import React, { createContext, useContext, type ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';

const HostContext = createContext('default');

function Probe({ suffix = '' }: { suffix?: string }): ReactElement {
  const value = useContext(HostContext);

  return <span className="probe">{`${value}${suffix}`}</span>;
}

describe('BlockPortalHost + registry (React)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const makeHost = (): HTMLElement => {
    const el = document.createElement('div');

    document.body.appendChild(el);

    return el;
  };

  it('renders a registered component into its host element', () => {
    const registry = createBlockPortalRegistry();
    const target = makeHost();

    render(<BlockPortalHost registry={registry} />);

    act(() => {
      registry.register('a', { hostEl: target, component: Probe, props: {} });
    });

    expect(target.querySelector('.probe')?.textContent).toBe('default');
  });

  it('updates the rendered component when setProps is called (no re-register)', () => {
    const registry = createBlockPortalRegistry();
    const target = makeHost();

    render(<BlockPortalHost registry={registry} />);

    act(() => {
      registry.register('a', { hostEl: target, component: Probe, props: { suffix: '-1' } });
    });
    expect(target.querySelector('.probe')?.textContent).toBe('default-1');

    act(() => {
      registry.setProps('a', { suffix: '-2' });
    });
    expect(target.querySelector('.probe')?.textContent).toBe('default-2');
  });

  it('unregister removes the rendered content from its host', () => {
    const registry = createBlockPortalRegistry();
    const target = makeHost();

    render(<BlockPortalHost registry={registry} />);

    act(() => {
      registry.register('a', { hostEl: target, component: Probe, props: {} });
    });
    expect(target.querySelector('.probe')).not.toBeNull();

    act(() => {
      registry.unregister('a');
    });
    expect(target.querySelector('.probe')).toBeNull();
  });

  it('renders many blocks through ONE host into their own targets', () => {
    const registry = createBlockPortalRegistry();
    const first = makeHost();
    const second = makeHost();

    render(<BlockPortalHost registry={registry} />);

    act(() => {
      registry.register('a', { hostEl: first, component: Probe, props: { suffix: '-a' } });
      registry.register('b', { hostEl: second, component: Probe, props: { suffix: '-b' } });
    });

    expect(first.querySelector('.probe')?.textContent).toBe('default-a');
    expect(second.querySelector('.probe')?.textContent).toBe('default-b');
  });

  it('is idempotent on double register and double unregister', () => {
    const registry = createBlockPortalRegistry();
    const target = makeHost();

    render(<BlockPortalHost registry={registry} />);

    act(() => {
      registry.register('a', { hostEl: target, component: Probe, props: {} });
      registry.register('a', { hostEl: target, component: Probe, props: {} });
    });
    expect(target.querySelectorAll('.probe')).toHaveLength(1);

    act(() => {
      registry.unregister('a');
      registry.unregister('a');
    });
    expect(target.querySelector('.probe')).toBeNull();
  });

  it('portaled blocks inherit React context from the tree ABOVE the host', () => {
    const registry = createBlockPortalRegistry();
    const target = makeHost();

    render(
      <HostContext.Provider value="from-app">
        <BlockPortalHost registry={registry} />
      </HostContext.Provider>
    );

    act(() => {
      registry.register('a', { hostEl: target, component: Probe, props: {} });
    });

    // THE hack-3 regression: context flows from the host tree into block tools.
    expect(target.querySelector('.probe')?.textContent).toBe('from-app');
  });

  it('a throwing block does not tear down sibling blocks', () => {
    const registry = createBlockPortalRegistry();
    const bad = makeHost();
    const good = makeHost();

    function Bomb(): ReactElement {
      throw new Error('boom');
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<BlockPortalHost registry={registry} />);

    act(() => {
      registry.register('bad', { hostEl: bad, component: Bomb, props: {} });
      registry.register('good', { hostEl: good, component: Probe, props: {} });
    });

    expect(good.querySelector('.probe')?.textContent).toBe('default');

    consoleError.mockRestore();
  });

  it('registry snapshot is stable between mutations (useSyncExternalStore contract)', () => {
    const registry: BlockPortalRegistry = createBlockPortalRegistry();

    const before = registry.getSnapshot();

    expect(registry.getSnapshot()).toBe(before);

    registry.register('a', { hostEl: makeHost(), component: Probe, props: {} });

    const after = registry.getSnapshot();

    expect(after).not.toBe(before);
    expect(registry.getSnapshot()).toBe(after);
  });
});
