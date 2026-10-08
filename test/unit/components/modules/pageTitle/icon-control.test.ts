import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { createIconControl, type IconControlHost } from '../../../../../src/components/modules/pageTitle/icon-control';
import type { PageIcon } from '../../../../../types/tools/page';

const open = vi.fn(async () => undefined);
const close = vi.fn();
let lastOptions: { onSelect(native: string): void; onRemove(): void } | null = null;

vi.mock('../../../../../src/tools/callout/emoji-picker', () => ({
  EmojiPicker: class {
    private readonly el = document.createElement('div');
    constructor(options: { onSelect(native: string): void; onRemove(): void }) {
      lastOptions = options;
    }
    public getElement(): HTMLElement {
      return this.el;
    }
    public isOpen(): boolean {
      return false;
    }
    public open = open;
    public close = close;
  },
}));
vi.mock('../../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiGrid: vi.fn(async () => [{ native: '🚀' }]),
}));

describe('createIconControl', () => {
  const controls: Array<{ destroy(): void }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    lastOptions = null;
  });

  afterEach(() => {
    controls.splice(0).forEach((control) => control.destroy());
    vi.restoreAllMocks();
  });

  const setup = (initial: PageIcon | null, options: { readOnly?: boolean } = {}): { row: HTMLElement; host: IconControlHost & { setIcon: ReturnType<typeof vi.fn> } } => {
    const row = document.createElement('div');
    const state = { icon: initial };
    const slot: { redraw: () => void } = { redraw: () => undefined };
    const host = {
      getIcon: () => state.icon,
      setIcon: vi.fn((icon: PageIcon | null) => {
        state.icon = icon;
        slot.redraw();
      }),
      isReadOnly: () => options.readOnly ?? false,
      labels: () => ({ add: 'Add icon', change: 'Change icon' }),
      picker: () => ({ i18n: { t: (key: string) => key }, locale: 'en' }),
    };
    const control = createIconControl(row, host);

    slot.redraw = control.redraw;
    controls.push(control);

    return { row, host };
  };

  it('no icon: shows Add icon; click sets a random emoji and opens the picker', async () => {
    const { row, host } = setup(null);

    const add = row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageAddIcon}]`);

    expect(add?.textContent).toContain('Add icon');
    add?.click();
    await vi.waitFor(() => expect(host.setIcon).toHaveBeenCalledWith({ type: 'emoji', value: '🚀' }));
    expect(open).toHaveBeenCalled();
  });

  it('icon set: shows the emoji; click opens the picker without changing it', () => {
    const { row, host } = setup({ type: 'emoji', value: '🌿' });
    const button = row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`);

    expect(button?.textContent).toBe('🌿');
    expect(button?.getAttribute('aria-label')).toBe('Change icon');
    button?.click();

    expect(open).toHaveBeenCalled();
    expect(host.setIcon).not.toHaveBeenCalled();
  });

  it('picker select and remove write the icon', () => {
    const { row, host } = setup({ type: 'emoji', value: '🌿' });

    row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`)?.click();
    lastOptions?.onSelect('🔥');
    lastOptions?.onRemove();

    expect(host.setIcon).toHaveBeenNthCalledWith(1, { type: 'emoji', value: '🔥' });
    expect(host.setIcon).toHaveBeenNthCalledWith(2, null);
  });

  it('read-only: icon not clickable, Add icon absent', () => {
    const { row } = setup({ type: 'emoji', value: '🌿' }, { readOnly: true });

    expect(row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`)?.disabled).toBe(true);

    const empty = setup(null, { readOnly: true });

    expect(empty.row.querySelector(`[${DATA_ATTR.pageAddIcon}]`)).toBeNull();
  });

  it('an image icon renders as an img', () => {
    const { row } = setup({ type: 'image', url: 'https://example.com/a.png' });

    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
  });
});
