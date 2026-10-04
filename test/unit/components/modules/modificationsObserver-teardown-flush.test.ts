import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { Header } from '../../../../src/tools/header';
import { Renderer } from '../../../../src/components/modules/renderer';
import { ModificationsObserver } from '../../../../src/components/modules/modificationsObserver';
import { Saver } from '../../../../src/components/modules/saver';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * A real editor torn down inside the last batch window: the edit must still
 * reach the host.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

/**
 * The API groups Blok attaches at runtime, which its class type does not declare.
 */
type LiveEditor = TestEditor & {
  blocks: { renderFromHTML: (html: string) => Promise<void> };
  i18n: { update: (options: { messages: Record<string, string> }) => Promise<void> };
  readOnly: { set: (state: boolean) => Promise<boolean> };
};

/**
 * Has no setReadOnly, so a read-only flip takes the full save/clear/render path.
 */
class NoInPlaceToggleTool {
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

const BLOCKS: OutputBlockData[] = [
  { id: 'p1', type: 'paragraph', data: { text: 'before' } },
  { id: 'tbl', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }]] } },
  { id: 'c00', type: 'paragraph', data: { text: 'a' }, parent: 'tbl' },
  { id: 'c01', type: 'paragraph', data: { text: 'b' }, parent: 'tbl' },
];

