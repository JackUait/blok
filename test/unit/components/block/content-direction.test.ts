/**
 * Per-block base direction. A block's content element carries `dir` from the
 * first strong letter of its own text, so an Arabic paragraph in an LTR editor
 * reads RTL and an English one in an RTL editor reads LTR. A block with no
 * strong letter (empty, "123") carries no `dir` and follows the editor.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ToggleItem } from '../../../../src/tools/toggle';
import { CalloutTool } from '../../../../src/tools/callout';
import { ColumnList } from '../../../../src/tools/column-list';
import { Column } from '../../../../src/tools/column';
import { Table } from '../../../../src/tools/table';
import { ListItem } from '../../../../src/tools/list';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  readOnly: { toggle: (state?: boolean) => Promise<boolean> };
  blocks: { update: (id: string, data: Record<string, unknown>) => Promise<unknown> };
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
  module: {
    yjsManager: {
      stopCapturing: () => void;
      applyRemoteUpdate: (update: Uint8Array) => void;
      encodeStateAsUpdate: (stateVector?: Uint8Array) => Uint8Array;
      getStateVector: () => Uint8Array;
    };
  };
}

/**
 * A tool whose editable sits under its own `dir="ltr"`, the way the code
 * block pins its source text.
 */
class PinnedTool {
  public static isReadOnlySupported = true;

  private readonly text: string;

  public constructor({ data }: { data: { text?: string } }) {
    this.text = data.text ?? '';
  }

  public render(): HTMLElement {
    const root = document.createElement('div');
    const field = document.createElement('div');

    field.setAttribute('dir', 'ltr');
    field.contentEditable = 'true';
    field.textContent = this.text;
    root.appendChild(field);

    return root;
  }

  public save(): { text: string } {
    return { text: this.text };
  }
}

/**
 * A tool with a non-editable label before its text field, the way chrome
 * text sits inside some tools.
 */
class LabelledTool {
  public static isReadOnlySupported = true;

  private readonly text: string;

  private readonly readOnly: boolean;

  public constructor({ data, readOnly }: { data: { text?: string }; readOnly: boolean }) {
    this.text = data.text ?? '';
    this.readOnly = readOnly;
  }

  public render(): HTMLElement {
    const root = document.createElement('div');
    const label = document.createElement('span');
    const text = document.createElement('div');

    label.contentEditable = 'false';
    label.textContent = 'Label';
    text.contentEditable = this.readOnly ? 'false' : 'true';
    text.textContent = this.text;
    root.append(label, text);

    return root;
  }

  public save(): { text: string } {
    return { text: this.text };
  }
}

/** Same, with the label marked as tool chrome. */
class ChromeLabelledTool extends LabelledTool {
  public render(): HTMLElement {
    const root = super.render();

    root.firstElementChild?.setAttribute('data-blok-chrome', '');

    return root;
  }
}

const tools = {
  paragraph: Paragraph,
  header: Header,
  toggle: ToggleItem,
  callout: CalloutTool,
  column_list: ColumnList,
  column: Column,
  table: Table,
  list: ListItem,
  database: DatabaseTool,
  'database-row': DatabaseRowTool,
  pinned: PinnedTool,
  labelled: LabelledTool,
  chromeLabelled: ChromeLabelledTool,
};

const P = (id: string, text: string, parent?: string): OutputBlockData => ({
  id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }),
});

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

/** Lets mutation observers, the onChange batch window and RAF-held windows settle. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, modificationsObserverBatchTimeout + 50));
  await frames(3);
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement;

const boot = async (blocks: OutputBlockData[], config: Record<string, unknown> = {}): Promise<TestEditor> => {
  const instance = new Blok({ holder, tools, data: { blocks }, ...config }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await new Promise(resolve => setTimeout(resolve, 0));
  await frames(3);
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const content = (id: string): HTMLElement => {
  const element = holder.querySelector<HTMLElement>(`[data-blok-id="${id}"] [data-blok-element-content]`);

  if (element === null) {
    throw new Error(`no content element for ${id}`);
  }

  return element;
};

const field = (id: string): HTMLElement => {
  const element = content(id).querySelector<HTMLElement>('[contenteditable]');

  if (element === null) {
    throw new Error(`no editable in ${id}`);
  }

  return element;
};

/** Types by rewriting the field's text, which the editor sees as a DOM mutation. */
const typeInto = async (id: string, text: string): Promise<void> => {
  field(id).textContent = text;
  field(id).dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * jsdom keeps `contentEditable` as a plain property. Browsers reflect it to the
 * attribute, which is what the stamp reads.
 */
const reflectContentEditable = (): (() => void) => {
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable');

  Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('contenteditable') ?? 'inherit';
    },
    set(this: HTMLElement, value: string) {
      this.setAttribute('contenteditable', String(value));
    },
  });

  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, 'contentEditable');
    } else {
      Object.defineProperty(HTMLElement.prototype, 'contentEditable', previous);
    }
  };
};

