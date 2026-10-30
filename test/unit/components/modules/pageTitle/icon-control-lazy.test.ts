import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import type { createIconControl as CreateIconControl } from '../../../../../src/components/modules/pageTitle/icon-control';
import type { PageIcon } from '../../../../../types/tools/page';

/** Holds the picker's chunk back, or fails it. */
const chunk = vi.hoisted(() => ({
  gate: Promise.resolve(),
  release: (): void => undefined,
  fail: false,
  open: null as null | ((anchor: HTMLElement) => Promise<void>),
}));

const PICKER = '../../../../../src/tools/callout/emoji-picker';
const CONTROL = '../../../../../src/components/modules/pageTitle/icon-control';

const pickerModule = async (): Promise<unknown> => {
  await chunk.gate;
  if (chunk.fail) {
    throw new Error('offline');
  }

  return {
    EmojiPicker: class {
      private readonly el = document.createElement('div');

      public getElement(): HTMLElement {
        return this.el;
      }

      public isOpen(): boolean {
        return false;
      }

      public open = (anchor: HTMLElement): Promise<void> => chunk.open?.(anchor) ?? Promise.resolve();

      public close = (): void => undefined;
    },
  };
};

/** A fresh module graph, so each test loads the picker's chunk anew. */
const freshControl = async (initial: PageIcon | null): Promise<{
  row: HTMLElement;
  state: { readOnly: boolean };
  control: ReturnType<typeof CreateIconControl>;
}> => {
  vi.resetModules();
  vi.doMock(PICKER, pickerModule);
  const { createIconControl } = await import(CONTROL);
  const row = document.createElement('div');
  const state = { icon: initial, readOnly: false };

  document.body.append(row);
  const control = createIconControl(row, {
    getIcon: () => state.icon,
    setIcon: (icon: PageIcon | null) => {
      state.icon = icon;
    },
    isReadOnly: () => state.readOnly,
    labels: () => ({ add: 'Add icon', change: 'Change icon' }),
    picker: () => ({ i18n: { t: (key: string) => key }, locale: 'en' }),
  });

  return { row, state, control };
};

const iconButton = (row: HTMLElement): HTMLButtonElement | null => row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`);

const settle = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

describe('the page icon loads the picker code on first open', () => {
  const controls: Array<{ destroy(): void }> = [];
  const open = vi.fn(async (_anchor: HTMLElement) => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    chunk.fail = false;
    chunk.open = open;
    chunk.gate = new Promise<void>((resolve) => {
      chunk.release = resolve;
    });
  });

  afterEach(() => {
    controls.splice(0).forEach((control) => control.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a click before the code lands opens the picker once it does', async () => {
    const { row, control } = await freshControl({ type: 'emoji', value: '🌿' });

    controls.push(control);
    iconButton(row)?.click();
    await settle();
    expect(open).not.toHaveBeenCalled();
    chunk.release();

    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(iconButton(row)));
    expect(iconButton(row)?.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens no picker when the control is destroyed before the code lands', async () => {
    const { row, control } = await freshControl({ type: 'emoji', value: '🌿' });
    const button = iconButton(row);

    button?.click();
    control.destroy();
    chunk.release();
    await settle();
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(document.body.children).toHaveLength(1);
  });

  it('opens no picker when read-only engages before the code lands', async () => {
    const { row, state, control } = await freshControl({ type: 'emoji', value: '🌿' });

    controls.push(control);
    iconButton(row)?.click();
    state.readOnly = true;
    chunk.release();
    await settle();
    await settle();

    expect(open).not.toHaveBeenCalled();
  });

  it('a picker chunk that fails to load opens nothing and throws nothing', async () => {
    chunk.fail = true;
    chunk.release();
    const { row, control } = await freshControl({ type: 'emoji', value: '🌿' });

    controls.push(control);
    iconButton(row)?.click();
    await settle();
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(iconButton(row)?.hasAttribute('aria-expanded')).toBe(false);
  });
});
