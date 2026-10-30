import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { whenNearViewport } from '../../../../src/components/utils/near-viewport';

type Entry = Pick<IntersectionObserverEntry, 'isIntersecting'>;

const observers: Array<{ fire(entries: Entry[]): void; disconnect: ReturnType<typeof vi.fn>; observed: Element[] }> = [];

class FakeObserver {
  public readonly disconnect = vi.fn();
  public readonly observed: Element[] = [];

  constructor(private readonly callback: (entries: Entry[]) => void) {
    observers.push(this);
  }

  public observe(el: Element): void {
    this.observed.push(el);
  }

  public fire(entries: Entry[]): void {
    this.callback(entries);
  }
}

describe('whenNearViewport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observers.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs at once where IntersectionObserver is missing', () => {
    const run = vi.fn();

    whenNearViewport(document.createElement('div'), run);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits until the element nears the viewport, then runs once', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const el = document.createElement('div');
    const run = vi.fn();

    whenNearViewport(el, run);

    expect(run).not.toHaveBeenCalled();
    expect(observers[0].observed).toEqual([el]);

    observers[0].fire([{ isIntersecting: false }]);
    expect(run).not.toHaveBeenCalled();

    observers[0].fire([{ isIntersecting: true }]);
    observers[0].fire([{ isIntersecting: true }]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('never runs once cancelled', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const run = vi.fn();
    const cancel = whenNearViewport(document.createElement('div'), run);

    cancel();
    observers[0].fire([{ isIntersecting: true }]);

    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
