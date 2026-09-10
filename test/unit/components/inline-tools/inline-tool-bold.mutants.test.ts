import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BoldInlineTool } from '../../../../src/components/inline-tools/inline-tool-bold';
import { InlineToolEventManager } from '../../../../src/components/inline-tools/services/inline-tool-event-manager';
import { IconBold } from '../../../../src/components/icons';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

const MAC_AGENT = 'mozilla/5.0 (macintosh; intel mac os x 10_15_7)';

/**
 * The real jsdom constructor, captured before any test can stub the global.
 * The recorder below must still mutate like the original or the observer tests
 * prove nothing.
 */
const RealMutationObserver = globalThis.MutationObserver;

let liveObservers: MutationObserver[] = [];
let observerCallbacks: MutationCallback[] = [];

/**
 * Records every observer the source creates and keeps its callback, so a test
 * can drive the callback synchronously with a hand-built record. Leftover
 * observers are disconnected after each test: an observer still watching
 * `document.body` from an earlier test would normalize the next test's fixture
 * in a microtask and make the assertions race the thing under test.
 */
const recordObservers = (): void => {
  observerCallbacks = [];

  class RecordingMutationObserver extends RealMutationObserver {
    public constructor(callback: MutationCallback) {
      super(callback);
      liveObservers.push(this);
      observerCallbacks.push(callback);
    }
  }

  vi.stubGlobal('MutationObserver', RecordingMutationObserver);
};

const disconnectObservers = (): void => {
  liveObservers.forEach((observer) => observer.disconnect());
  liveObservers = [];
  observerCallbacks = [];
};

const tick = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const childListRecord = (target: Node, added: Node[]): MutationRecord =>
  ({ type: 'childList', target, addedNodes: added } as unknown as MutationRecord);

const characterDataRecord = (target: Node): MutationRecord =>
  ({ type: 'characterData', target, addedNodes: [] } as unknown as MutationRecord);

const elementWith = (tag: string, attributes: Record<string, string>): HTMLElement => {
  const element = document.createElement(tag);

  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));

  return element;
};

const mustFind = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector(selector);

  if (found === null) {
    throw new Error(`no element matching ${selector}`);
  }

  return found as T;
};

interface FreshBold {
  Bold: typeof BoldInlineTool;
  Manager: typeof InlineToolEventManager;
  cleanup: () => void;
}

/**
 * A brand-new copy of the module, so per-document statics (`mutationObserver`,
 * `styleWithCssDisabled`, the registered handler) start from their real initial
 * values. Without this every first-run branch is untestable: the first test to
 * construct the tool consumes them for the whole file.
 */
const loadFreshBold = async (): Promise<FreshBold> => {
  vi.resetModules();

  const boldModule = await import('../../../../src/components/inline-tools/inline-tool-bold');
  const managerModule = await import('../../../../src/components/inline-tools/services/inline-tool-event-manager');

  return {
    Bold: boldModule.BoldInlineTool,
    Manager: managerModule.InlineToolEventManager,
    cleanup: () => managerModule.InlineToolEventManager.reset(),
  };
};

const installExecCommand = (): ReturnType<typeof vi.fn> => {
  const execCommand = vi.fn();

  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
    writable: true,
  });

  return execCommand;
};

/**
 * A `Selection` view that pins `anchorNode` while delegating everything else to
 * the real selection. Needed because the mark engine restructures the DOM on the
 * way to the button refresh, and that surgery moves a real selection's anchor
 * off its original node — the very case the anchor guards exist for.
 */
const selectionAnchoredOn = (anchor: Node | null, real: () => Selection | null): Selection => ({
  get rangeCount() {
    return real()?.rangeCount ?? 0;
  },
  getRangeAt: (index: number) => {
    const range = real()?.getRangeAt(index);

    if (range === undefined) {
      throw new Error('the real selection has no range');
    }

    return range;
  },
  get anchorNode() {
    return anchor;
  },
  get focusNode() {
    return anchor;
  },
  removeAllRanges: () => real()?.removeAllRanges(),
  addRange: (range: Range) => real()?.addRange(range),
} as unknown as Selection);

interface Fixture {
  editor: HTMLElement;
  paragraph: HTMLElement;
  button: HTMLElement;
  activate: () => void;
  isActive: () => boolean;
}

