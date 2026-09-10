import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { DatabaseRow, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import { englishDictionary } from '../../../../src/components/i18n/lightweight-i18n';
import type { I18n, OutputData } from '../../../../types';

interface NestedBlokConfig {
  holder: HTMLElement;
  data?: OutputData;
  readOnly?: boolean;
  onChange: () => Promise<void>;
}

interface NestedEditorProbe {
  config: NestedBlokConfig;
  saveCalls: number;
  destroyCalls: number;
}

interface NestedEditorState {
  created: NestedEditorProbe[];
  savePayload: OutputData;
  rejectSave: boolean;
}

const nested = vi.hoisted((): NestedEditorState => ({
  created: [],
  savePayload: { blocks: [] },
  rejectSave: false,
}));

/**
 * The drawer builds its description editor through a dynamic `import('../../blok')`,
 * so the constructor arguments and the save/destroy calls are the only place the
 * editor lifecycle is observable from the outside.
 */
vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    public readonly isReady = Promise.resolve();

    private readonly probe: NestedEditorProbe;

    public constructor(config: NestedBlokConfig) {
      this.probe = {
        config,
        saveCalls: 0,
        destroyCalls: 0,
      };
      nested.created.push(this.probe);
    }

    public save(): Promise<OutputData> {
      this.probe.saveCalls += 1;

      return nested.rejectSave
        ? Promise.reject(new Error('save failed'))
        : Promise.resolve(nested.savePayload);
    }

    public destroy(): void {
      this.probe.destroyCalls += 1;
    }
  },
}));

const WAIT = { timeout: 20000 } as const;

const drawers: DatabaseCardDrawer[] = [];

const makeDrawer = (options: CardDrawerOptions): DatabaseCardDrawer => {
  const drawer = new DatabaseCardDrawer(options);

  drawers.push(drawer);

  return drawer;
};

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => {
  const wrapper = document.createElement('div');

  // Every document-level listener the drawer registers, plus focus(), needs the
  // subtree to be connected — a detached wrapper makes these assertions vacuous.
  document.body.appendChild(wrapper);

  return {
    wrapper,
    readOnly: false,
    titlePropertyId: 'prop-title',
    schema: [],
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
};

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'row-1',
  position: 'a0',
  properties: { 'prop-title': 'Test card' },
  ...overrides,
});

const makeOption = (overrides: Partial<SelectOption> = {}): SelectOption => ({
  id: 'opt-1',
  label: 'In progress',
  color: 'blue',
  position: 'a1',
  ...overrides,
});

const makeDef = (overrides: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: 'prop-status',
  name: 'Status',
  type: 'select',
  position: 'a1',
  ...overrides,
});

const query = <T extends Element>(root: ParentNode, selector: string): T => {
  const el = root.querySelector<T>(selector);

  if (el === null) {
    throw new Error(`expected ${selector} to exist`);
  }

  return el;
};

