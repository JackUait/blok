import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import { EDITOR_CONSTRUCTOR, registerEditorConstructor } from '../../../../src/components/utils/editor-constructor';
import type { ToolsConfig } from '../../../../types/api/tools';

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => ({
  wrapper: document.createElement('div'),
  readOnly: false,
  titlePropertyId: 'prop-title',
  schema: [],
  onTitleChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

const row = { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Test card' } };

const stubEditor = (): ReturnType<typeof vi.fn> => vi.fn(function stubBlok() {
  return { isReady: Promise.resolve(), save: vi.fn().mockResolvedValue({ blocks: [] }), destroy: vi.fn() };
});

describe('the card body editor comes from the host editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, EDITOR_CONSTRUCTOR);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, EDITOR_CONSTRUCTOR);
  });

  it('builds the body with the editor the page already constructed', async () => {
    const editor = stubEditor();
    const toolsConfig: ToolsConfig = { tools: { paragraph: { class: class {} as never } }, inlineToolbar: ['bold'] };
    const options = createOptions({ toolsConfig });

    registerEditorConstructor(editor as never);
    const drawer = new DatabaseCardDrawer(options);

    drawer.open(row);

    const holder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

    await vi.waitFor(() => expect(editor).toHaveBeenCalledTimes(1), { timeout: 20000 });
    expect(editor).toHaveBeenCalledWith(expect.objectContaining({
      holder,
      tools: toolsConfig.tools,
      inlineToolbar: ['bold'],
      readOnly: false,
      tabSync: false,
      i18n: { direction: 'ltr' },
    }));
    drawer.destroy();
  }, 30000);

  it('opens with a title, mounts no body and warns when no editor exists on the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const options = createOptions();
    const drawer = new DatabaseCardDrawer(options);

    expect(() => drawer.open(row)).not.toThrow();
    // The warning comes from the failed load, so after it no other path may mount an editor.
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const title = options.wrapper.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');
    const holder = options.wrapper.querySelector('[data-blok-database-drawer-editor]');

    expect(holder?.childNodes.length).toBe(0);
    expect(holder?.querySelector('[data-blok-editor]')).toBeNull();
    expect(String(warn.mock.calls[0]?.[0])).toContain('no Blok editor on the page');
    expect(title?.value).toBe('Test card');
    drawer.destroy();
  });

  it('warns once per drawer, however often it opens a card', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(row);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    drawer.open({ ...row, id: 'row-2' });
    drawer.open(row);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(warn).toHaveBeenCalledTimes(1);
    drawer.destroy();
  });

  it('does not warn when the registered editor itself fails to start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(function failingBlok() {
      throw new Error('boom');
    });

    registerEditorConstructor(failing as never);
    const drawer = new DatabaseCardDrawer(createOptions());

    drawer.open(row);
    await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(warn).not.toHaveBeenCalled();
    drawer.destroy();
  });
});
