import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataDirectory, loadIndex, readFile, writeFile } from './storage';

afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('workspace storage', () => {
  it('creates a persistent page index in the browser preview', async () => {
    const first = await loadIndex();
    expect(first.pages).toHaveLength(1);
    expect(first.pages[0]?.id).toBe(first.activeId);
    expect(await loadIndex()).toEqual(first);
    await writeFile(first.activeId, JSON.stringify({ title: 'Saved', blocks: [] }));
    expect(JSON.parse((await readFile(first.activeId)) ?? '{}')).toMatchObject({ title: 'Saved' });
  });

  it('uses the Tauri data directory and native commands in the desktop app', async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'workspace_data_directory') return '/Users/test/Library/Application Support/dev.notiooon.blok/workspace';
      if (command === 'load_workspace_file') return null;
      if (command === 'save_workspace_file') return args?.data;
      throw new Error(command);
    });
    Reflect.set(window, '__TAURI_INTERNALS__', { invoke });
    expect(await dataDirectory()).toContain('Application Support/dev.notiooon.blok/workspace');
    expect(await readFile('index')).toBeNull();
    await writeFile('index', '{}');
    expect(invoke).toHaveBeenCalledWith('save_workspace_file', { name: 'index', data: '{}' });
  });

  it('restores each page’s full-width setting independently', async () => {
    const first = await loadIndex();
    const wide = { ...first.pages[0]!, fullWidth: true };
    const narrow = { id: crypto.randomUUID(), title: 'Notes', parentId: null, fullWidth: false };
    await writeFile('index', JSON.stringify({ pages: [wide, narrow], activeId: wide.id, trash: [] }));
    const restored = await loadIndex();
    expect(restored.pages[0]?.fullWidth).toBe(true);
    expect(restored.pages[1]?.fullWidth).toBe(false);
  });
});