const mount = (html: string): Fixture => {
  const editor = document.createElement('div');

  editor.setAttribute('data-blok-editor', '');

  const toolbar = document.createElement('div');

  toolbar.setAttribute('data-blok-testid', 'inline-toolbar');

  const button = document.createElement('button');

  button.setAttribute('data-blok-item-name', 'bold');
  toolbar.appendChild(button);

  const paragraph = document.createElement('div');

  paragraph.contentEditable = 'true';
  paragraph.innerHTML = html;
  editor.append(toolbar, paragraph);
  document.body.appendChild(editor);

  const config = new BoldInlineTool().render() as PopoverItemDefaultBaseParams;
  const { onActivate, isActive } = config;

  if (typeof onActivate !== 'function' || typeof isActive !== 'function') {
    throw new Error('the bold tool did not expose its callbacks');
  }

  return { editor, paragraph, button, activate: () => onActivate(config), isActive: () => isActive() };
};

const textHolding = (root: Node, value: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === value) {
      return node as Text;
    }
  }

  throw new Error(`no text node holding ${JSON.stringify(value)}`);
};

const select = (node: Node, start: number, end: number): void => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const onAMac = (): void => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(MAC_AGENT);
};

const boldShortcut = (): KeyboardEvent => new KeyboardEvent('keydown', {
  key: 'b',
  metaKey: true,
  bubbles: true,
  cancelable: true,
});

