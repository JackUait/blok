import { describe, it, expect, beforeEach, vi } from 'vitest';
import InlineToolbarAPI from '../../../../../src/components/modules/api/inlineToolbar';
import EventsDispatcher from '../../../../../src/components/utils/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';
import type { EditorConfig } from '../../../../../types';
import type { EditorEventMap } from '../../../../../src/components/events';

type InlineToolbarEditorMock = {
  InlineToolbar: {
    tryToShow: ReturnType<typeof vi.fn<() => Promise<void>>>;
    close: ReturnType<typeof vi.fn>;
  };
};

describe('InlineToolbarAPI', () => {
  let inlineToolbarApi: InlineToolbarAPI;
  let editorMock: InlineToolbarEditorMock;

  const createInlineToolbarApi = (overrides?: Partial<InlineToolbarEditorMock>): void => {
    const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
    const moduleConfig: ModuleConfig = {
      config: {} as EditorConfig,
      eventsDispatcher,
    };

    inlineToolbarApi = new InlineToolbarAPI(moduleConfig);
    editorMock = {
      InlineToolbar: {
        tryToShow: vi.fn((): Promise<void> => Promise.resolve()),
        close: vi.fn(),
      },
      ...overrides,
    };

    inlineToolbarApi.state = editorMock as unknown as EditorModules;
  };

  beforeEach(() => {
    createInlineToolbarApi();
  });

  it('exposes inline toolbar controls via methods getter', () => {
    const openSpy = vi.spyOn(inlineToolbarApi, 'open').mockImplementation(() => {});
    const closeSpy = vi.spyOn(inlineToolbarApi, 'close').mockImplementation(() => {});

    const { open, close } = inlineToolbarApi.methods;

    open();
    close();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('opens inline toolbar through Editor module', () => {
    inlineToolbarApi.open();

    expect(editorMock.InlineToolbar.tryToShow).toHaveBeenCalledTimes(1);
  });

  it('closes inline toolbar through Editor module', () => {
    inlineToolbarApi.close();

    expect(editorMock.InlineToolbar.close).toHaveBeenCalledTimes(1);
  });
});
