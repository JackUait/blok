import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useRef } from 'react';
import { useBlokReady } from '../../../packages/react/src/useBlokReady';
import {
  registerInstance,
  unregisterInstance,
} from '../../../src/components/utils/ready-registry';

/**
 * A stand-in for a Blok facade: the readiness registry only needs an identity
 * key and a way to find the instance's wrapper element.
 */
interface FakeInstance {
  key: unknown;
  wrapper: HTMLElement;
  settle: () => void;
}

const created: FakeInstance[] = [];

/**
 * Registers a fake booting instance whose wrapper is mounted in `scope`.
 * @param scope - element the wrapper is appended to
 */
const bootInstance = (scope: Element): FakeInstance => {
  const key = {};
  const wrapper = document.createElement('div');

  scope.appendChild(wrapper);

  const instance: FakeInstance = {
    key,
    wrapper,
    settle: registerInstance(key, () => wrapper),
  };

  created.push(instance);

  return instance;
};

/**
 * Lets queued microtasks (the registry's coalesced notification) run and React
 * flush the resulting state update.
 */
const flush = async (): Promise<void> => {
  await act(async () => {
    for (let turn = 0; turn < 10; turn++) {
      await Promise.resolve();
    }
  });
};

/**
 * Probe component that surfaces the hook's value as text.
 * @param props - hook options plus the scope wiring
 */
function Probe({ scoped, settleOn }: { scoped: boolean; settleOn?: 'ready' | 'rendered' }): React.ReactElement {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const ready = useBlokReady({
    within: scoped ? scopeRef : undefined,
    settleOn,
  });

  return (
    <div>
      {/*
        Kept childless on the React side: the test appends editor wrappers into
        it imperatively (as BlokContent does with the editor holder), and React
        would otherwise reconcile them away on re-render.
      */}
      <div ref={scopeRef} data-testid="scope" />
      <span data-testid="state">{ready ? 'ready' : 'pending'}</span>
    </div>
  );
}

describe('useBlokReady', () => {
  afterEach(() => {
    created.forEach((instance) => unregisterInstance(instance.key));
    created.length = 0;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('reports pending while an instance boots and ready once it settles', async () => {
    const view = render(<Probe scoped={false} />);
    const scope = view.getByTestId('scope');
    const instance = bootInstance(scope);

    await flush();
    expect(view.getByTestId('state').textContent).toBe('pending');

    act(() => instance.settle());
    await flush();

    expect(view.getByTestId('state').textContent).toBe('ready');
  });

  it('ignores instances mounted outside the scope', async () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);

    const view = render(<Probe scoped />);
    const scope = view.getByTestId('scope');
    const inside = bootInstance(scope);

    bootInstance(outside);

    await flush();
    expect(view.getByTestId('state').textContent).toBe('pending');

    // Only the in-scope instance settles; the outside one is still booting.
    act(() => inside.settle());
    await flush();

    expect(view.getByTestId('state').textContent).toBe('ready');
  });

  it('re-arms when a post-boot re-render clears the rendered attribute', async () => {
    const view = render(<Probe scoped settleOn="rendered" />);
    const scope = view.getByTestId('scope');
    const instance = bootInstance(scope);

    act(() => instance.settle());
    await flush();
    expect(view.getByTestId('state').textContent).toBe('pending');

    act(() => instance.wrapper.setAttribute('data-blok-rendered', ''));
    await flush();
    expect(view.getByTestId('state').textContent).toBe('ready');

    // render(data) on a changed prop clears the gate — the hook must follow,
    // not stay latched from the first boot.
    act(() => instance.wrapper.removeAttribute('data-blok-rendered'));
    await flush();
    expect(view.getByTestId('state').textContent).toBe('pending');

    act(() => instance.wrapper.setAttribute('data-blok-rendered', ''));
    await flush();
    expect(view.getByTestId('state').textContent).toBe('ready');
  });
});
