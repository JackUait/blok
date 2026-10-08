import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

import { BlokEditor } from '../../../packages/vue/src/BlokEditor';
import { Paragraph } from '../../../src/tools/paragraph';
import type { Blok, BlokConfig } from '@/types';

const TOOLS = { paragraph: { class: Paragraph } };

const mounted: VueWrapper[] = [];

const mountEditor = (props: Record<string, unknown>): VueWrapper => {
  const wrapper = mount(BlokEditor, { props: { tools: TOOLS, ...props }, attachTo: document.body });

  mounted.push(wrapper);

  return wrapper;
};

const readyEditor = async (wrapper: VueWrapper): Promise<Blok> => {
  await vi.waitFor(() => expect(wrapper.emitted('ready')).toBeDefined(), { timeout: 5000 });
  const events = wrapper.emitted('ready') ?? [];
  const editor: unknown = events[events.length - 1][0];

  return editor as Blok;
};

describe('Vue BlokEditor pageTitle prop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('forwards pageTitle into the editor config', async () => {
    const pageTitle: BlokConfig['pageTitle'] = { placeholder: 'Untitled' };
    const wrapper = mountEditor({ pageTitle });

    await readyEditor(wrapper);

    const title = wrapper.element.querySelector('[data-blok-testid="page-header-title"]');

    expect(title).not.toBeNull();
    expect(title?.getAttribute('data-placeholder')).toBe('Untitled');
  });

  it('loads the title from data', async () => {
    const wrapper = mountEditor({ pageTitle: true, data: { title: 'T', blocks: [] } });
    const editor = await readyEditor(wrapper);

    expect(editor.title.get()).toBe('T');
  });

  it('calls the onChange of the latest props', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const wrapper = mountEditor({ pageTitle: { onChange: a } });
    const editor = await readyEditor(wrapper);

    await wrapper.setProps({ pageTitle: { onChange: b } });

    // A recreated editor would call b with no fix at all.
    expect(wrapper.emitted('ready')).toHaveLength(1);
    editor.title.set('x');

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith('x', { source: 'api' });
  });

  it('calls the onIconChange of the latest props', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const wrapper = mountEditor({ pageTitle: { onIconChange: a } });
    const editor = await readyEditor(wrapper);

    await wrapper.setProps({ pageTitle: { onIconChange: b } });

    expect(wrapper.emitted('ready')).toHaveLength(1);
    editor.title.icon.set({ type: 'emoji', value: '🚀' });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('hears an onChange added after mounting with pageTitle: true', async () => {
    const b = vi.fn();
    const wrapper = mountEditor({ pageTitle: true });
    const editor = await readyEditor(wrapper);

    await wrapper.setProps({ pageTitle: { onChange: b } });

    expect(wrapper.emitted('ready')).toHaveLength(1);
    editor.title.set('x');

    expect(b).toHaveBeenCalledTimes(1);
  });
});
