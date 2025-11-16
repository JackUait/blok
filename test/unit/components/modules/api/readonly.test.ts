import { afterEach, describe, expect, it, vi } from 'vitest';

import ReadOnlyAPI from '../../../../../src/components/modules/api/readonly';
import EventsDispatcher from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorConfig } from '../../../../../types';
import type { EditorEventMap } from '../../../../../src/components/events';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';

type ReadOnlyModuleStub = {
  toggle: ReturnType<typeof vi.fn<[boolean | undefined], Promise<boolean>>>;
  isEnabled: boolean;
};

type EditorStub = {
  ReadOnly: ReadOnlyModuleStub;
};

const createReadOnlyApi = (overrides: Partial<ReadOnlyModuleStub> = {}): {
  readOnlyApi: ReadOnlyAPI;
  editor: EditorStub;
} => {
  const moduleConfig: ModuleConfig = {
    config: {} as EditorConfig,
    eventsDispatcher: new EventsDispatcher<EditorEventMap>(),
  };

  const readOnlyApi = new ReadOnlyAPI(moduleConfig);

  const defaultReadOnlyModule: ReadOnlyModuleStub = {
    toggle: vi.fn<[boolean | undefined], Promise<boolean>>().mockResolvedValue(false),
    isEnabled: false,
  };

  const editor: EditorStub = {
    ReadOnly: {
      ...defaultReadOnlyModule,
      ...overrides,
    },
  };

  readOnlyApi.state = editor as unknown as EditorModules;

  return {
    readOnlyApi,
    editor,
  };
};

describe('ReadOnlyAPI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes toggle via the methods getter', async () => {
    const { readOnlyApi } = createReadOnlyApi();
    const toggleSpy = vi.spyOn(readOnlyApi, 'toggle').mockResolvedValue(true);

    await expect(readOnlyApi.methods.toggle(true)).resolves.toBe(true);
    expect(toggleSpy).toHaveBeenCalledWith(true);
  });

  it('reflects current state via the methods getter', () => {
    const { readOnlyApi, editor } = createReadOnlyApi();

    expect(readOnlyApi.methods.isEnabled).toBe(false);

    editor.ReadOnly.isEnabled = true;

    expect(readOnlyApi.methods.isEnabled).toBe(true);
  });

  it('delegates toggle calls to the Editor module', async () => {
    const { readOnlyApi, editor } = createReadOnlyApi();

    editor.ReadOnly.toggle.mockResolvedValueOnce(true);

    await expect(readOnlyApi.toggle(true)).resolves.toBe(true);
    expect(editor.ReadOnly.toggle).toHaveBeenCalledWith(true);
  });

  it('reads isEnabled from the Editor module', () => {
    const { readOnlyApi, editor } = createReadOnlyApi();

    editor.ReadOnly.isEnabled = true;
    expect(readOnlyApi.isEnabled).toBe(true);

    editor.ReadOnly.isEnabled = false;
    expect(readOnlyApi.isEnabled).toBe(false);
  });
});
