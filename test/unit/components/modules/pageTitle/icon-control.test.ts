import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { createIconControl, type IconControlHost } from '../../../../../src/components/modules/pageTitle/icon-control';
import type { PageIcon } from '../../../../../types/tools/page';

const open = vi.fn(async (_anchor: HTMLElement) => undefined);
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
    private opened = false;
    public isOpen(): boolean {
      return this.opened;
    }
    public open = async (anchor: HTMLElement): Promise<void> => {
      this.opened = true;
      await open(anchor);
    };
    public close = (): void => {
      this.opened = false;
      close();
    };
  },
}));
vi.mock('../../../../../src/components/utils/emoji/emoji-data', () => ({
  loadEmojiGrid: vi.fn(async () => [{ native: '🚀' }]),
}));

describe('createIconControl', () => {
  const controls: Array<{ destroy(): void }> = [];
  const rows: HTMLElement[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    lastOptions = null;
  });

  afterEach(() => {
    controls.splice(0).forEach((control) => control.destroy());
    rows.splice(0).forEach((row) => row.remove());
    vi.restoreAllMocks();
  });

  const setup = (
    initial: PageIcon | null,
    options: { readOnly?: boolean } = {}
  ): { row: HTMLElement; host: IconControlHost & { setIcon: ReturnType<typeof vi.fn> }; state: { icon: PageIcon | null; readOnly: boolean }; redraw: () => void } => {
    const row = document.createElement('div');
    const state = { icon: initial, readOnly: options.readOnly ?? false };

    document.body.append(row);
    rows.push(row);
    const slot: { redraw: () => void } = { redraw: () => undefined };
    const host = {
      getIcon: () => state.icon,
      setIcon: vi.fn((icon: PageIcon | null) => {
        state.icon = icon;
        slot.redraw();
      }),
      isReadOnly: () => state.readOnly,
      labels: () => ({ add: 'Add icon', change: 'Change icon' }),
      picker: () => ({ i18n: { t: (key: string) => key }, locale: 'en' }),
    };
    const control = createIconControl(row, host);

    slot.redraw = control.redraw;
    controls.push(control);

    return { row, host, state, redraw: control.redraw };
  };
  const iconButton = (row: HTMLElement): HTMLButtonElement | null => row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`);

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

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
  ])('an image icon with an unsafe url %s renders no img', (url) => {
    const { row } = setup({ type: 'image', url });

    expect(row.querySelector('img')).toBeNull();
  });

  it('a pick while the picker is open keeps the same anchor button', () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });
    const button = iconButton(row);

    button?.click();
    lastOptions?.onSelect('🔥');

    expect(button?.isConnected).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(iconButton(row)).toBe(button);
    expect(button?.textContent).toBe('🔥');
  });

  it('Add icon, then a pick, keeps the picker anchor connected', async () => {
    const { row } = setup(null);

    row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageAddIcon}]`)?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    const anchor = open.mock.calls[0]?.[0];

    lastOptions?.onSelect('🔥');

    expect(anchor).toBeInstanceOf(HTMLElement);
    expect(anchor?.isConnected).toBe(true);
    expect(anchor?.getAttribute('aria-expanded')).toBe('true');
    expect(anchor?.textContent).toBe('🔥');
  });

  it('remove while open closes the picker and moves focus to Add icon', () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });

    iconButton(row)?.focus();
    iconButton(row)?.click();
    lastOptions?.onRemove();

    expect(close).toHaveBeenCalled();
    expect(row.querySelector(`[${DATA_ATTR.pageAddIcon}]`)).toHaveFocus();
  });

  it('turning read-only closes an open picker', () => {
    const { row, state, redraw } = setup({ type: 'emoji', value: '🌿' });

    iconButton(row)?.click();
    state.readOnly = true;
    redraw();

    expect(close).toHaveBeenCalled();
    expect(iconButton(row)?.disabled).toBe(true);
  });
});
