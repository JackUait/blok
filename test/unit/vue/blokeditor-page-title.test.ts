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
});
