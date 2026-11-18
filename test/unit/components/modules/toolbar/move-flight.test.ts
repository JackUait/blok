import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMoveFlight } from '../../../../../src/components/modules/toolbar/move-flight';

const makeBlock = (style: string): { holder: HTMLElement; content: HTMLElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');

  holder.setAttribute('style', style);
  content.setAttribute('data-blok-element-content', '');
  holder.append(content);
  document.body.append(holder);
  vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 48));

  return { holder, content };
};

describe('createMoveFlight', () => {
  const picker = document.createElement('div');
  const send = { arrive: (_arrived: boolean): void => undefined };
  const wire = {
    send: vi.fn<(mark?: Element | null) => Promise<boolean>>(() => new Promise((resolve) => {
      send.arrive = resolve;
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    picker.animate = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('fades the block\'s text as the bead leaves, then folds the block away and closes the picker', async () => {
    const block = makeBlock('margin-left: 24px;');
    const mark = document.createElement('span');
    const flight = createMoveFlight({ wire, holders: [block.holder], picker: () => picker, reducedMotion: () => false });
    const landed = vi.fn();

    void flight.fly(mark).then(landed);
    expect(wire.send).toHaveBeenCalledExactlyOnceWith(mark);
    expect(block.content.style.opacity).toBe('0');
    expect(block.holder.style.height).toBe('');

    send.arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(block.holder.style.height).toBe('0px');
    expect(block.holder.style.overflow).toBe('hidden');
    expect(block.holder.style.marginLeft).toBe('24px');
    expect(picker.animate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(380);
    expect(picker.animate).toHaveBeenCalledTimes(1);
    expect(landed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(140);
    expect(landed).toHaveBeenCalledWith(true);
  });

  it('puts every inline style back exactly as it was', async () => {
    const first = makeBlock('margin-left: 24px;');
    const second = makeBlock('');

    second.holder.removeAttribute('style');
    const flight = createMoveFlight({ wire, holders: [first.holder, second.holder], picker: () => picker, reducedMotion: () => false });

    void flight.fly();
    send.arrive(true);
    await vi.advanceTimersByTimeAsync(600);
    flight.restore();

    expect(first.holder.getAttribute('style')).toBe('margin-left: 24px;');
    expect(second.holder.hasAttribute('style')).toBe(false);
    expect(first.content.hasAttribute('style')).toBe(false);
  });

  it('brings the block back when the wire goes away before the bead arrives', async () => {
    const block = makeBlock('');
    const flight = createMoveFlight({ wire, holders: [block.holder], picker: () => picker, reducedMotion: () => false });
    const landed = vi.fn();

    void flight.fly().then(landed);
    send.arrive(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(landed).toHaveBeenCalledWith(false);
    expect(block.content.style.opacity).toBe('');
    expect(block.holder.style.height).toBe('');
  });

  it('does not land once it was restored mid-way', async () => {
    const block = makeBlock('');
    const flight = createMoveFlight({ wire, holders: [block.holder], picker: () => picker, reducedMotion: () => false });
    const landed = vi.fn();

    void flight.fly().then(landed);
    send.arrive(true);
    await vi.advanceTimersByTimeAsync(100);
    flight.restore();
    await vi.advanceTimersByTimeAsync(1000);

    expect(landed).toHaveBeenCalledWith(false);
    expect(block.holder.style.height).toBe('');
    expect(picker.animate).not.toHaveBeenCalled();
  });

  it('with reduced motion touches nothing and lands as soon as the wire says so', async () => {
    const block = makeBlock('');
    const flight = createMoveFlight({ wire, holders: [block.holder], picker: () => picker, reducedMotion: () => true });
    const landed = vi.fn();

    void flight.fly().then(landed);
    expect(block.content.style.opacity).toBe('');
    send.arrive(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(landed).toHaveBeenCalledWith(true);
    expect(block.holder.style.height).toBe('');
    expect(picker.animate).not.toHaveBeenCalled();
  });
});
