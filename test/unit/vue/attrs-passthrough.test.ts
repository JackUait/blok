import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../src/vue/BlokEditor';

describe('BlokEditor $attrs passthrough', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards id / class / aria-* / data-* onto the editor container', async () => {
    const wrapper = mount(BlokEditor, {
      attrs: {
        id: 'my-editor',
        class: 'editor-host',
        'aria-label': 'Document body',
        'data-blok-testid': 'host',
      },
    });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const container = wrapper.element as HTMLElement;

    expect(container.id).toBe('my-editor');
    expect(container.classList.contains('editor-host')).toBe(true);
    expect(container.getAttribute('aria-label')).toBe('Document body');
    expect(container.getAttribute('data-blok-testid')).toBe('host');
  });

  it('mounts the editor holder inside the same container that received the attrs', async () => {
    const wrapper = mount(BlokEditor, { attrs: { 'data-blok-testid': 'host' } });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const container = wrapper.get('[data-blok-testid="host"]').element;

    expect(container.childElementCount).toBe(1); // the adopted holder div
  });

  it('does not leak declared config props (readOnly / style) onto the container as attributes', async () => {
    const wrapper = mount(BlokEditor, {
      props: { readOnly: true, style: { fontFamily: 'Inter' } },
      attrs: { 'data-blok-testid': 'host' },
    });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const container = wrapper.element as HTMLElement;

    expect(container.hasAttribute('readonly')).toBe(false);
    // `style` is the editor style-config object, not a CSS inline style.
    expect(container.getAttribute('style')).toBeNull();
    expect((blokRegistry.last!.config as { style?: unknown }).style).toEqual({ fontFamily: 'Inter' });
  });
});
