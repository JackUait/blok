/**
 * Public runtime i18n API (`instance.i18n.update`).
 *
 * `config.i18n` was construction-time only: it is read once during
 * `I18n.prepare()` and never again, so a host with a live language switcher
 * had to bump the adapter `deps` (destroying the editor and losing caret,
 * focus, selection and undo stack) just to relabel the UI. This API exposes
 * the same channel at runtime, mirroring theme/width/placeholder/tokens:
 * available immediately after construction, buffered before isReady, replayed
 * once the modules exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../src/blok';
import { ListItem } from '../../src/tools/list';
import { Paragraph } from '../../src/tools/paragraph';

const createEditor = async (config: Record<string, unknown> = {}): Promise<Blok> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    minHeight: 50,
    ...config,
  });

  await editor.isReady;

  return editor;
};

const editorWrapper = (): HTMLElement => {
  const wrapper = document.querySelector<HTMLElement>('[data-blok-testid="blok-editor"]');

  if (wrapper === null) {
    throw new Error('editor wrapper not found');
  }

  return wrapper;
};

/**
 * Collapses the document selection inside a rendered block, the way clicking
 * into it does. jsdom does not maintain a selection of its own, so the caret
 * an assertion depends on has to be placed explicitly.
 * @param index - index of the block to put the selection in
 */
