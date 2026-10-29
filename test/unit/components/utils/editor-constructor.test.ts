import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EditorConstructor from '../../../../src/components/utils/editor-constructor';
import { EDITOR_CONSTRUCTOR } from '../../../../src/components/utils/editor-constructor';

const freshModule = async (): Promise<typeof EditorConstructor> => {
  vi.resetModules();

  return import('../../../../src/components/utils/editor-constructor');
};

describe('editor constructor registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, EDITOR_CONSTRUCTOR);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, EDITOR_CONSTRUCTOR);
  });

  it('rejects when no editor was ever constructed', async () => {
    const { loadEditorConstructor, NoEditorConstructorError } = await freshModule();

    await expect(loadEditorConstructor()).rejects.toBeInstanceOf(NoEditorConstructorError);
  });

  it('hands back the constructor that was registered', async () => {
    const { registerEditorConstructor, loadEditorConstructor } = await freshModule();
    const Editor = vi.fn();

    registerEditorConstructor(Editor as never);

    await expect(loadEditorConstructor()).resolves.toBe(Editor);
  });

  it('is shared by two copies of the module, like the ESM and CJS builds', async () => {
    const first = await freshModule();
    const Editor = vi.fn();

    first.registerEditorConstructor(Editor as never);
    const second = await freshModule();

    expect(second).not.toBe(first);
    await expect(second.loadEditorConstructor()).resolves.toBe(Editor);
  });
});
