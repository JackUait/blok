import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ShortcutData } from '../../../src/components/utils/shortcuts';
import type Shortcuts from '../../../src/components/utils/shortcuts';

type ShortcutHandler = ShortcutData['handler'];

interface ShortcutMockInstance {
  name: string;
  on: HTMLElement | Document;
  callback: ShortcutHandler;
  remove: ReturnType<typeof vi.fn>;
}

const shortcutInstances: ShortcutMockInstance[] = [];

const ShortcutConstructor = vi.fn();

vi.mock('../../../src/components/utils/shortcut', () => ({
  default: ShortcutConstructor,
}));

type ShortcutsApi = typeof Shortcuts;

let shortcuts: ShortcutsApi;

const importShortcuts = async (): Promise<void> => {
  const module = await import('../../../src/components/utils/shortcuts');

  shortcuts = module.default;
};

beforeEach(async () => {
  shortcutInstances.length = 0;
  vi.clearAllMocks();
  vi.resetModules();

  ShortcutConstructor.mockImplementation(function (
    this: ShortcutMockInstance,
    config: {
      name: string;
      on: HTMLElement | Document;
      callback: ShortcutHandler;
    }
  ) {
    this.name = config.name;
    this.on = config.on;
    this.callback = config.callback;
    this.remove = vi.fn();

    shortcutInstances.push(this);
  });

  await importShortcuts();
});

describe('Shortcuts', () => {
  const createShortcut = (overrides: Partial<ShortcutData> = {}): ShortcutData => {
    return {
      name: 'CMD+B',
      handler: vi.fn(),
      on: document.createElement('div'),
      ...overrides,
    };
  };

  it('registers a new shortcut through the constructor', () => {
    const shortcut = createShortcut();

    shortcuts.add(shortcut);

    expect(ShortcutConstructor).toHaveBeenCalledTimes(1);
    expect(ShortcutConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: shortcut.name,
        on: shortcut.on,
        callback: shortcut.handler,
      })
    );

    expect(shortcutInstances).toHaveLength(1);
    expect(shortcutInstances[0]).toMatchObject({
      name: shortcut.name,
      on: shortcut.on,
      callback: shortcut.handler,
    });
  });

  it('throws when registering the same shortcut twice for the same element', () => {
    const shortcut = createShortcut();

    shortcuts.add(shortcut);

    expect(() => shortcuts.add(shortcut)).toThrow(/already registered/);
  });

  it('allows the same shortcut name on different elements', () => {
    const elementA = document.createElement('div');
    const elementB = document.createElement('div');

    shortcuts.add(createShortcut({ on: elementA }));

    expect(() => shortcuts.add(createShortcut({ on: elementB }))).not.toThrow();
    expect(ShortcutConstructor).toHaveBeenCalledTimes(2);
  });

  it('removes a registered shortcut and allows it to be registered again', () => {
    const shortcut = createShortcut();

    shortcuts.add(shortcut);

    const [ instance ] = shortcutInstances;

    shortcuts.remove(shortcut.on, shortcut.name);

    expect(instance.remove).toHaveBeenCalledTimes(1);
    expect(() => shortcuts.add(createShortcut({ on: shortcut.on }))).not.toThrow();
    expect(ShortcutConstructor).toHaveBeenCalledTimes(2);
  });

  it('ignores removal requests for shortcuts that were never registered', () => {
    const registeredShortcut = createShortcut();
    const otherElement = document.createElement('div');

    shortcuts.add(registeredShortcut);

    const [ instance ] = shortcutInstances;

    expect(() => shortcuts.remove(otherElement, registeredShortcut.name)).not.toThrow();
    expect(instance.remove).not.toHaveBeenCalled();
    expect(ShortcutConstructor).toHaveBeenCalledTimes(1);
  });
});

