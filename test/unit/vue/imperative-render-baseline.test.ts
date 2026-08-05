/**
 * D5 (Vue parity): `<BlokEditor>`'s exposed `render()` changes the content OUT
 * OF BAND of the controlled `data` prop, so it must report the document it just
 * rendered as the adapter's content baseline.
 *
 * Without that report the baseline still names the document the editor showed
 * BEFORE the imperative call, and a controlled `data` set back to that document
 * is dismissed as an unchanged value — the editor keeps showing whatever
 * `render()` put there while the host's state says otherwise. React closes this
 * through `useBlokHandle` and Angular through `BlokEditorComponent.render`; this
 * pins the Vue half of the same contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry, type MockBlokInstance } from './mock-blok';
import { BlokEditor } from '../../../packages/vue/src/BlokEditor';
import type { OutputData } from '@/types';

/** The curated facade `<BlokEditor>` exposes to a template ref. */
interface ExposedEditor {
  instance: unknown;
  save: () => Promise<OutputData> | undefined;
  focus: (atEnd?: boolean) => void;
  render: (data: OutputData) => Promise<void> | undefined;
}

const DOC_A: OutputData = {
  blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }],
};
const DOC_B: OutputData = {
  blocks: [{ id: '2', type: 'paragraph', data: { text: 'b' } }],
};

/** Mount `<BlokEditor>` with a reactive `data` prop and resolve the editor. */
async function mountReady(
  initial: OutputData
): Promise<{ props: { data: OutputData }; api: ExposedEditor; instance: MockBlokInstance }> {
  const props = reactive({ data: initial });
  const api = ref<ExposedEditor | null>(null);

  const Harness = defineComponent({
    setup() {
      return () => h(BlokEditor, { data: props.data, ref: api });
    },
  });

  mount(Harness);

  const instance = blokRegistry.last;

  if (instance === undefined) {
    throw new Error('editor was not constructed');
  }

  instance.resolveReady();
  await flushPromises();

  const exposed = api.value;

  if (exposed === null) {
    throw new Error('BlokEditor did not expose its facade');
  }

  return { props, api: exposed, instance };
}

describe('BlokEditor imperative render + controlled data', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-renders a controlled document the imperative render() replaced', async () => {
    const { props, api, instance } = await mountReady(DOC_A);

    // Out of band: the editor now shows B while the controlled prop still says A.
    await api.render(DOC_B);
    expect(instance.render).toHaveBeenCalledWith(DOC_B);

    // The host puts its own state back — a real change from what the editor
    // holds, so it must render, not be deduped against a stale baseline.
    props.data = { ...DOC_A };
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(2);
    expect(instance.render).toHaveBeenLastCalledWith(expect.objectContaining({ blocks: DOC_A.blocks }));
  });

  it('still dedupes a controlled echo of the document render() just installed', async () => {
    const { props, api, instance } = await mountReady(DOC_A);

    await api.render(DOC_B);
    expect(instance.render).toHaveBeenCalledTimes(1);

    // The host mirrors the imperative result into its own state: same content,
    // so nothing to re-render (and no caret reset).
    props.data = { ...DOC_B };
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(1);
  });

  it('does not move the baseline when the imperative render rejects', async () => {
    const { props, api, instance } = await mountReady(DOC_A);

    instance.render.mockRejectedValueOnce(new Error('boom'));

    await expect(api.render(DOC_B)).rejects.toThrow('boom');

    // The editor never left A, so a controlled change to B is still a real change.
    props.data = { ...DOC_B };
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(2);
    expect(instance.render).toHaveBeenLastCalledWith(expect.objectContaining({ blocks: DOC_B.blocks }));
  });
});
