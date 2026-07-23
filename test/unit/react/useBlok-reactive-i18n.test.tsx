/**
 * Reactive `i18n` in the React adapter.
 *
 * `i18n` was routed into the editor config once at construction and never read
 * again, so a host wired to a language switcher had no correct option: leave
 * the editor chrome in the old language, or bump `deps` and destroy the editor
 * mid-typing (losing caret, focus, selection and undo stack). A `useMemo`d
 * translation map recomputing on locale change was inert by design.
 *
 * `i18n` now flows through the runtime `editor.i18n.update()` API, deduped by
 * deep equality so a fresh object literal with identical contents is a no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import { useBlok } from '../../../packages/react/src/useBlok';
import { BlokContent } from '../../../packages/react/src/BlokContent';
import type { UseBlokConfig } from '../../../packages/react/src/types';

interface MockInstance {
  i18n: { update: ReturnType<typeof vi.fn> };
  destroy: ReturnType<typeof vi.fn>;
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
    public tokens = { set: vi.fn(), get: vi.fn().mockReturnValue({}) };
    public i18n = { update: vi.fn().mockResolvedValue(undefined) };
    public tools = { update: vi.fn() };
    public render = vi.fn();
    public config: { holder: HTMLElement };
    constructor(config: { holder: HTMLElement }) {
      this.config = config;
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      instances.push(this);
    }
  },
}));

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  const editor = useBlok(config);

  return <BlokContent editor={editor} data-testid="container" />;
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useBlok reactive i18n', () => {
  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes a locale change through editor.i18n.update without recreating', async () => {
    const { rerender } = render(<Harness config={{ i18n: { locale: 'en' } }} />);

    await flush();
    expect(instances).toHaveLength(1);
    expect(instances[0].i18n.update).not.toHaveBeenCalled();

    rerender(<Harness config={{ i18n: { locale: 'ru' } }} />);
    await flush();

    expect(instances).toHaveLength(1);
    expect(instances[0].i18n.update).toHaveBeenCalledWith({ locale: 'ru' });
  });

  it('pushes changed messages through editor.i18n.update', async () => {
    const { rerender } = render(<Harness config={{ i18n: { locale: 'en' } }} />);

    await flush();

    rerender(<Harness config={{ i18n: { locale: 'en', messages: { 'a11y.insertBlock': 'Add' } } }} />);
    await flush();

    expect(instances[0].i18n.update).toHaveBeenCalledWith({
      locale: 'en',
      messages: { 'a11y.insertBlock': 'Add' },
    });
  });

  it('ignores a re-created object literal with identical contents', async () => {
    const { rerender } = render(<Harness config={{ i18n: { locale: 'ru', messages: { a: 'b' } } }} />);

    await flush();

    rerender(<Harness config={{ i18n: { locale: 'ru', messages: { a: 'b' } } }} />);
    await flush();

    expect(instances[0].i18n.update).not.toHaveBeenCalled();
  });

  it('costs nothing for a host that passes no i18n prop', async () => {
    const { rerender } = render(<Harness config={{ placeholder: 'a' }} />);

    await flush();

    rerender(<Harness config={{ placeholder: 'b' }} />);
    await flush();

    expect(instances[0].i18n.update).not.toHaveBeenCalled();
  });

  /**
   * `direction` is part of the live surface: `config.i18n.direction` is read
   * by the `isRtl` getter and the wrapper is re-stamped on update, so an
   * explicit override must reach the editor rather than being dropped.
   */
  it('forwards an explicit direction override', async () => {
    const { rerender } = render(<Harness config={{ i18n: { locale: 'en' } }} />);

    await flush();

    rerender(<Harness config={{ i18n: { locale: 'en', direction: 'rtl' } }} />);
    await flush();

    expect(instances[0].i18n.update).toHaveBeenCalledWith({ locale: 'en', direction: 'rtl' });
  });
});