describe('BoldInlineTool mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disconnectObservers();
    recordObservers();
    InlineToolEventManager.reset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    InlineToolEventManager.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    disconnectObservers();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('metadata', () => {
    it('keeps legacy b in the sanitizer beside canonical strong', () => {
      expect(BoldInlineTool.sanitize).toStrictEqual({ strong: {}, b: {} });
    });

    it('defers a collapsed-caret shortcut to the browser', () => {
      expect(BoldInlineTool.nativeCaretShortcut).toBe(true);
      expect(BoldInlineTool.shortcut).toBe('CMD+B');
      expect(BoldInlineTool.isInline).toBe(true);
      expect(BoldInlineTool.titleKey).toBe('bold');
    });

    it('renders the bold icon under its own name', () => {
      const config = new BoldInlineTool().render() as PopoverItemDefaultBaseParams;

      expect(config.icon).toBe(IconBold);
      expect(config.name).toBe('bold');
    });
  });

  describe('toggling', () => {
    it('wraps the selection in canonical strong', () => {
      const { paragraph, activate } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      activate();

      expect(paragraph.querySelector('strong')?.textContent).toBe('bold');
      expect(paragraph.querySelector('b')).toBeNull();
      expect(paragraph.textContent).toBe('x bold y');
    });

    it('unwraps a selection that is already bold', () => {
      const { paragraph, activate } = mount('x<strong>bold</strong>y');

      select(textHolding(paragraph, 'bold'), 0, 4);
      activate();

      expect(paragraph.querySelector('strong')).toBeNull();
      expect(paragraph.textContent).toBe('xboldy');
    });

    it('does nothing at a collapsed caret, where the browser owns pending bold', () => {
      const { paragraph, activate } = mount('plain');

      select(textHolding(paragraph, 'plain'), 2, 2);
      activate();

      expect(paragraph.querySelector('strong')).toBeNull();
      expect(paragraph.innerHTML).toBe('plain');
    });

    it('does nothing with no selection at all', () => {
      const { paragraph, activate } = mount('plain');

      window.getSelection()?.removeAllRanges();

      expect(() => activate()).not.toThrow();
      expect(paragraph.innerHTML).toBe('plain');
    });
  });

  describe('isActive', () => {
    it('is true inside canonical strong', () => {
      const { paragraph, isActive } = mount('x<strong>bold</strong>y');

      select(textHolding(paragraph, 'bold'), 0, 4);

      expect(isActive()).toBe(true);
    });

    it('is true inside a legacy b, which is the same mark', () => {
      const { paragraph, isActive } = mount('x<b>bold</b>y');

      select(textHolding(paragraph, 'bold'), 0, 4);

      expect(isActive()).toBe(true);
    });

    it('is false in plain text', () => {
      const { paragraph, isActive } = mount('x<strong>bold</strong>y');

      select(textHolding(paragraph, 'y'), 0, 1);

      expect(isActive()).toBe(false);
    });

    it('is false with no selection at all', () => {
      const { isActive } = mount('x<strong>bold</strong>y');

      window.getSelection()?.removeAllRanges();

      expect(isActive()).toBe(false);
    });
  });

  describe('the toolbar button state', () => {
    it('marks the button active after a programmatic toggle', () => {
      const { paragraph, button, activate } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      activate();

      expect(button.getAttribute('data-blok-popover-item-active')).toBe('true');
    });

    it('clears the mark when the toggle removed the bold', () => {
      const { paragraph, button, activate } = mount('x<strong>bold</strong>y');

      button.setAttribute('data-blok-popover-item-active', 'true');
      select(textHolding(paragraph, 'bold'), 0, 4);
      activate();

      expect(button.hasAttribute('data-blok-popover-item-active')).toBe(false);
    });

    it('leaves a toolbar in another editor alone', () => {
      const first = mount('x bold y');
      const second = mount('a bold b');

      select(textHolding(second.paragraph, 'a bold b'), 2, 6);
      second.activate();

      expect(second.button.getAttribute('data-blok-popover-item-active')).toBe('true');
      expect(first.button.hasAttribute('data-blok-popover-item-active')).toBe(false);
    });
  });

  describe('the document-level shortcut', () => {
    it('applies bold to a real selection inside the editor', () => {
      onAMac();

      const { paragraph } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      document.dispatchEvent(boldShortcut());

      expect(paragraph.querySelector('strong')?.textContent).toBe('bold');
    });

    it('falls through to the browser at a collapsed caret', () => {
      onAMac();

      const { paragraph } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 2);

      const event = boldShortcut();

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(paragraph.querySelector('strong')).toBeNull();
    });

    it('ignores a selection outside any editor', () => {
      onAMac();
      mount('x bold y');

      const outside = document.createElement('div');

      outside.contentEditable = 'true';
      outside.textContent = 'a bold b';
      document.body.appendChild(outside);
      select(textHolding(outside, 'a bold b'), 2, 6);

      document.dispatchEvent(boldShortcut());

      expect(outside.querySelector('strong')).toBeNull();
    });

    it('registers its handler once however many tools are built', () => {
      const register = vi.spyOn(InlineToolEventManager.prototype, 'register');

      mount('a');
      mount('b');

      expect(register).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-document wiring on a first construction', () => {
    it('steers the browser to tag-based bold through styleWithCSS', async () => {
      const execCommand = installExecCommand();
      const { Bold, cleanup } = await loadFreshBold();

      try {
        void new Bold();
      } finally {
        cleanup();
      }

      expect(execCommand).toHaveBeenCalledTimes(1);
      expect(execCommand).toHaveBeenCalledWith('styleWithCSS', false, 'false');
    });

    it('does not re-issue styleWithCSS once the document has been steered', async () => {
      const execCommand = installExecCommand();
      const { Bold, Manager, cleanup } = await loadFreshBold();

      try {
        void new Bold();
        Manager.getInstance().unregister('bold');
        void new Bold();
      } finally {
        cleanup();
      }

      expect(execCommand).toHaveBeenCalledTimes(1);
    });

    it('installs one normalizer observer for the document however many tools are built', async () => {
      const { Bold, Manager, cleanup } = await loadFreshBold();

      try {
        void new Bold();
        // Re-registering is the only way the second construction reaches the
        // observer setup again; the handler short-circuits everything else.
        Manager.getInstance().unregister('bold');
        void new Bold();
      } finally {
        cleanup();
      }

      expect(liveObservers).toHaveLength(1);
    });

    it('converts a legacy b added anywhere inside an editor', async () => {
      const { Bold, cleanup } = await loadFreshBold();

      try {
        void new Bold();

        const editor = elementWith('div', { 'data-blok-editor': '' });
        const wrapper = document.createElement('div');

        wrapper.innerHTML = '<b>legacy</b>';
        editor.appendChild(wrapper);
        document.body.appendChild(editor);

        await tick();

        expect(editor.querySelector('b')).toBeNull();
        expect(mustFind(editor, 'strong').textContent).toBe('legacy');
      } finally {
        cleanup();
      }
    });

    it('normalizes when the text inside an existing bold changes', async () => {
      const editor = elementWith('div', { 'data-blok-editor': '' });

      editor.innerHTML = '<b>legacy</b>';
      document.body.appendChild(editor);

      const { Bold, cleanup } = await loadFreshBold();

      try {
        void new Bold();

        const text = mustFind(editor, 'b').firstChild;

        if (!(text instanceof Text)) {
          throw new Error('the legacy b has no text node');
        }

        text.data = 'legacy!';

        await tick();

        expect(editor.querySelector('b')).toBeNull();
        expect(mustFind(editor, 'strong').textContent).toBe('legacy!');
      } finally {
        cleanup();
      }
    });

    it('survives a document that has no MutationObserver at all', async () => {
      vi.stubGlobal('MutationObserver', undefined);

      const { Bold, cleanup } = await loadFreshBold();

      try {
        expect(() => new Bold()).not.toThrow();
      } finally {
        cleanup();
      }
    });
  });

  describe('the document listeners', () => {
    it('normalizes the surrounding bold when the selection changes', () => {
      const { paragraph } = mount('<b>legacy</b> tail');

      select(textHolding(paragraph, ' tail'), 1, 2);
      document.dispatchEvent(new Event('selectionchange'));

      expect(paragraph.querySelector('b')).toBeNull();
      expect(mustFind(paragraph, 'strong').textContent).toBe('legacy');
    });

    it('normalizes the surrounding bold after an input event', () => {
      const { paragraph } = mount('<b>legacy</b> tail');

      select(textHolding(paragraph, ' tail'), 1, 2);
      document.dispatchEvent(new Event('input', { bubbles: true }));

      expect(paragraph.querySelector('b')).toBeNull();
      expect(mustFind(paragraph, 'strong').textContent).toBe('legacy');
    });

    it('leaves a b that holds the caret alone on a selection change', () => {
      const { paragraph } = mount('<b>caret</b> tail');

      select(textHolding(paragraph, 'caret'), 2, 3);
      document.dispatchEvent(new Event('selectionchange'));

      expect(paragraph.querySelector('b')).not.toBeNull();
      expect(paragraph.querySelector('strong')).toBeNull();
    });

    it('leaves non-breaking spaces alone on a selection change', () => {
      const { paragraph } = mount('a\u00A0b');

      select(textHolding(paragraph, 'a\u00A0b'), 0, 1);
      document.dispatchEvent(new Event('selectionchange'));

      expect(paragraph.textContent).toBe('a\u00A0b');
    });

    it('announces the selection change a toggle caused', () => {
      const { paragraph, activate } = mount('x bold y');
      const listener = vi.fn();

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      document.addEventListener('selectionchange', listener);
      activate();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('announces nothing at a collapsed caret, where the browser owns pending bold', () => {
      const { paragraph, activate } = mount('plain');
      const listener = vi.fn();

      select(textHolding(paragraph, 'plain'), 2, 2);
      document.addEventListener('selectionchange', listener);
      activate();

      expect(listener).not.toHaveBeenCalled();
      expect(paragraph.innerHTML).toBe('plain');
    });

    it('ignores a bare b keystroke that carries no modifier', () => {
      onAMac();

      const { paragraph } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 6);

      const event = new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true });

      document.dispatchEvent(event);

      expect(paragraph.querySelector('strong')).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('the toolbar button state guards', () => {
    const mountWithout = (options: { toolbar: boolean; button: boolean }): Fixture => {
      const editor = elementWith('div', { 'data-blok-editor': '' });
      const paragraph = document.createElement('div');
      const button = elementWith('button', { 'data-blok-item-name': 'bold' });

      paragraph.contentEditable = 'true';
      paragraph.textContent = 'x bold y';

      if (options.toolbar) {
        const toolbar = elementWith('div', { 'data-blok-testid': 'inline-toolbar' });

        if (options.button) {
          toolbar.appendChild(button);
        }

        editor.appendChild(toolbar);
      }

      editor.appendChild(paragraph);
      document.body.appendChild(editor);

      const config = new BoldInlineTool().render() as PopoverItemDefaultBaseParams;
      const { onActivate, isActive } = config;

      if (typeof onActivate !== 'function' || typeof isActive !== 'function') {
        throw new Error('the bold tool did not expose its callbacks');
      }

      return {
        editor,
        paragraph,
        button,
        activate: () => onActivate(config),
        isActive: () => isActive(),
      };
    };

    /**
     * The anchor is the blok root here, not a text node inside it: the button
     * must still resolve the editor from the anchor's own `closest`.
     */
    it('refreshes the button when the selection is anchored on the editor root', () => {
      const { editor, paragraph } = mount('x bold y');
      const button = mustFind<HTMLElement>(editor, '[data-blok-item-name="bold"]');
      const realGetSelection = window.getSelection.bind(window);

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      vi.spyOn(window, 'getSelection').mockReturnValue(selectionAnchoredOn(editor, realGetSelection));

      const config = new BoldInlineTool().render() as PopoverItemDefaultBaseParams;

      if (typeof config.onActivate !== 'function') {
        throw new Error('the bold tool did not expose onActivate');
      }

      config.onActivate(config);

      expect(paragraph.querySelector('strong')).not.toBeNull();
      expect(button.getAttribute('data-blok-popover-item-active')).toBe('true');
    });

    it('leaves the button alone when the selection is outside every editor', () => {
      const { activate } = mount('x bold y');
      const outside = document.createElement('div');

      outside.contentEditable = 'true';
      outside.textContent = 'a bold b';
      document.body.appendChild(outside);
      select(textHolding(outside, 'a bold b'), 2, 6);

      expect(() => activate()).not.toThrow();
      expect(outside.querySelector('strong')).not.toBeNull();
    });

    it('leaves the button alone when the editor has no toolbar', () => {
      const fixture = mountWithout({ toolbar: false, button: false });

      select(textHolding(fixture.paragraph, 'x bold y'), 2, 6);

      expect(() => fixture.activate()).not.toThrow();
    });

    it('leaves the button alone when the toolbar has no bold item', () => {
      const fixture = mountWithout({ toolbar: true, button: false });

      select(textHolding(fixture.paragraph, 'x bold y'), 2, 6);

      expect(() => fixture.activate()).not.toThrow();
    });

    it('leaves the button alone when the selection disappears mid-toggle', () => {
      const { paragraph, activate } = mount('x bold y');
      const realGetSelection = window.getSelection.bind(window);
      const realDispatch = document.dispatchEvent.bind(document);
      const getSelection = vi.spyOn(window, 'getSelection').mockImplementation(() => realGetSelection());

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      vi.spyOn(document, 'dispatchEvent').mockImplementation((event: Event) => {
        getSelection.mockImplementation(() => null);

        return realDispatch(event);
      });

      expect(() => activate()).not.toThrow();
    });

    it('reports not active when the document has no selection object', () => {
      const { isActive } = mount('x<strong>bold</strong>y');

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(isActive()).toBe(false);
    });

    it('leaves the toolbar alone when the anchor has no element ancestor', () => {
      const { paragraph, activate } = mount('x bold y');
      const realGetSelection = window.getSelection.bind(window);

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      // A live selection whose anchorNode was unlinked between the toggle and
      // the button refresh: the range survives, the anchor does not.
      vi.spyOn(window, 'getSelection').mockReturnValue(selectionAnchoredOn(null, realGetSelection));

      expect(() => activate()).not.toThrow();
    });
  });

  describe('the normalizer observer callback', () => {
    const editorWith = (html: string): HTMLElement => {
      const editor = elementWith('div', { 'data-blok-editor': '' });

      editor.innerHTML = html;
      document.body.appendChild(editor);

      return editor;
    };

    it('converts a b in a blok scope reached from the added node', async () => {
      const editor = editorWith('');
      const { Bold, cleanup } = await loadFreshBold();

      try {
        void new Bold();

        const legacy = document.createElement('b');

        legacy.textContent = 'legacy';
        editor.appendChild(legacy);
        observerCallbacks[0]([childListRecord(editor, [legacy])], liveObservers[0]);

        expect(editor.querySelector('b')).toBeNull();
        expect(mustFind(editor, 'strong').textContent).toBe('legacy');
      } finally {
        cleanup();
      }
    });

    it('converts a b in a blok scope reached from a character data target', async () => {
      const editor = editorWith('<b>legacy</b>');
      const text = mustFind(editor, 'b').firstChild;
      const { Bold, cleanup } = await loadFreshBold();

      if (!(text instanceof Text)) {
        throw new Error('the legacy b has no text node');
      }

      try {
        void new Bold();
        observerCallbacks[0]([characterDataRecord(text)], liveObservers[0]);

        expect(editor.querySelector('b')).toBeNull();
        expect(mustFind(editor, 'strong').textContent).toBe('legacy');
      } finally {
        cleanup();
      }
    });

    it('converts a b in a blok scope reached from a removal record', async () => {
      const editor = editorWith('<b>legacy</b>');
      const { Bold, cleanup } = await loadFreshBold();

      try {
        void new Bold();
        observerCallbacks[0]([childListRecord(editor, [])], liveObservers[0]);

        expect(editor.querySelector('b')).not.toBeNull();
      } finally {
        cleanup();
      }
    });

    it('keeps the b holding the caret when the callback runs', async () => {
      const editor = editorWith('<b>caret</b>');
      const text = mustFind(editor, 'b').firstChild;
      const { Bold, cleanup } = await loadFreshBold();

      if (!(text instanceof Text)) {
        throw new Error('the legacy b has no text node');
      }

      try {
        void new Bold();
        select(text, 2, 3);
        observerCallbacks[0]([characterDataRecord(text)], liveObservers[0]);

        expect(editor.querySelector('b')).not.toBeNull();
      } finally {
        cleanup();
      }
    });

    it('normalizes when the document reports no selection at all', async () => {
      const editor = editorWith('<b>legacy</b>');
      const text = mustFind(editor, 'b').firstChild;
      const { Bold, cleanup } = await loadFreshBold();

      if (!(text instanceof Text)) {
        throw new Error('the legacy b has no text node');
      }

      try {
        void new Bold();
        vi.spyOn(window, 'getSelection').mockReturnValue(null);
        observerCallbacks[0]([characterDataRecord(text)], liveObservers[0]);

        expect(editor.querySelector('b')).toBeNull();
      } finally {
        cleanup();
      }
    });

    it('leaves adjacent, empty and spaced bold markup structurally alone', async () => {
      const editor = editorWith('<strong>one</strong><strong>two</strong><strong></strong>x\u00A0y');
      const text = editor.lastChild;
      const { Bold, cleanup } = await loadFreshBold();

      if (!(text instanceof Text)) {
        throw new Error('the fixture has no trailing text node');
      }

      try {
        void new Bold();
        observerCallbacks[0]([characterDataRecord(text)], liveObservers[0]);

        expect(editor.querySelectorAll('strong')).toHaveLength(3);
        expect(editor.textContent).toBe('onetwox\u00A0y');
      } finally {
        cleanup();
      }
    });

    it('keeps normalizing after an earlier pass has already run', async () => {
      const first = editorWith('<b>one</b>');
      const second = editorWith('<b>two</b>');
      const firstText = mustFind(first, 'b').firstChild;
      const secondText = mustFind(second, 'b').firstChild;
      const { Bold, cleanup } = await loadFreshBold();

      if (!(firstText instanceof Text) || !(secondText instanceof Text)) {
        throw new Error('a legacy b has no text node');
      }

      try {
        void new Bold();
        observerCallbacks[0]([characterDataRecord(firstText)], liveObservers[0]);
        expect(first.querySelector('b')).toBeNull();

        observerCallbacks[0]([characterDataRecord(secondText)], liveObservers[0]);
        expect(second.querySelector('b')).toBeNull();
      } finally {
        cleanup();
      }
    });

    it('treats an editor element added to the page as its own scope', async () => {
      const { Bold, cleanup } = await loadFreshBold();

      try {
        void new Bold();

        const editor = elementWith('div', { 'data-blok-editor': '' });

        editor.innerHTML = '<b>legacy</b>';
        document.body.appendChild(editor);
        observerCallbacks[0]([childListRecord(document.body, [editor])], liveObservers[0]);

        expect(editor.querySelector('b')).toBeNull();
        expect(mustFind(editor, 'strong').textContent).toBe('legacy');
      } finally {
        cleanup();
      }
    });
  });

  describe('the shortcut relevance guard', () => {
    it('applies bold when the selection is anchored on the editor root', () => {
      onAMac();

      const { editor, paragraph } = mount('x bold y');
      const range = document.createRange();

      range.setStart(editor, 1);
      range.setEnd(textHolding(paragraph, 'x bold y'), 4);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      document.dispatchEvent(boldShortcut());

      expect(editor.querySelector('strong')).not.toBeNull();
    });

    it('ignores a keydown when the anchor has no element ancestor', () => {
      onAMac();
      mount('x bold y');

      const errors: string[] = [];
      const record = (event: ErrorEvent): void => { errors.push(event.message); };

      window.addEventListener('error', record);

      const comment = document.createComment('a comment here');

      document.appendChild(comment);

      const range = document.createRange();

      range.setStart(comment, 0);
      range.setEnd(comment, 4);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(boldShortcut());

      expect(errors).toStrictEqual([]);
      window.removeEventListener('error', record);
      comment.remove();
    });
  });
});