describe('per-block content direction', () => {
  let restoreContentEditable: () => void = () => undefined;

  beforeAll(() => {
    restoreContentEditable = reflectContentEditable();
  });

  afterAll(() => {
    restoreContentEditable();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('render', () => {
    it('stamps each block from its own first strong letter', async () => {
      await boot([
        P('ar', 'مرحبا بالعالم!'),
        P('en', 'Hello!'),
        P('num', '123'),
        P('empty', ''),
      ]);

      expect(content('ar').getAttribute('dir')).toBe('rtl');
      expect(content('en').getAttribute('dir')).toBe('ltr');
      expect(content('num').hasAttribute('dir')).toBe(false);
      expect(content('empty').hasAttribute('dir')).toBe(false);
    });

    it('lets neutral and empty blocks follow an RTL editor', async () => {
      await boot([P('en', 'Hello'), P('num', '123'), P('empty', '')], { i18n: { direction: 'rtl' } });

      expect(content('en').getAttribute('dir')).toBe('ltr');
      expect(content('num').hasAttribute('dir')).toBe(false);
      expect(content('empty').hasAttribute('dir')).toBe(false);
    });

    // A database is layout, not text: its title must not flip the whole grid.
    it('lets a database title carry its own direction without flipping the database', async () => {
      await boot([
        {
          id: 'db',
          type: 'database',
          data: {
            title: 'المهام',
            schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
            views: [{ id: 'v-list', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
            activeViewId: 'v-list',
          },
        },
      ]);

      const title = content('db').querySelector<HTMLElement>('[contenteditable]');

      expect(content('db').hasAttribute('dir')).toBe(false);
      expect(title?.getAttribute('dir')).toBe('auto');
    });

    it('stamps a read-only editor too', async () => {
      await boot([P('ar', 'مرحبا'), P('en', 'Hello')], { readOnly: true });

      expect(content('ar').getAttribute('dir')).toBe('rtl');
      expect(content('en').getAttribute('dir')).toBe('ltr');
    });

    it('keeps the stamp across a read-only toggle', async () => {
      const instance = await boot([P('ar', 'مرحبا')]);

      await instance.readOnly.toggle(true);
      await frames(2);

      expect(content('ar').getAttribute('dir')).toBe('rtl');

      await instance.readOnly.toggle(false);
      await frames(2);

      expect(content('ar').getAttribute('dir')).toBe('rtl');
    });

    // The "a." / "i." marker is chrome hidden from assistive tech, not text.
    it.each([1, 2])('reads a read-only Arabic list item at depth %i from its text, not its marker', async (depth) => {
      await boot([
        { id: 'root', type: 'list', data: { text: 'واحد', style: 'ordered', depth: 0 } },
        { id: 'deep', type: 'list', data: { text: 'مرحبا', style: 'ordered', depth } },
      ], { readOnly: true });

      expect(content('deep').getAttribute('dir')).toBe('rtl');
    });

    it('keeps an Arabic list item RTL across a read-only toggle', async () => {
      const instance = await boot([
        { id: 'root', type: 'list', data: { text: 'واحد', style: 'ordered', depth: 0 } },
        { id: 'deep', type: 'list', data: { text: 'مرحبا', style: 'ordered', depth: 1 } },
      ]);

      expect(content('deep').getAttribute('dir')).toBe('rtl');

      await instance.readOnly.toggle(true);
      await frames(2);

      expect(content('deep').getAttribute('dir')).toBe('rtl');
    });

    it('reads a header from its own text', async () => {
      await boot([{ id: 'h', type: 'header', data: { text: 'عنوان', level: 2 } }]);

      expect(content('h').getAttribute('dir')).toBe('rtl');
    });

    it('reads a toggle from its title, not from its children', async () => {
      await boot([
        { id: 't', type: 'toggle', data: { text: '', isOpen: true }, content: ['child'] },
        P('child', 'Hello', 't'),
        { id: 't2', type: 'toggle', data: { text: 'مرحبا', isOpen: true }, content: ['c-empty', 'c-num', 'c-en'] },
        P('c-empty', '', 't2'),
        P('c-num', '123', 't2'),
        P('c-en', 'Hello', 't2'),
      ]);

      expect(content('t').hasAttribute('dir')).toBe(false);
      expect(content('child').getAttribute('dir')).toBe('ltr');

      expect(content('t2').getAttribute('dir')).toBe('rtl');
      expect(content('c-empty').hasAttribute('dir')).toBe(false);
      expect(content('c-num').hasAttribute('dir')).toBe(false);
      expect(content('c-en').getAttribute('dir')).toBe('ltr');
    });

    it('leaves a container with no text of its own unstamped', async () => {
      await boot([
        { id: 'call', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['in-call'] },
        P('in-call', 'مرحبا', 'call'),
      ]);

      expect(content('call').hasAttribute('dir')).toBe(false);
      expect(content('in-call').getAttribute('dir')).toBe('rtl');
    });

    it('lets a pinned dir inside the tool win over the text', async () => {
      await boot([{ id: 'pin', type: 'pinned', data: { text: 'مرحبا' } }]);

      expect(content('pin').hasAttribute('dir')).toBe(false);
    });

    it('ignores non-editable chrome text while editing', async () => {
      await boot([{ id: 'lab', type: 'labelled', data: { text: 'مرحبا' } }]);

      expect(content('lab').getAttribute('dir')).toBe('rtl');
    });

    it('ignores chrome-marked text in a read-only editor', async () => {
      await boot([{ id: 'lab', type: 'chromeLabelled', data: { text: 'مرحبا' } }], { readOnly: true });

      expect(content('lab').getAttribute('dir')).toBe('rtl');
    });

    it('never puts dir into saved data', async () => {
      const instance = await boot([P('ar', 'مرحبا')]);
      const saved = await instance.save();

      expect(JSON.stringify(saved)).not.toContain('dir');
      expect(saved.blocks[0]?.data).toEqual({ text: 'مرحبا' });
    });
  });

  describe('updates', () => {
    it('flips live when the first letter typed is Arabic', async () => {
      await boot([P('p', '')]);

      expect(content('p').hasAttribute('dir')).toBe(false);

      await typeInto('p', 'ب');

      expect(content('p').getAttribute('dir')).toBe('rtl');

      await typeInto('p', '123');

      expect(content('p').hasAttribute('dir')).toBe(false);

      await typeInto('p', 'Hi');

      expect(content('p').getAttribute('dir')).toBe('ltr');
    });

    it('re-stamps after an API update', async () => {
      const instance = await boot([P('p', 'Hello')]);

      await instance.blocks.update('p', { text: 'مرحبا' });
      await frames(2);

      expect(content('p').getAttribute('dir')).toBe('rtl');
    });

    it('re-stamps after a peer changes the text', async () => {
      const instance = await boot([P('p', 'Hello')]);
      const yjs = instance.module.yjsManager;
      const peer = new DocumentStore(new YBlockSerializer());

      peer.applyRemoteUpdate(yjs.encodeStateAsUpdate(peer.getStateVector()));
      peer.updateBlockData('p', 'text', 'مرحبا');
      yjs.applyRemoteUpdate(peer.encodeStateAsUpdate(yjs.getStateVector()));
      await settle();

      expect(field('p').textContent).toBe('مرحبا');
      expect(content('p').getAttribute('dir')).toBe('rtl');
      peer.destroy();
    });

    it('re-stamps after undo and redo', async () => {
      const instance = await boot([P('p', 'Hello')]);

      await typeInto('p', 'مرحبا');
      await settle();

      expect(content('p').getAttribute('dir')).toBe('rtl');

      instance.history.undo();
      await settle();

      expect(field('p').textContent).toBe('Hello');
      expect(content('p').getAttribute('dir')).toBe('ltr');

      instance.history.redo();
      await settle();

      expect(field('p').textContent).toBe('مرحبا');
      expect(content('p').getAttribute('dir')).toBe('rtl');
    });
  });

  /**
   * Guards: these pass without the stamping code too. They pin that the stamp
   * lives where a write is not an edit.
   */
  describe('the stamp is not an edit', () => {
    /** Any Yjs op advances the doc's state vector, so comparing it detects one. */
    const docVersion = (instance: TestEditor): string =>
      Array.from(instance.module.yjsManager.getStateVector()).join(',');

    it('writing dir on top-level and nested content elements fires nothing', async () => {
      const onChange = vi.fn();
      const onSave = vi.fn();
      const instance = await boot([
        P('top', 'x'),
        { id: 't', type: 'toggle', data: { text: 'x', isOpen: true }, content: ['in-t'] },
        P('in-t', 'x', 't'),
        { id: 'call', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['in-call'] },
        P('in-call', 'x', 'call'),
        { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, content: ['in-c1'], parent: 'cl' },
        P('in-c1', 'x', 'c1'),
        { id: 'c2', type: 'column', data: {}, content: ['in-c2'], parent: 'cl' },
        P('in-c2', 'x', 'c2'),
        {
          id: 'tbl',
          type: 'table',
          data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['in-tbl'], id: 'col', rowId: 'row' }]] },
          content: ['in-tbl'],
        },
        P('in-tbl', 'x', 'tbl'),
        { id: 'th', type: 'header', data: { text: 'x', level: 2, isToggleable: true, isOpen: true }, content: ['in-th'] },
        P('in-th', 'x', 'th'),
      ], { onChange, onSave });

      await settle();
      onChange.mockClear();
      onSave.mockClear();

      const versionBefore = docVersion(instance);
      const canUndoBefore = instance.history.canUndo();
      const ids = ['top', 't', 'in-t', 'call', 'in-call', 'cl', 'c1', 'in-c1', 'in-c2', 'tbl', 'in-tbl', 'th', 'in-th'];

      for (const id of ids) {
        content(id).setAttribute('dir', 'rtl');
      }
      await settle();

      for (const id of ids) {
        content(id).removeAttribute('dir');
      }
      await settle();

      expect(onChange).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      expect(docVersion(instance)).toBe(versionBefore);
      expect(instance.history.canUndo()).toBe(canUndoBefore);
    });

    it('writing dir inside a database fires nothing', async () => {
      const onChange = vi.fn();
      const instance = await boot([
        {
          id: 'db',
          type: 'database',
          data: {
            title: 'Tasks',
            schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
            views: [{ id: 'v-list', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
            activeViewId: 'v-list',
          },
          content: ['r1'],
        },
        { id: 'r1', type: 'database-row', data: { properties: { 'p-title': 'one' }, position: 'a0', title: 'one' }, parent: 'db' },
      ], { onChange });

      await settle();
      onChange.mockClear();

      const versionBefore = docVersion(instance);
      const canUndoBefore = instance.history.canUndo();
      // The database's own content element plus any row content inside it.
      const contents = Array.from(holder.querySelectorAll<HTMLElement>('[data-blok-id="db"] [data-blok-element-content]'));

      expect(contents.length).toBeGreaterThan(0);

      contents.forEach(element => element.setAttribute('dir', 'rtl'));
      await settle();

      expect(onChange).not.toHaveBeenCalled();
      expect(docVersion(instance)).toBe(versionBefore);
      expect(instance.history.canUndo()).toBe(canUndoBefore);
    });

    /**
     * Also the positive control for the guards above: the same counters DO
     * see a real edit in this harness.
     */
    it('typing a letter that flips the block is one change and one undo step', async () => {
      const onChange = vi.fn();
      const onSave = vi.fn();
      const instance = await boot([P('p', '')], { onChange, onSave });

      await settle();
      onChange.mockClear();

      const versionBefore = docVersion(instance);

      await typeInto('p', 'ب');
      await settle();

      expect(content('p').getAttribute('dir')).toBe('rtl');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalled();
      expect(docVersion(instance)).not.toBe(versionBefore);

      instance.history.undo();
      await settle();

      expect(field('p').textContent).toBe('');
      expect(content('p').hasAttribute('dir')).toBe(false);
      expect(instance.history.canUndo()).toBe(false);
    });
  });
});