describe('DatabaseCardDrawer — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nested.created.length = 0;
    nested.rejectSave = false;
    nested.savePayload = { blocks: [] };
  });

  afterEach(() => {
    for (const drawer of drawers) {
      drawer.destroy();
    }
    drawers.length = 0;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('rendered markup', () => {
    it('stamps every structural hook as an attribute with an empty value', () => {
      const options = createOptions({
        schema: [makeDef({ config: { options: [makeOption()] } })],
      });
      const drawer = makeDrawer(options);

      drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } }));

      const selectors = [
        'data-blok-database-drawer',
        'data-blok-database-drawer-toolbar',
        'data-blok-database-drawer-close',
        'data-blok-database-drawer-content',
        'data-blok-database-drawer-title',
        'data-blok-database-drawer-editor',
        'data-blok-database-drawer-props',
        'data-blok-database-drawer-add-prop',
        'data-blok-database-drawer-prop-row',
        'data-blok-database-drawer-prop-label',
        'data-blok-database-drawer-prop-value',
        'data-blok-database-drawer-prop-pill',
        'data-blok-database-drawer-prop-dot',
      ];

      for (const name of selectors) {
        expect(query(options.wrapper, `[${name}]`).getAttribute(name)).toBe('');
      }
    });

    it('puts the divider between the properties section and the editor holder', () => {
      const options = createOptions({ schema: [makeDef({ type: 'text', name: 'Notes' })] });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const content = query(options.wrapper, '[data-blok-database-drawer-content]');
      const order = [...content.children].map((child) => child.tagName.toLowerCase());

      expect(order).toEqual(['textarea', 'div', 'hr', 'div']);
    });
  });

  describe('localization', () => {
    it('routes every drawer label through the injected i18n', () => {
      const i18n: I18n = {
        t: (key: string): string => `i18n:${key}`,
        has: (key: string): boolean => key.startsWith('tools.database.'),
        getEnglishTranslation: (key: string): string => key,
        getLocale: (): string => 'en',
      };
      const options = createOptions({ i18n });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const drawerEl = query(options.wrapper, '[data-blok-database-drawer]');
      const closeBtn = query(options.wrapper, '[data-blok-database-drawer-close]');
      const titleInput = query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]');

      expect(drawerEl.getAttribute('aria-label')).toBe('i18n:tools.database.cardDetails');
      expect(closeBtn.getAttribute('aria-label')).toBe('i18n:tools.database.close');
      expect(titleInput.getAttribute('aria-label')).toBe('i18n:tools.database.cardTitle');
      expect(titleInput.placeholder).toBe('i18n:tools.database.cardTitlePlaceholder');
    });

    it('falls back to the bundled English strings when no i18n is supplied', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const closeBtn = query(options.wrapper, '[data-blok-database-drawer-close]');
      const titleInput = query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]');

      expect(closeBtn.getAttribute('aria-label')).toBe(englishDictionary['tools.database.close']);
      expect(titleInput.placeholder).toBe('Empty page');
    });
  });

  describe('title field', () => {
    it('shows an empty title when the row carries no title property', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow({ properties: {} }));

      expect(query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]').value).toBe('');
    });

    it('empties the title when switching to a row that carries no title property', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      drawer.open(makeRow({ id: 'row-2', properties: {} }));

      expect(query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]').value).toBe('');
    });

    it('stops reporting edits once the drawer is closed', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const titleInput = query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]');

      drawer.close();
      titleInput.value = 'typed after close';
      titleInput.dispatchEvent(new Event('input'));

      expect(options.onTitleChange).not.toHaveBeenCalled();
    });

    it('suppresses Enter only, leaving other keys to the browser', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const titleInput = query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]');
      const letter = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });

      titleInput.dispatchEvent(letter);
      titleInput.dispatchEvent(enter);

      expect(letter.defaultPrevented).toBe(false);
      expect(enter.defaultPrevented).toBe(true);
    });

    it('resets the height to auto when the textarea reports no scroll height', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const titleInput = query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]');

      titleInput.style.height = '50px';
      titleInput.dispatchEvent(new Event('input'));

      expect(titleInput.style.height).toBe('auto');
    });

    it('resizes the title to its scroll height once the open transition ends', () => {
      let frame: FrameRequestCallback | null = null;

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frame = cb;

        return 1;
      });

      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const drawerEl = query(options.wrapper, '[data-blok-database-drawer]');
      const titleInput = query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]');

      Object.defineProperty(titleInput, 'scrollHeight', { value: 96, configurable: true });

      expect(frame).not.toBeNull();
      if (frame !== null) {
        (frame as FrameRequestCallback)(0);
      }
      drawerEl.dispatchEvent(new Event('transitionend'));

      expect(titleInput.style.height).toBe('96px');
    });

    it('resizes the title when switching to another card', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const titleInput = query<HTMLTextAreaElement>(options.wrapper, '[data-blok-database-drawer-title]');

      Object.defineProperty(titleInput, 'scrollHeight', { value: 120, configurable: true });
      drawer.open(makeRow({ id: 'row-2', properties: { 'prop-title': 'Second' } }));

      expect(titleInput.style.height).toBe('120px');
    });
  });

  describe('transition listeners', () => {
    it('registers the open transition listener as a one-shot', () => {
      let frame: FrameRequestCallback | null = null;

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frame = cb;

        return 1;
      });

      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const drawerEl = query(options.wrapper, '[data-blok-database-drawer]');
      const addListener = vi.spyOn(drawerEl, 'addEventListener');

      expect(frame).not.toBeNull();
      if (frame !== null) {
        (frame as FrameRequestCallback)(0);
      }

      expect(addListener).toHaveBeenCalledWith('transitionend', expect.any(Function), { once: true });
    });

    it('registers the close transition listener as a one-shot', () => {
      // rAF is swallowed so the only transitionend registration observable here
      // is the one close() makes.
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const drawerEl = query(options.wrapper, '[data-blok-database-drawer]');
      const addListener = vi.spyOn(drawerEl, 'addEventListener');

      drawer.close();

      expect(addListener).toHaveBeenCalledWith('transitionend', expect.any(Function), { once: true });
    });
  });

  describe('escape key', () => {
    it('closes on Escape raised outside the nested editor', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(drawer.isOpen).toBe(false);
      expect(options.onClose).toHaveBeenCalledOnce();
    });

    it('ignores keys other than Escape', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(drawer.isOpen).toBe(true);
      expect(options.onClose).not.toHaveBeenCalled();
    });

    it('leaves Escape raised inside the editor holder to the nested editor', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const editorHolder = query(options.wrapper, '[data-blok-database-drawer-editor]');
      const inner = document.createElement('div');

      editorHolder.appendChild(inner);
      inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(drawer.isOpen).toBe(true);
      expect(options.onClose).not.toHaveBeenCalled();
    });

    it('drops its Escape listener when the drawer closes', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      drawer.close();
      drawer.open(makeRow());

      const editorHolder = query(options.wrapper, '[data-blok-database-drawer-editor]');
      const inner = document.createElement('div');

      // A listener left over from the first open() closes over the FIRST editor
      // holder, so it does not recognise this target as "inside the editor".
      editorHolder.appendChild(inner);
      inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(drawer.isOpen).toBe(true);
    });
  });

  describe('outside click', () => {
    it('closes when mousedown lands on an element outside the drawer', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const outside = document.createElement('div');

      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(false);
    });

    it('stays open when mousedown lands inside the drawer', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const titleInput = query(options.wrapper, '[data-blok-database-drawer-title]');

      titleInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(true);
      expect(options.onClose).not.toHaveBeenCalled();
    });

    it('drops its document listeners when the drawer is destroyed', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      drawer.destroy();
      drawer.open(makeRow());

      const titleInput = query(options.wrapper, '[data-blok-database-drawer-title]');

      // A listener left over from the first open() closes over the FIRST drawer
      // element, so it reads this target as an outside click.
      titleInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(true);
    });
  });

  describe('focus', () => {
    it('focuses the title textarea when the drawer opens', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      expect(query(options.wrapper, '[data-blok-database-drawer-title]')).toHaveFocus();
    });

    it('does not steal focus when switching to a card that already has a title', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const elsewhere = document.createElement('input');

      document.body.appendChild(elsewhere);
      elsewhere.focus();
      drawer.open(makeRow({ id: 'row-2', properties: { 'prop-title': 'Second card' } }));

      expect(elsewhere).toHaveFocus();
    });
  });

  describe('close and destroy guards', () => {
    it('close() on a drawer that was never opened reports nothing', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      expect(() => drawer.close()).not.toThrow();
      expect(options.onClose).not.toHaveBeenCalled();
    });

    it('destroy() on a drawer that was never opened is a no-op', () => {
      const drawer = makeDrawer(createOptions());

      expect(() => drawer.destroy()).not.toThrow();
      expect(drawer.isOpen).toBe(false);
    });

    it('destroy() removes its own drawer element even after it was reparented', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const drawerEl = query(options.wrapper, '[data-blok-database-drawer]');

      // destroy()'s trailing sweep only reaches descendants of the wrapper, so
      // this is the only assertion that sees the drawer remove its own element.
      document.body.appendChild(drawerEl);
      drawer.destroy();

      expect(drawerEl.isConnected).toBe(false);
    });

    it('destroy() closes the drawer and takes its element out of the wrapper', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      drawer.destroy();

      expect(drawer.isOpen).toBe(false);
      expect(options.wrapper.querySelector('[data-blok-database-drawer]')).toBeNull();
    });

    it('stops touching the document once its listeners are already gone', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const remove = vi.spyOn(document, 'removeEventListener');

      drawer.close();
      expect(remove.mock.calls.map((call) => call[0])).toEqual(['keydown', 'mousedown']);

      // The handlers are nulled by the first close, so a second one has nothing
      // left to unregister.
      drawer.close();
      expect(remove).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshSchema', () => {
    it('does nothing while the drawer is closed', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      expect(() => drawer.refreshSchema([makeDef({ type: 'text', name: 'Notes' })])).not.toThrow();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-props]')).toBeNull();
    });

    it('does nothing when a failed open() left the row set but the panel unbuilt', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      // open() records the row before it builds the panel, so a throw in between
      // leaves currentRow set with no drawer behind it.
      expect(() => drawer.open({
        id: 'row-1',
        position: 'a0',
        properties: undefined as unknown as DatabaseRow['properties'],
      })).toThrow();

      expect(() => drawer.refreshSchema([makeDef({ type: 'text', name: 'Notes' })])).not.toThrow();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-props]')).toBeNull();
    });

    it('re-inserts the rebuilt properties section above the divider', () => {
      const options = createOptions({ schema: [makeDef({ id: 'prop-a', name: 'A', type: 'text' })] });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      drawer.refreshSchema([
        makeDef({ id: 'prop-a', name: 'A', type: 'text', position: 'a1' }),
        makeDef({ id: 'prop-b', name: 'B', type: 'text', position: 'a2' }),
      ]);

      const content = query(options.wrapper, '[data-blok-database-drawer-content]');
      const labels = [...content.querySelectorAll('[data-blok-database-drawer-prop-label]')]
        .map((el) => el.textContent);

      expect(labels).toEqual(['A', 'B']);
      expect([...content.children].map((child) => child.tagName.toLowerCase()))
        .toEqual(['textarea', 'div', 'hr', 'div']);
    });

    it('survives a drawer whose content element was removed from the outside', () => {
      const options = createOptions({ schema: [makeDef({ type: 'text', name: 'Notes' })] });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      query(options.wrapper, '[data-blok-database-drawer-content]').remove();

      expect(() => drawer.refreshSchema([makeDef({ type: 'text', name: 'Other' })])).not.toThrow();
    });
  });

  describe('switching cards', () => {
    it('survives a drawer whose content element was removed from the outside', () => {
      const options = createOptions({ schema: [makeDef({ type: 'text', name: 'Notes' })] });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      query(options.wrapper, '[data-blok-database-drawer-content]').remove();

      expect(() => drawer.open(makeRow({ id: 'row-2' }))).not.toThrow();
    });

    it('re-inserts the rebuilt properties section above the divider', () => {
      const options = createOptions({ schema: [makeDef({ id: 'prop-a', name: 'A', type: 'text' })] });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      drawer.open(makeRow({ id: 'row-2' }));

      const content = query(options.wrapper, '[data-blok-database-drawer-content]');

      expect([...content.children].map((child) => child.tagName.toLowerCase()))
        .toEqual(['textarea', 'div', 'hr', 'div']);
    });

    it('empties the editor holder before rebuilding the nested editor', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const editorHolder = query(options.wrapper, '[data-blok-database-drawer-editor]');

      editorHolder.innerHTML = '<p>stale editor</p>';
      drawer.open(makeRow({ id: 'row-2' }));

      expect(editorHolder.innerHTML).toBe('');
    });
  });

  describe('nested description editor', () => {
    it('hands the row description to the nested editor', async () => {
      const description: OutputData = { blocks: [{ type: 'paragraph', data: { text: 'hi' } }] };
      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-desc': description } }));

      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      expect(nested.created[0].config.data).toBe(description);
      expect(nested.created[0].config.holder)
        .toBe(query(options.wrapper, '[data-blok-database-drawer-editor]'));
    });

    it('passes no description when no description property id is configured', async () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      // A property keyed by the literal string "undefined" is what an index on an
      // unset description property id would pick up.
      drawer.open(makeRow({ properties: { 'prop-title': 'Card', undefined: { blocks: [] } } }));

      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      expect(nested.created[0].config.data).toBeUndefined();
    });

    it('builds a fresh editor for the card it switches to', async () => {
      const second: OutputData = { blocks: [{ type: 'paragraph', data: { text: 'second' } }] };
      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      drawer.open(makeRow({ id: 'row-2', properties: { 'prop-title': 'Second', 'prop-desc': second } }));
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(2);
      }, WAIT);

      expect(nested.created[1].config.data).toBe(second);
    });

    it('saves and destroys the nested editor when the drawer closes', async () => {
      nested.savePayload = { blocks: [{ type: 'paragraph', data: { text: 'saved' } }] };

      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      drawer.close();

      await vi.waitFor(() => {
        expect(nested.created[0].destroyCalls).toBe(1);
      }, WAIT);

      expect(nested.created[0].saveCalls).toBe(1);
      expect(options.onDescriptionChange).toHaveBeenCalledWith('row-1', nested.savePayload);
    });

    it('destroys the nested editor even when its save rejects', async () => {
      nested.rejectSave = true;

      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      drawer.close();

      await vi.waitFor(() => {
        expect(nested.created[0].destroyCalls).toBe(1);
      }, WAIT);

      expect(options.onDescriptionChange).not.toHaveBeenCalled();
    });

    it('destroys the nested editor when the drawer is destroyed', async () => {
      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      drawer.destroy();

      await vi.waitFor(() => {
        expect(nested.created[0].destroyCalls).toBe(1);
      }, WAIT);
    });

    it('saves the previous card description before switching cards', async () => {
      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      drawer.open(makeRow({ id: 'row-2' }));

      await vi.waitFor(() => {
        expect(options.onDescriptionChange).toHaveBeenCalledWith('row-1', nested.savePayload);
      }, WAIT);
      expect(nested.created[0].destroyCalls).toBe(1);
    });

    it('reports no description for an editor that finished loading after the close', async () => {
      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      // close() runs before the dynamic import settles, so the editor is adopted
      // with no current row behind it.
      drawer.open(makeRow());
      drawer.close();

      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      drawer.destroy();

      await vi.waitFor(() => {
        expect(nested.created[0].destroyCalls).toBe(1);
      }, WAIT);
      expect(options.onDescriptionChange).not.toHaveBeenCalled();
    });

    it('reports the saved description when the nested editor changes', async () => {
      nested.savePayload = { blocks: [{ type: 'paragraph', data: { text: 'edited' } }] };

      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      await nested.created[0].config.onChange();

      expect(options.onDescriptionChange).toHaveBeenCalledWith('row-1', nested.savePayload);
    });

    it('reports nothing when the nested editor changes after the drawer closed', async () => {
      const options = createOptions({ descriptionPropertyId: 'prop-desc' });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());
      await vi.waitFor(() => {
        expect(nested.created).toHaveLength(1);
      }, WAIT);

      drawer.close();
      await vi.waitFor(() => {
        expect(nested.created[0].destroyCalls).toBe(1);
      }, WAIT);

      vi.mocked(options.onDescriptionChange).mockClear();
      await nested.created[0].config.onChange();

      expect(options.onDescriptionChange).not.toHaveBeenCalled();
    });
  });

  describe('property type popover', () => {
    it('reuses one popover across repeated clicks on "Add a property"', () => {
      const options = createOptions();
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const addBtn = query(options.wrapper, '[data-blok-database-drawer-add-prop]');

      addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(document.body.querySelectorAll('[data-blok-database-property-type-popover]')).toHaveLength(1);
    });

    it('survives the drawer being destroyed from inside onAddProperty', () => {
      const errors: string[] = [];
      const onError = (e: Event): void => {
        errors.push(e instanceof ErrorEvent ? e.message : 'unknown');
      };

      window.addEventListener('error', onError);

      let target: DatabaseCardDrawer | null = null;
      const options = createOptions({
        onAddProperty: (): void => {
          target?.destroy();
        },
      });
      const drawer = makeDrawer(options);

      target = drawer;
      drawer.open(makeRow());
      query(options.wrapper, '[data-blok-database-drawer-add-prop]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      query(document.body, '[data-blok-database-property-type-option="text"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));

      window.removeEventListener('error', onError);

      // jsdom swallows a listener throw into window's error event, so the throw
      // is invisible to expect().not.toThrow().
      expect(errors).toEqual([]);
    });
  });

  describe('properties section', () => {
    it('sorts properties by position, not by schema order', () => {
      const options = createOptions({
        schema: [
          makeDef({ id: 'prop-b', name: 'B', type: 'text', position: 'b1' }),
          makeDef({ id: 'prop-a', name: 'A', type: 'text', position: 'a1' }),
          makeDef({ id: 'prop-c', name: 'C', type: 'text', position: 'c1' }),
        ],
      });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const labels = [...options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-label]')]
        .map((el) => el.textContent);

      expect(labels).toEqual(['A', 'B', 'C']);
    });

    it('keeps schema order for properties that share a position', () => {
      const options = createOptions({
        schema: [
          makeDef({ id: 'prop-x', name: 'X', type: 'text', position: 'a1' }),
          makeDef({ id: 'prop-y', name: 'Y', type: 'text', position: 'a1' }),
        ],
      });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      const labels = [...options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-label]')]
        .map((el) => el.textContent);

      expect(labels).toEqual(['X', 'Y']);
    });

    it('paints a select pill with the option colour tokens', () => {
      const options = createOptions({
        schema: [makeDef({ config: { options: [makeOption({ color: 'blue' })] } })],
      });
      const drawer = makeDrawer(options);

      drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } }));

      const pill = query<HTMLElement>(options.wrapper, '[data-blok-database-drawer-prop-pill]');
      const dot = query<HTMLElement>(options.wrapper, '[data-blok-database-drawer-prop-dot]');

      expect(pill.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
      expect(pill.style.color).toBe('var(--blok-color-blue-text)');
      expect(dot.style.backgroundColor).toBe('var(--blok-color-blue-text)');
    });

    it('leaves a colourless option without a dot or colour tokens', () => {
      const options = createOptions({
        schema: [makeDef({ config: { options: [makeOption({ color: undefined })] } })],
      });
      const drawer = makeDrawer(options);

      drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } }));

      const pill = query<HTMLElement>(options.wrapper, '[data-blok-database-drawer-prop-pill]');

      expect(pill.querySelector('[data-blok-database-drawer-prop-dot]')).toBeNull();
      expect(pill.style.backgroundColor).toBe('');
      expect(pill.textContent).toBe('In progress');
    });

    it('renders no pill for a select definition that carries no options config', () => {
      const options = createOptions({ schema: [makeDef({ config: undefined })] });
      const drawer = makeDrawer(options);

      expect(() => drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } })))
        .not.toThrow();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]')).toBeNull();
    });

    it('ignores a select value that is not a string, even when an option id matches it', () => {
      // Option ids are typed as strings; stored data can still carry a number,
      // and only the `typeof value === 'string'` guard keeps the two apart.
      const numericId = makeOption({ id: 42 as unknown as string, label: 'Numeric' });
      const options = createOptions({ schema: [makeDef({ config: { options: [numericId] } })] });
      const drawer = makeDrawer(options);

      drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 42 } }));

      expect(options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]')).toBeNull();
    });

    it('renders one pill per resolvable multiSelect id and skips the rest', () => {
      const options = createOptions({
        schema: [makeDef({ type: 'multiSelect', config: { options: [makeOption({ id: 'opt-1' })] } })],
      });
      const drawer = makeDrawer(options);

      expect(() => drawer.open(makeRow({
        properties: { 'prop-title': 'Card', 'prop-status': ['opt-1', 'missing'] },
      }))).not.toThrow();
      expect(options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-pill]')).toHaveLength(1);
    });

    it('treats a multiSelect value that is not an array as no selection at all', () => {
      // The option id is the sentinel a substituted default array would carry,
      // and a scalar value that happens to equal a real id must still resolve
      // to nothing.
      const options = createOptions({
        schema: [makeDef({
          type: 'multiSelect',
          config: { options: [makeOption({ id: 'Stryker was here', label: 'Ghost' })] },
        })],
      });
      const drawer = makeDrawer(options);

      drawer.open(makeRow({ properties: { 'prop-title': 'Card', 'prop-status': 'opt-1' } }));

      expect(options.wrapper.querySelectorAll('[data-blok-database-drawer-prop-pill]')).toHaveLength(0);
    });

    it('renders no pills for a multiSelect definition that carries no options config', () => {
      const options = createOptions({ schema: [makeDef({ type: 'multiSelect', config: undefined })] });
      const drawer = makeDrawer(options);

      expect(() => drawer.open(makeRow({
        properties: { 'prop-title': 'Card', 'prop-status': ['opt-1'] },
      }))).not.toThrow();
      expect(options.wrapper.querySelector('[data-blok-database-drawer-prop-pill]')).toBeNull();
    });

    it('leaves the value blank when the row has no value for the property', () => {
      const options = createOptions({ schema: [makeDef({ id: 'prop-notes', name: 'Notes', type: 'text' })] });
      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      expect(query(options.wrapper, '[data-blok-database-drawer-prop-value]').textContent).toBe('');
    });
  });

  describe('active card marker', () => {
    it('marks the open card and clears it on close, including a card whose id is "null"', () => {
      const options = createOptions();
      const opened = document.createElement('div');
      const literalNull = document.createElement('div');

      opened.setAttribute('data-blok-database-card', '');
      opened.setAttribute('data-row-id', 'row-1');
      literalNull.setAttribute('data-blok-database-card', '');
      literalNull.setAttribute('data-row-id', 'null');
      options.wrapper.append(opened, literalNull);

      const drawer = makeDrawer(options);

      drawer.open(makeRow());

      expect(opened.getAttribute('data-blok-database-card-active')).toBe('');

      drawer.close();

      expect(options.wrapper.querySelector('[data-blok-database-card-active]')).toBeNull();
    });
  });
});
