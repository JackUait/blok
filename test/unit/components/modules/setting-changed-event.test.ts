import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { SettingChanged } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { EditorWidth } from '../../../../types';

interface Bus { on: (name: string, handler: (payload: unknown) => void) => void }

interface Runtime {
  events: Bus;
  theme: { set: (mode: 'light' | 'dark' | 'auto') => void };
  width: { set: (mode: EditorWidth) => void; toggle: () => void };
}

const editors: Blok[] = [];

const createEditor = async (config: Record<string, unknown>): Promise<Runtime> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({ holder, minHeight: 50, tabSync: false, ...config });

  editors.push(editor);
  await editor.isReady;

  // `events` reaches the instance through the API prototype swap; the class type does not list it.
  return editor as unknown as Runtime;
};

/** Every SettingChanged emitted on any editor bus, boot included. */
const spySettingEmits = (): (() => unknown[]) => {
  const emit = vi.spyOn(EventsDispatcher.prototype, 'emit');

  return () => emit.mock.calls.filter(([name]) => name === SettingChanged).map((call): unknown => call[1]);
};

describe('SettingChanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    for (const editor of editors) {
      await editor.isReady;
      editor.destroy();
    }
    editors.length = 0;
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-blok-theme');
    vi.restoreAllMocks();
  });

  it('emits when the host changes theme or width at runtime', async () => {
    const editor = await createEditor({});
    const heard = vi.fn();

    editor.events.on(SettingChanged, heard);

    editor.theme.set('dark');
    editor.width.set('full');

    expect(heard).toHaveBeenNthCalledWith(1, { setting: 'theme', value: 'dark' });
    expect(heard).toHaveBeenNthCalledWith(2, { setting: 'width', value: 'full' });
  });

  it('width toggle emits the new mode', async () => {
    const editor = await createEditor({});
    const heard = vi.fn();

    editor.events.on(SettingChanged, heard);
    editor.width.toggle();

    expect(heard).toHaveBeenCalledWith({ setting: 'width', value: 'full' });
  });

  it('stays silent for the boot config', async () => {
    const emitted = spySettingEmits();

    await createEditor({ theme: 'dark' });

    expect(emitted()).toEqual([]);
  });

  it('stays silent when a value set before ready is replayed', async () => {
    const emitted = spySettingEmits();
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({ holder, minHeight: 50, tabSync: false });
    const runtime = editor as unknown as Runtime;

    editors.push(editor);
    runtime.theme.set('dark');
    runtime.width.set('full');
    await editor.isReady;

    expect(emitted()).toEqual([]);
    expect(document.documentElement.getAttribute('data-blok-theme')).toBe('dark');
  });

  it('stays silent when the value does not change', async () => {
    const editor = await createEditor({ theme: 'dark' });
    const heard = vi.fn();

    editor.events.on(SettingChanged, heard);
    editor.theme.set('dark');
    editor.width.set('narrow');

    expect(heard).not.toHaveBeenCalled();
  });
});