const selectInsideBlock = (index: number): void => {
  // jsdom does not reflect the `contenteditable` property as an attribute, so
  // the blocks are located by the tool marker instead
  const blocks = document.querySelectorAll<HTMLElement>('[data-blok-redactor] [data-blok-tool]');
  const input = blocks[index];

  if (input === undefined) {
    throw new Error(`no block at index ${index}`);
  }

  const range = document.createRange();

  range.selectNodeContents(input);
  range.collapse(false);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

/**
 * The published `Blok` class declaration lists the config-shaped surface only;
 * the module APIs (`save`, `caret`, `blocks`) reach the instance through the
 * prototype swap at boot. Same gap the `events` cast below documents.
 * @param editor - editor instance under test
 */
const runtime = (editor: Blok): EditorRuntime => editor as unknown as EditorRuntime;

interface EditorRuntime {
  save: () => Promise<{ blocks: Array<{ data: unknown }> }>;
  caret: { setToBlock: (index: number, position?: string) => boolean };
  blocks: {
    getCurrentBlockIndex: () => number;
    insert: (type?: string, data?: Record<string, unknown>) => unknown;
  };
  history: { canUndo: () => boolean };
}

describe('Blok i18n runtime API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('is exposed synchronously, before isReady resolves', () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({ holder, minHeight: 50 });

    expect(typeof editor.i18n.update).toBe('function');
    expect(typeof editor.i18n.t).toBe('function');
    expect(typeof editor.i18n.getLocale).toBe('function');
    expect(typeof editor.i18n.getDirection).toBe('function');
  });

  it('changes the active locale in place', async () => {
    const editor = await createEditor();

    expect(editor.i18n.getLocale()).toBe('en');

    await editor.i18n.update({ locale: 'ru' });

    expect(editor.i18n.getLocale()).toBe('ru');
    expect(editor.i18n.t('a11y.insertBlock')).toBe('Вставить блок');
  });

  it('normalizes a region-tagged locale passed to update()', async () => {
    const editor = await createEditor();

    await editor.i18n.update({ locale: 'ru-RU' });

    expect(editor.i18n.getLocale()).toBe('ru');
    expect(editor.i18n.t('a11y.insertBlock')).toBe('Вставить блок');
  });

  it('normalizes a region-tagged locale passed via config.i18n.locale', async () => {
    const editor = await createEditor({ i18n: { locale: 'ru-RU' } });

    expect(editor.i18n.getLocale()).toBe('ru');
  });

  it('applies host message overrides on top of the active locale', async () => {
    const editor = await createEditor();

    await editor.i18n.update({ messages: { 'a11y.insertBlock': 'Add thing' } });

    expect(editor.i18n.t('a11y.insertBlock')).toBe('Add thing');
  });

  /**
   * Regression: the ordering trap. `setLocale('en')` routes `t()` back to the
   * lightweight implementation, whose `overrides` were never populated during a
   * non-English session (the dictionary went to the i18next instance instead).
   * A bare locale flip therefore silently dropped the host's custom messages.
   */
  it('keeps host message overrides across a locale flip in both directions', async () => {
    const editor = await createEditor({
      i18n: {
        locale: 'ru',
        messages: { 'a11y.insertBlock': 'Хост' },
      },
    });

    expect(editor.i18n.t('a11y.insertBlock')).toBe('Хост');

    await editor.i18n.update({ locale: 'en' });

    expect(editor.i18n.getLocale()).toBe('en');
    expect(editor.i18n.t('a11y.insertBlock')).toBe('Хост');

    await editor.i18n.update({ locale: 'ru' });

    expect(editor.i18n.t('a11y.insertBlock')).toBe('Хост');
  });

  /**
   * Regression: `setDictionary` deep-merges into the live i18next resource
   * bundle, and that bundle used to BE the module-level cached locale
   * dictionary. One editor's host overrides therefore mutated the shared
   * object and surfaced in every other editor that later loaded the same
   * locale.
   */
  it('keeps host message overrides scoped to the instance that set them', async () => {
    const first = await createEditor();

    await first.i18n.update({ locale: 'ru', messages: { 'a11y.insertBlock': 'Только тут' } });

    const second = await createEditor();

    await second.i18n.update({ locale: 'ru' });

    expect(first.i18n.t('a11y.insertBlock')).toBe('Только тут');
    expect(second.i18n.t('a11y.insertBlock')).toBe('Вставить блок');
  });

  it('flips text direction when the new locale is RTL', async () => {
    const editor = await createEditor();
    const wrapper = editorWrapper();

    expect(editor.i18n.getDirection()).toBe('ltr');
    expect(wrapper.hasAttribute('data-blok-rtl')).toBe(false);

    await editor.i18n.update({ locale: 'ar' });

    expect(editor.i18n.getDirection()).toBe('rtl');
    expect(wrapper.getAttribute('data-blok-rtl')).toBe('true');

    await editor.i18n.update({ locale: 'en' });

    expect(editor.i18n.getDirection()).toBe('ltr');
    expect(wrapper.hasAttribute('data-blok-rtl')).toBe(false);
  });

  it('relabels the eagerly-stamped editor chrome', async () => {
    const editor = await createEditor();
    const toolbar = document.querySelector<HTMLElement>('[data-blok-testid="toolbar"]');
    const plusButton = document.querySelector<HTMLElement>('[data-blok-testid="plus-button"]');

    expect(toolbar?.getAttribute('aria-label')).toBe('Block toolbar');

    await editor.i18n.update({ locale: 'ru' });

    expect(toolbar?.getAttribute('aria-label')).toBe('Панель инструментов блока');
    expect(plusButton?.getAttribute('aria-label')).toBe('Вставить блок');
  });

  /**
   * The regression this API existed to have and did not: a tool resolves
   * `api.i18n.t(...)` once while rendering and writes the result into its own
   * DOM. Relabelling only the editor chrome left every one of those strings —
   * placeholders, media-toolbar labels, cell controls — frozen in the previous
   * language, which is what a host sees as "the language did not change".
   */
  it('re-localizes strings a tool wrote into its own DOM', async () => {
    const editor = await createEditor({ tools: { paragraph: Paragraph } });
    const placeholderOf = (): string | null | undefined =>
      document
        .querySelector<HTMLElement>('[data-blok-redactor] [data-blok-tool="paragraph"]')
        ?.getAttribute('data-blok-placeholder-active');

    expect(placeholderOf()).toBe('Write something or press / to select a tool');

    await editor.i18n.update({ locale: 'ru' });

    expect(placeholderOf()).toBe('Напишите что-нибудь или нажмите /, чтобы выбрать инструмент');
  });

  /**
   * LAW: a locale change re-localizes tool DOM without the tool taking part.
   *
   * The bug this pins was a maintenance bug, not a logic one: relabelling was
   * a hand-written list of "eager writes we remembered" (toolbar wrapper, plus
   * button, settings toggler), so every tool outside that list — and every
   * tool written after it — stayed in the old language. Any fix that goes back
   * to enumerating call sites, or that needs tools to implement an i18n hook,
   * reintroduces exactly that rot and fails here.
   *
   * The tool below is deliberately ignorant: no hook, no registration, three
   * different write shapes (attribute, own text, descendant text).
   */
  it('LAW: re-localizes a tool that implements no i18n hook at all', async () => {
    class EagerTool {
      public static get toolbox(): { icon: string; title: string } {
        return {
          icon: '',
          title: 'Eager',
        };
      }

      private api: { i18n: { t: (key: string) => string } };

      public constructor({ api }: { api: { i18n: { t: (key: string) => string } } }) {
        this.api = api;
      }

      public render(): HTMLElement {
        const element = document.createElement('div');
        const descendant = document.createElement('span');

        element.setAttribute('aria-label', this.api.i18n.t('a11y.insertBlock'));
        element.append(this.api.i18n.t('toolNames.text'));

        descendant.textContent = this.api.i18n.t('blockSettings.delete');
        element.appendChild(descendant);
        element.contentEditable = 'true';

        return element;
      }

      public save(): Record<string, never> {
        return {};
      }
    }

    const editor = await createEditor({
      tools: { eager: EagerTool },
      data: { blocks: [{ type: 'eager', data: {} }] },
    });

    const rendered = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-blok-redactor] [aria-label]');
    const strings = (): Array<string | null | undefined> => [
      rendered()?.getAttribute('aria-label'),
      rendered()?.firstChild?.textContent,
      rendered()?.querySelector('span')?.textContent,
    ];

    expect(strings()).toEqual(['Insert block', 'Text', 'Delete']);

    await editor.i18n.update({ locale: 'ru' });

    expect(strings()).toEqual(['Вставить блок', 'Текст', 'Удалить']);
  });

  /**
   * A repaint saves from tool data, but tools that commit a field on blur
   * (image and file captions) have nothing in data while the user is still
   * typing in it. Blurring before the save is what makes the repaint lossless
   * — without it, switching language mid-caption silently ate the caption.
   */
  it('does not lose an edit a tool commits on blur', async () => {
    class BlurCommitTool {
      private data: { text: string };

      private element: HTMLElement | null = null;

      public constructor({ data }: { data: { text?: string } }) {
        this.data = { text: data.text ?? '' };
      }

      public render(): HTMLElement {
        const element = document.createElement('div');

        element.setAttribute('contenteditable', 'true');
        element.tabIndex = 0;
        element.textContent = this.data.text;
        element.addEventListener('blur', () => {
          this.data.text = element.textContent ?? '';
        });

        this.element = element;

        return element;
      }

      public save(): { text: string } {
        return this.data;
      }

      public get input(): HTMLElement | null {
        return this.element;
      }
    }

    const editor = await createEditor({
      tools: { blurCommit: BlurCommitTool },
      data: { blocks: [{ type: 'blurCommit', data: { text: 'committed' } }] },
    });

    const field = document.querySelector<HTMLElement>('[data-blok-redactor] [contenteditable]');

    field?.focus();

    if (field !== null) {
      field.textContent = 'typed but not committed';
    }

    await editor.i18n.update({ locale: 'ru' });

    const saved = await runtime(editor).save();

    expect(saved.blocks[0]?.data).toEqual({ text: 'typed but not committed' });
  });

  /**
   * A repaint used to reload the document — clear every block and render it
   * again — which wiped the Yjs undo history along with it. Switching language
   * then silently cost the user every undo step, the exact loss this API was
   * built to avoid. The repaint rebuilds the view only: same block ids, same
   * data, Yjs untouched.
   */
  it('keeps the undo history across a locale change', async () => {
    const editor = await createEditor({ tools: { paragraph: Paragraph } });

    runtime(editor).blocks.insert('paragraph', { text: 'undoable' });

    expect(runtime(editor).history.canUndo()).toBe(true);

    await editor.i18n.update({ locale: 'ru' });

    expect(runtime(editor).history.canUndo()).toBe(true);
  });

  /**
   * A repaint is an internal round-trip, not an export. Saving through the
   * host-facing dialect ran the output through `collapseToLegacy`, which can
   * only express nesting as nested `items[]` — so a list item nested by the
   * flat `data.depth` carrier came back at depth 0 and every indented bullet
   * in the document flattened to a top-level one.
   */
  it('keeps list nesting through a repaint in the legacy dialect', async () => {
    const editor = await createEditor({
      dataModel: 'legacy',
      tools: { list: ListItem },
      data: {
        blocks: [
          { type: 'list', data: { style: 'unordered', text: 'root' } },
          { type: 'list', data: { style: 'unordered', text: 'nested', depth: 1 } },
        ],
      },
    });

    const markers = (): Array<string | undefined> =>
      [...document.querySelectorAll('[data-blok-tool="list"]')]
        .map(item => item.querySelector('[data-list-marker]')?.textContent ?? undefined);

    expect(markers()).toEqual(['•', '◦']);

    await editor.i18n.update({ locale: 'ru' });

    expect(markers()).toEqual(['•', '◦']);
  });

  /**
   * Re-localizing repaints block DOM, so the two things a repaint destroys are
   * pinned here: the caret has to come back to the block the user was in, and
   * the repaint must not be reported to the host as an edit.
   */
  it('keeps the caret in the current block and reports no content change', async () => {
    const onChange = vi.fn();
    const editor = await createEditor({
      tools: { paragraph: Paragraph },
      data: {
        blocks: [
          { type: 'paragraph', data: { text: 'first' } },
          { type: 'paragraph', data: { text: 'second' } },
        ],
      },
      onChange,
    });

    runtime(editor).caret.setToBlock(1, 'end');

    onChange.mockClear();

    await editor.i18n.update({ locale: 'ru' });

    expect(runtime(editor).blocks.getCurrentBlockIndex()).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
    // the editor did not hold focus, so the repaint must not have taken it
    expect(document.body).toHaveFocus();
  });

  /**
   * The language switcher that triggers the update is itself a control on the
   * page, and a caret the user left behind in a block outlives the focus that
   * put it there: the selection anchor still sits in the redactor while the
   * real focus is on the switcher. Reading that stale anchor as "the editor
   * has focus" made the repaint blur the control mid-interaction and pull the
   * caret — and the viewport — back into the document.
   */
  it('does not take focus from a control outside the editor', async () => {
    const editor = await createEditor({
      tools: { paragraph: Paragraph },
      data: {
        blocks: [
          { type: 'paragraph', data: { text: 'first' } },
          { type: 'paragraph', data: { text: 'second' } },
        ],
      },
    });

    runtime(editor).caret.setToBlock(1, 'end');

    const languageSwitcher = document.createElement('input');

    document.body.appendChild(languageSwitcher);
    languageSwitcher.focus();
    /*
     * The caret stays behind in the block the user left — re-applied after the
     * focus move because jsdom, unlike a browser, drops the selection when a
     * control takes focus.
     */
    selectInsideBlock(1);

    // the caret left behind is what used to be mistaken for editor focus
    const redactor = document.querySelector('[data-blok-redactor]');

    expect(redactor?.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);

    await editor.i18n.update({ locale: 'ru' });

    expect(languageSwitcher).toHaveFocus();
  });

  it('emits i18n:changed with the new locale and direction', async () => {
    const editor = await createEditor();
    const seen: unknown[] = [];

    /*
     * `events` reaches the instance through the API prototype swap, but the
     * published `Blok` class declaration does not list it — a separate gap.
     */
    const events = (editor as unknown as {
      events: { on: (name: string, handler: (payload: unknown) => void) => void };
    }).events;

    events.on('i18n:changed', (payload: unknown) => seen.push(payload));

    await editor.i18n.update({ locale: 'ar' });

    expect(seen).toEqual([{ locale: 'ar', direction: 'rtl' }]);
  });

  it('serializes overlapping updates so the last call wins', async () => {
    const editor = await createEditor();

    const first = editor.i18n.update({ locale: 'ru' });
    const second = editor.i18n.update({ locale: 'en' });

    await Promise.all([first, second]);

    expect(editor.i18n.getLocale()).toBe('en');
  });

  it('does not expose the mutator to tools through api.i18n', async () => {
    const editor = await createEditor();
    const toolFacingI18n = Object.getPrototypeOf(editor) as { i18n: Record<string, unknown> };

    expect(typeof toolFacingI18n.i18n.t).toBe('function');
    expect(toolFacingI18n.i18n.update).toBeUndefined();
  });

  it('buffers an update issued before isReady and replays it', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({ holder, minHeight: 50 });

    await editor.i18n.update({ locale: 'ru' });
    await editor.isReady;

    expect(editor.i18n.getLocale()).toBe('ru');
    expect(editor.i18n.t('a11y.insertBlock')).toBe('Вставить блок');
  });
});
