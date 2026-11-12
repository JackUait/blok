import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { createIconControl, type IconControlHost } from '../../../../../src/components/modules/pageTitle/icon-control';
import { loadEmojiGrid } from '../../../../../src/components/utils/emoji/emoji-data';
import type { PageIcon } from '../../../../../types/tools/page';

const open = vi.fn(async (_anchor: HTMLElement, _rect?: DOMRect, _handlers?: { current?: string }) => undefined);
const close = vi.fn();
let lastOptions: { onSelect(native: string, origin?: DOMRect): void; onRemove(): void } | null = null;

vi.mock('../../../../../src/tools/callout/emoji-picker', () => ({
  EmojiPicker: class {
    private readonly el = document.createElement('div');
    constructor(options: { onSelect(native: string, origin?: DOMRect): void; onRemove(): void }) {
      lastOptions = options;
    }
    public getElement(): HTMLElement {
      return this.el;
    }
    private opened = false;
    public isOpen(): boolean {
      return this.opened;
    }
    public open = async (anchor: HTMLElement, rect?: DOMRect, handlers?: { current?: string }): Promise<void> => {
      this.opened = true;
      await open(anchor, rect, handlers);
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
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
  });

  it('icon set: shows the emoji; click opens the picker without changing it', async () => {
    const { row, host } = setup({ type: 'emoji', value: '🌿' });
    const button = row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`);

    expect(button?.textContent).toBe('🌿');
    expect(button?.getAttribute('aria-label')).toBe('Change icon');
    button?.click();

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(host.setIcon).not.toHaveBeenCalled();
  });

  it('hands the page\'s emoji to the picker, so its stage shows the current icon', async () => {
    const { row } = setup({ type: 'emoji', value: '🛖' });

    row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`)?.click();

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0]?.[2]).toMatchObject({ current: '🛖' });
  });

  it('picker select and remove write the icon', async () => {
    const { row, host } = setup({ type: 'emoji', value: '🌿' });

    row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`)?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
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

  it('a pick while the picker is open keeps the same anchor button', async () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });
    const button = iconButton(row);

    button?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
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

  it('remove while open closes the picker and moves focus to Add icon', async () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });

    iconButton(row)?.focus();
    iconButton(row)?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    lastOptions?.onRemove();

    expect(close).toHaveBeenCalled();
    expect(row.querySelector(`[${DATA_ATTR.pageAddIcon}]`)).toHaveFocus();
  });

  it('turning read-only closes an open picker', async () => {
    const { row, state, redraw } = setup({ type: 'emoji', value: '🌿' });

    iconButton(row)?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    state.readOnly = true;
    redraw();

    expect(close).toHaveBeenCalled();
    expect(iconButton(row)?.disabled).toBe(true);
  });

  it.each([
    ['resolves', (settle: { resolve(): void; reject(): void }) => settle.resolve()],
    ['fails', (settle: { resolve(): void; reject(): void }) => settle.reject()],
  ])('Add icon writes nothing and opens no picker when read-only engages before the pick %s', async (_, finish) => {
    const { row, host, state } = setup(null);
    const settle = { resolve: (): void => undefined, reject: (): void => undefined };

    vi.mocked(loadEmojiGrid).mockImplementationOnce(() => new Promise((resolve, reject) => {
      settle.resolve = () => resolve([{ native: '🚀' }] as Awaited<ReturnType<typeof loadEmojiGrid>>);
      settle.reject = () => reject(new Error('offline'));
    }));
    row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageAddIcon}]`)?.click();
    state.readOnly = true;
    finish(settle);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.setIcon).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('the page icon lands a picked emoji like a callout', () => {
  const controls: Array<{ destroy(): void }> = [];
  const rows: HTMLElement[] = [];
  const cancels: Array<ReturnType<typeof vi.fn>> = [];
  const origin = new DOMRect(300, 400, 32, 32);

  const overlays = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[data-blok-emoji-landing]'));

  const stubReducedMotion = (reduce: boolean): void => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({ matches: reduce && query.includes('reduce') })),
    });
  };

  /** Animations that never end, so the landing stays on screen until a test ends it. */
  const stubAnimate = (): void => {
    Element.prototype.animate = vi.fn(() => {
      const cancel = vi.fn();

      cancels.push(cancel);

      return { finished: new Promise(() => undefined), cancel };
    }) as unknown as Element['animate'];
  };

  const setup = (initial: PageIcon | null): { row: HTMLElement; redraw(): void; control: { destroy(): void } } => {
    const row = document.createElement('div');
    const state = { icon: initial };
    const slot: { redraw: () => void } = { redraw: () => undefined };

    document.body.append(row);
    rows.push(row);
    const control = createIconControl(row, {
      getIcon: () => state.icon,
      setIcon: (icon: PageIcon | null) => {
        state.icon = icon;
        slot.redraw();
      },
      isReadOnly: () => false,
      labels: () => ({ add: 'Add icon', change: 'Change icon' }),
      picker: () => ({ i18n: { t: (key: string) => key }, locale: 'en' }),
    });

    slot.redraw = control.redraw;
    controls.push(control);

    return { row, redraw: control.redraw, control };
  };

  const openPicker = async (row: HTMLElement): Promise<void> => {
    row.querySelector<HTMLButtonElement>(`[${DATA_ATTR.pageIcon}]`)?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastOptions = null;
    cancels.length = 0;
    stubReducedMotion(false);
    stubAnimate();
  });

  afterEach(() => {
    controls.splice(0).forEach((control) => control.destroy());
    rows.splice(0).forEach((row) => row.remove());
    Reflect.deleteProperty(Element.prototype, 'animate');
    Reflect.deleteProperty(window, 'matchMedia');
    vi.restoreAllMocks();
  });

  it('flies a picked emoji from the picker to the icon, hiding the seat until it lands', async () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥', origin);

    const face = row.querySelector<HTMLElement>(`[${DATA_ATTR.pageIcon}] > span`);

    expect(overlays()).toHaveLength(1);
    expect(face?.textContent).toBe('🔥');
    expect(face?.style.visibility).toBe('hidden');
  });

  it('swaps the icon with no landing when the pick has no origin', async () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥');

    expect(overlays()).toHaveLength(0);
    expect(row.textContent).toBe('🔥');
  });

  it('swaps the icon with no landing when motion is reduced', async () => {
    stubReducedMotion(true);
    const { row } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥', origin);

    expect(overlays()).toHaveLength(0);
    expect(row.textContent).toBe('🔥');
  });

  it('a second pick cuts the first landing short', async () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥', origin);
    lastOptions?.onSelect('🌊', origin);

    expect(overlays()).toHaveLength(1);
    expect(row.textContent).toBe('🌊');
  });

  it('a redraw of the same icon mid-flight keeps the landing on the seat it flies to', async () => {
    const { row, redraw } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥', origin);
    const face = row.querySelector<HTMLElement>(`[${DATA_ATTR.pageIcon}] > span`);

    redraw();

    expect(row.querySelector(`[${DATA_ATTR.pageIcon}] > span`)).toBe(face);
    expect(overlays()).toHaveLength(1);
  });

  it('a different icon arriving mid-flight ends the landing and shows the new icon', async () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥', origin);
    lastOptions?.onSelect('🌊');

    expect(overlays()).toHaveLength(0);
    expect(row.querySelector<HTMLElement>(`[${DATA_ATTR.pageIcon}] > span`)?.style.visibility).toBe('');
  });

  it('removing the icon mid-flight ends the landing', async () => {
    const { row } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥', origin);
    lastOptions?.onRemove();

    expect(overlays()).toHaveLength(0);
  });

  it('destroy mid-flight ends the landing', async () => {
    const { row, control } = setup({ type: 'emoji', value: '🌿' });

    await openPicker(row);
    lastOptions?.onSelect('🔥', origin);
    control.destroy();

    expect(overlays()).toHaveLength(0);
  });
});
