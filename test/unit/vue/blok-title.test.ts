import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref, type PropType } from 'vue';

import { BlokEditor } from '../../../packages/vue/src/BlokEditor';
import { BlokTitle } from '../../../packages/vue/src/BlokTitle';
import { Paragraph } from '../../../src/tools/paragraph';
import RawBlok from '../../../src/blok';
import type { Blok } from '@/types';

const TOOLS = { paragraph: { class: Paragraph } };
const HEADER = '[data-blok-page-header]';

interface EditorExposed {
  instance: Blok | null;
}

/** The documented wiring: BlokEditor's exposed `instance` feeds BlokTitle. */
const Harness = defineComponent({
  props: {
    showTitle: { type: Boolean, default: true },
    recreateKey: { type: String, default: 'a' },
    onEditor: { type: Function as PropType<(editor: Blok | null) => void>, default: undefined },
  },
  setup(props) {
    const editorRef = ref<EditorExposed | null>(null);

    return () => {
      const editor = editorRef.value?.instance ?? null;

      props.onEditor?.(editor);

      return h('div', [
        props.showTitle ? h(BlokTitle, { editor, 'data-testid': 'title-host' }) : null,
        h(BlokEditor, {
          ref: editorRef,
          tools: TOOLS,
          pageTitle: true,
          recreateKey: props.recreateKey,
          'data-testid': 'editor-host',
        }),
      ]);
    };
  },
});

const mounted: VueWrapper[] = [];

const mountHarness = (props: Record<string, unknown> = {}): VueWrapper => {
  const wrapper = mount(Harness, { props, attachTo: document.body });

  mounted.push(wrapper);

  return wrapper;
};

const titleHost = (): HTMLElement => {
  const host = document.querySelector<HTMLElement>('[data-testid="title-host"]');

  if (host === null) {
    throw new Error('no title host');
  }

  return host;
};

const waitForHeaderIn = async (): Promise<void> => {
  await vi.waitFor(() => expect(titleHost().querySelector(HEADER)).not.toBeNull(), { timeout: 5000 });
};

describe('Vue BlokTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders an empty div for a null editor', () => {
    const wrapper = mount(BlokTitle, { props: { editor: null } });

    mounted.push(wrapper);

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.element.childNodes).toHaveLength(0);
  });

  it('puts the header inside its div once the editor is ready', async () => {
    mountHarness();

    await waitForHeaderIn();

    expect(titleHost().querySelectorAll(HEADER)).toHaveLength(1);
    expect(document.querySelectorAll(HEADER)).toHaveLength(1);
  });

  it('puts the header back above the first block when it unmounts while the editor lives', async () => {
    const seen: { editor: Blok | null } = { editor: null };
    const wrapper = mountHarness({
      onEditor: (editor: Blok | null) => {
        seen.editor = editor;
      },
    });

    await waitForHeaderIn();
    const editor = seen.editor;

    if (editor === null) {
      throw new Error('no editor');
    }
    const host = titleHost();
    const connectedAtUnmount: boolean[] = [];
    const realMount = editor.title.mount.bind(editor.title);

    vi.spyOn(editor.title, 'mount').mockImplementation((holder) => {
      if (holder === null) {
        connectedAtUnmount.push(host.isConnected);
      }
      realMount(holder);
    });

    await wrapper.setProps({ showTitle: false });

    const header = document.querySelector(HEADER);
    const editorWrapper = document.querySelector('[data-testid="editor-host"] [data-blok-editor]');

    expect(header?.parentElement).toBe(editorWrapper);
    expect(header?.nextElementSibling).toBe(editorWrapper?.querySelector('[data-blok-redactor]'));
    expect(connectedAtUnmount).toEqual([true]);
  });

  it('works with the documented exposed instance', async () => {
    const seen: { editor: Blok | null } = { editor: null };

    mountHarness({
      onEditor: (editor: Blok | null) => {
        seen.editor = editor;
      },
    });

    await waitForHeaderIn();

    expect(seen.editor?.title.get()).toBe('');
  });

  it('takes the new editor header when the editor is recreated', async () => {
    const wrapper = mountHarness({ recreateKey: 'a' });

    await waitForHeaderIn();
    const oldHeader = titleHost().querySelector(HEADER);

    await wrapper.setProps({ recreateKey: 'b' });

    await vi.waitFor(
      () => {
        const current = titleHost().querySelector(HEADER);

        expect(current).not.toBeNull();
        expect(current).not.toBe(oldHeader);
      },
      { timeout: 5000 }
    );

    expect(titleHost().querySelectorAll(HEADER)).toHaveLength(1);
    expect(document.querySelectorAll(HEADER)).toHaveLength(1);
  });

  it('passes extra attributes through', () => {
    const wrapper = mount(BlokTitle, { props: { editor: null }, attrs: { class: 'page-title', id: 'title' } });

    mounted.push(wrapper);

    expect(wrapper.element.className).toBe('page-title');
    expect(wrapper.element.id).toBe('title');
  });

  it('gives the title back to an editor the adapter did not create', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    // The src class gets its module APIs by a prototype swap at boot; the published type lists them.
    const editor = new RawBlok({ holder, tools: TOOLS, pageTitle: true }) as unknown as Blok;

    await editor.isReady;
    const wrapper = mount(BlokTitle, { props: { editor }, attachTo: document.body });

    expect(wrapper.element.querySelector(HEADER)).not.toBeNull();
    wrapper.unmount();

    const header = holder.querySelector(HEADER);
    const editorWrapper = holder.querySelector('[data-blok-editor]');

    expect(header?.parentElement).toBe(editorWrapper);
    expect(header?.nextElementSibling).toBe(editorWrapper?.querySelector('[data-blok-redactor]'));
    editor.destroy();
  });

  it('renders no slot content', () => {
    const wrapper = mount(BlokTitle, { props: { editor: null }, slots: { default: () => h('span', 'child') } });

    mounted.push(wrapper);

    expect(wrapper.element.childNodes).toHaveLength(0);
  });
});