let holder: HTMLDivElement;
let editor: TestEditor | undefined;

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const typeInto = (blockId: string, text: string): void => {
  const editable = holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-tool="paragraph"]`);

  if (editable === null) {
    throw new Error(`no editable for ${blockId}`);
  }

  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
};

const textOf = (doc: OutputData, id: string): unknown => doc.blocks.find((block) => block.id === id)?.data.text;

describe('ModificationsObserver — final flush on teardown (real editor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('delivers an edit made right before destroy() to onSave', async () => {
    const onSave = vi.fn<(data: OutputData) => void>();
    const onError = vi.fn();
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      data: { blocks: structuredClone(BLOCKS) },
      onSave,
      onError,
    });

    await editor.isReady;
    await wait(600);

    typeInto('p1', 'last words');
    typeInto('c01', 'b-last');
    await wait(50);
    editor.destroy();
    editor = undefined;
    await wait(600);

    const saved = onSave.mock.calls.map(([data]) => data);

    expect(saved.map((doc) => textOf(doc, 'p1'))).toContain('last words');
    expect(saved.map((doc) => textOf(doc, 'c01'))).toContain('b-last');
    expect(onError).not.toHaveBeenCalled();
  }, 60_000);

  it('delivers an edit made right before destroy() to persistence.save', async () => {
    const save = vi.fn<(data: OutputData) => Promise<void>>(() => Promise.resolve());
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      persistence: {
        load: () => Promise.resolve({ blocks: structuredClone(BLOCKS) }),
        save,
      },
    });

    await editor.isReady;
    await wait(600);

    typeInto('c01', 'b-last');
    await wait(50);
    editor.destroy();
    editor = undefined;
    await wait(600);

    expect(save.mock.calls.map(([data]) => textOf(data, 'c01'))).toContain('b-last');
  }, 60_000);

  it('does not call onSave on destroy() when nothing changed', async () => {
    const onSave = vi.fn();
    editor = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      data: { blocks: structuredClone(BLOCKS) },
      onSave,
    });

    await editor.isReady;
    await wait(600);
    editor.destroy();
    editor = undefined;
    await wait(600);

    expect(onSave).not.toHaveBeenCalled();
  }, 60_000);

  it('does not hand persistence.save a half-built document when destroyed during renderFromHTML', async () => {
    const save = vi.fn<(data: OutputData) => Promise<void>>(() => Promise.resolve());
    const live = new Blok({
      holder,
      tools: { paragraph: Paragraph, header: Header },
      persistence: {
        load: () => Promise.resolve({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] }),
        save,
      },
    }) as unknown as LiveEditor;

    editor = live;
    await live.isReady;
    await wait(600);

    typeInto('p1', 'typed');
    await wait(20);

    // Header has rendered(), so each pasted heading waits a frame: the import
    // spans several tasks, and a host can destroy the editor in between.
    void live.blocks.renderFromHTML('<h2>A</h2><p>one</p><h2>B</h2><p>two</p>').catch(() => undefined);
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
    live.destroy();
    editor = undefined;
    await wait(1000);

    const saved = save.mock.calls.map(([data]) => data.blocks.map((block) => block.data.text));

    expect(saved.filter((texts) => texts.join('|') !== 'A|one|B|two')).toEqual([]);
  }, 60_000);

  it('delivers an edit made right before an i18n repaint that destroy() interrupts', async () => {
    const onSave = vi.fn<(data: OutputData) => void>();
    const live = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] },
      onSave,
    }) as unknown as LiveEditor;

    editor = live;
    await live.isReady;
    await wait(600);

    typeInto('p1', 'typed');
    await wait(20);

    const markRenderStart = Renderer.prototype.markRenderStart;

    vi.spyOn(Renderer.prototype, 'markRenderStart').mockImplementation(function (this: Renderer) {
      markRenderStart.call(this);
      queueMicrotask(() => live.destroy());
    });

    // Messages only: a locale change would add a lazy locale load to the timing.
    void live.i18n.update({ messages: { 'blockSettings.delete': 'X' } }).catch(() => undefined);
    await wait(1000);
    editor = undefined;

    expect(onSave.mock.calls.map(([data]) => textOf(data, 'p1'))).toContain('typed');
  }, 60_000);

  it('delivers an edit made right before an i18n repaint that destroy() interrupts to persistence.save', async () => {
    const save = vi.fn<(data: OutputData) => Promise<void>>(() => Promise.resolve());
    const live = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      persistence: {
        load: () => Promise.resolve({ blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] }),
        save,
      },
    }) as unknown as LiveEditor;

    editor = live;
    await live.isReady;
    await wait(600);

    typeInto('p1', 'typed');
    await wait(20);

    // Destroy as soon as the repaint has started its early save.
    const disable = ModificationsObserver.prototype.disable;

    vi.spyOn(ModificationsObserver.prototype, 'disable').mockImplementation(function (this: ModificationsObserver) {
      disable.call(this);
      live.destroy();
    });

    void live.i18n.update({ messages: { 'blockSettings.delete': 'X' } }).catch(() => undefined);
    await wait(1000);
    editor = undefined;

    expect(save.mock.calls.map(([data]) => textOf(data, 'p1'))).toContain('typed');
  }, 60_000);

  it('delivers the trailing onChange of a window an i18n repaint cuts short', async () => {
    type ChangeEvent = { detail: { target: { id: string } } };
    const onChange = vi.fn<(api: unknown, event: ChangeEvent | ChangeEvent[]) => void>();
    const live = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'one' } },
        { id: 'p2', type: 'paragraph', data: { text: 'two' } },
      ] },
      onChange,
      onSave: () => undefined,
    }) as unknown as LiveEditor;

    editor = live;
    await live.isReady;
    await wait(600);

    typeInto('p1', 'one!');
    await wait(20);
    onChange.mockClear();
    typeInto('p2', 'two!');
    await wait(20);

    await live.i18n.update({ messages: { 'blockSettings.delete': 'X' } });
    await wait(1000);

    const targets = onChange.mock.calls.flatMap(([, event]) => (Array.isArray(event) ? event : [event]).map((item) => item.detail.target.id));

    expect(targets).toContain('p2');
  }, 60_000);

  it('delivers an edit made before an i18n repaint exactly once', async () => {
    const onSave = vi.fn<(data: OutputData) => void>();
    const live = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] },
      onSave,
    }) as unknown as LiveEditor;

    editor = live;
    await live.isReady;
    await wait(600);

    typeInto('p1', 'typed');
    await wait(20);

    await live.i18n.update({ messages: { 'blockSettings.delete': 'X' } });
    await wait(1000);

    expect(onSave.mock.calls.map(([data]) => textOf(data, 'p1'))).toEqual(['typed']);
  }, 60_000);

  describe.each([
    { path: 'in-place', tools: { paragraph: Paragraph } },
    { path: 'full re-render', tools: { paragraph: Paragraph, plain: NoInPlaceToggleTool } },
  ])('read-only turned on right before destroy() ($path)', ({ tools }) => {
    it('delivers the edit made while editable', async () => {
      const onSave = vi.fn<(data: OutputData) => void>();
      const live = new Blok({
        holder,
        tools,
        data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] },
        onSave,
      }) as unknown as LiveEditor;

      editor = live;
      await live.isReady;
      await wait(600);

      typeInto('p1', 'typed');
      await wait(20);
      await live.readOnly.set(true);
      live.destroy();
      editor = undefined;
      await wait(600);

      expect(onSave.mock.calls.map(([data]) => textOf(data, 'p1'))).toEqual(['typed']);
    }, 60_000);

    it('delivers the edit when destroy() lands before the read-only switch settles', async () => {
      const onSave = vi.fn<(data: OutputData) => void>();
      const live = new Blok({
        holder,
        tools,
        data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] },
        onSave,
      }) as unknown as LiveEditor;

      editor = live;
      await live.isReady;
      await wait(600);

      typeInto('p1', 'typed');
      await wait(20);
      void live.readOnly.set(true).catch(() => undefined);
      live.destroy();
      editor = undefined;
      await wait(600);

      expect(onSave.mock.calls.map(([data]) => textOf(data, 'p1'))).toEqual(['typed']);
    }, 60_000);

    it('delivers the edit once across a read-only round trip', async () => {
      const onSave = vi.fn<(data: OutputData) => void>();
      const live = new Blok({
        holder,
        tools,
        data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] },
        onSave,
      }) as unknown as LiveEditor;

      editor = live;
      await live.isReady;
      await wait(600);

      typeInto('p1', 'typed');
      await wait(20);
      await live.readOnly.set(true);
      await wait(600);
      await live.readOnly.set(false);
      await wait(600);

      expect(onSave.mock.calls.map(([data]) => textOf(data, 'p1'))).toEqual(['typed']);
    }, 60_000);

    it('does not call onSave when nothing was typed', async () => {
      const onSave = vi.fn();
      const live = new Blok({
        holder,
        tools,
        data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] },
        onSave,
      }) as unknown as LiveEditor;

      editor = live;
      await live.isReady;
      await wait(600);

      await live.readOnly.set(true);
      live.destroy();
      editor = undefined;
      await wait(600);

      expect(onSave).not.toHaveBeenCalled();
    }, 60_000);
  });

  it('delivers an edit held through read-only when leaving read-only is interrupted by destroy()', async () => {
    const onSave = vi.fn<(data: OutputData) => void>();
    const live = new Blok({
      holder,
      tools: { paragraph: Paragraph, plain: NoInPlaceToggleTool },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'before' } }] },
      onSave,
    }) as unknown as LiveEditor;

    editor = live;
    await live.isReady;
    await wait(600);

    typeInto('p1', 'typed');
    await wait(20);

    // The save made on the way into read-only fails, so the edit is still
    // unsaved while read-only.
    vi.spyOn(Saver.prototype, 'saveBeforeTeardown').mockResolvedValueOnce(undefined);
    await live.readOnly.set(true);
    await wait(600);

    expect(onSave).not.toHaveBeenCalled();

    const markRenderStart = Renderer.prototype.markRenderStart;

    vi.spyOn(Renderer.prototype, 'markRenderStart').mockImplementation(function (this: Renderer) {
      markRenderStart.call(this);
      queueMicrotask(() => live.destroy());
    });

    void live.readOnly.set(false).catch(() => undefined);
    await wait(1000);
    editor = undefined;

    expect(onSave.mock.calls.map(([data]) => textOf(data, 'p1'))).toContain('typed');
  }, 60_000);
});
