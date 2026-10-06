import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import { BlokEditor } from '../../../packages/react/src/BlokEditor';

const configs: Record<string, unknown>[] = [];

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
    constructor(config: Record<string, unknown> & { holder: HTMLElement }) {
      const wrapper = document.createElement('div');

      wrapper.setAttribute('data-blok-editor', 'true');
      config.holder.appendChild(wrapper);
      configs.push(config);
    }
  },
}));

describe('BlokEditor richText prop', () => {
  beforeEach(() => {
    configs.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes richText into the editor config', async () => {
    render(<BlokEditor richText="segments" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(configs).toHaveLength(1);
    expect(configs[0].richText).toBe('segments');
  });
});
