import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveWire, pointAlong, wireCurve, wireEnds, wirePath } from '../../../../../src/components/modules/toolbar/move-wire';
import type { SpringClock } from '../../../../../src/components/utils/spring';

const box = (left: number, top: number, width: number, height: number): DOMRect => new DOMRect(left, top, width, height);

const place = (element: Element, left: number, top: number, width: number, height: number): void => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(box(left, top, width, height));
};

const makeClock = (): { clock: SpringClock; advance: (ms: number) => void } => {
  const state = { now: 0, id: 0 };
  const queue = new Map<number, () => void>();

  return {
    clock: {
      now: () => state.now,
      request: (cb) => {
        state.id += 1;
        queue.set(state.id, cb);

        return state.id;
      },
      cancel: (id) => {
        queue.delete(id);
      },
    },
    advance: (ms) => {
      const end = state.now + ms;

      while (state.now < end) {
        state.now = Math.min(end, state.now + 16);
        const due = [...queue.values()];

        queue.clear();
        due.forEach((cb) => cb());
      }
    },
  };
};

const numberOf = (element: Element | null, name: string): number => Number(element?.getAttribute(name));

describe('wire geometry', () => {
  it('starts 44px past the picker on the block\'s bottom edge and ends on a peg 14px inside the picker', () => {
    const ends = wireEnds(box(200, 100, 600, 48), box(100, 154, 264, 280), 214, 1200);

    expect(ends.start).toEqual({ x: 408, y: 149 });
    expect(ends.end).toEqual({ x: 350, y: 214 });
  });

  it('keeps the start 16px inside a narrow viewport', () => {
    const ends = wireEnds(box(20, 100, 340, 48), box(10, 154, 264, 280), 214, 300);

    expect(ends.start.x).toBe(284);
  });

  it('hangs below the row: both handles sit under the swing line', () => {
    const curve = wireCurve({ x: 408, y: 149 }, { x: 350, y: 214 }, 214);

    expect(curve).toEqual([{ x: 408, y: 149 }, { x: 408, y: 272 }, { x: 428, y: 260 }, { x: 350, y: 214 }]);
    expect(wirePath(curve)).toBe('M408 149C408 272 428 260 350 214');
  });

  it('walks the curve by distance, not by its parameter', () => {
    const straight = wireCurve({ x: 0, y: 0 }, { x: 0, y: 0 }, 0).map((_, index) => ({ x: [0, 0, 100, 100][index], y: 0 }));
    const curve = [straight[0], straight[1], straight[2], straight[3]] as const;

    expect(pointAlong(curve, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(curve, 1)).toEqual({ x: 100, y: 0 });
    // The parameter's midpoint is also x=50 here, but a quarter of the way is not x=15.6.
    expect(pointAlong(curve, 0.25).x).toBeCloseTo(25, 0);
  });
});

describe('MoveWire', () => {
  const nodes = {
    picker: document.createElement('div'),
    panel: document.createElement('div'),
    block: document.createElement('div'),
    first: document.createElement('div'),
    third: document.createElement('div'),
  };
  const wires: MoveWire[] = [];
  const open = (reduced = false): { wire: MoveWire; advance: (ms: number) => void } => {
    const { clock, advance } = makeClock();
    const wire = new MoveWire({ picker: nodes.picker, block: nodes.block, clock, reducedMotion: () => reduced });

    wires.push(wire);

    return { wire, advance };
  };
  const svg = (): SVGElement | null => nodes.picker.querySelector('[data-blok-testid="move-wire"]');
  const circles = (): Element[] => Array.from(svg()?.querySelectorAll('circle') ?? []);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(nodes, {
      picker: document.createElement('div'),
      panel: document.createElement('div'),
      block: document.createElement('div'),
      first: document.createElement('div'),
      third: document.createElement('div'),
    });
    nodes.panel.setAttribute('data-blok-popover-container', '');
    nodes.panel.append(nodes.first, nodes.third);
    nodes.picker.append(nodes.panel);
    document.body.append(nodes.block, nodes.picker);
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    place(nodes.block, 200, 100, 600, 48);
    place(nodes.panel, 100, 154, 264, 280);
    place(nodes.first, 104, 198, 256, 32);
    place(nodes.third, 104, 262, 256, 32);
  });

  afterEach(() => {
    wires.splice(0).forEach((wire) => wire.destroy());
    nodes.block.remove();
    nodes.picker.remove();
    vi.restoreAllMocks();
  });

  it('draws nothing until it has a row to aim at', () => {
    open();

    expect(svg()?.querySelector('path')?.getAttribute('d')).toBeNull();
  });

  it('is a 1px box above the picker panel: a browser paints no zero-sized svg, and the panel would cover the peg', () => {
    open();

    expect([svg()?.style.width, svg()?.style.height, svg()?.style.overflow]).toEqual(['1px', '1px', 'visible']);
    expect(svg()?.style.zIndex).toBe('calc(var(--blok-z-popover) + 1)');
  });

  it('runs from the block to the aimed row, with a peg at each end', () => {
    const { wire } = open();

    wire.aim(nodes.first);

    expect(svg()?.querySelector('path')?.getAttribute('d')).toBe('M408 149C408 272 428 260 350 214');
    expect(circles().map((circle) => [numberOf(circle, 'cx'), numberOf(circle, 'cy'), numberOf(circle, 'r')])).toEqual([
      [408, 149, 3],
      [350, 214, 3],
    ]);
  });

  it('swings to a new row: the peg gets there first, the slack overshoots and settles', () => {
    const { wire, advance } = open();

    wire.aim(nodes.first);
    wire.aim(nodes.third);
    expect(numberOf(circles()[1], 'cy')).toBe(214);

    advance(250);
    expect(numberOf(circles()[1], 'cy')).toBeGreaterThan(270);

    advance(4000);
    expect(numberOf(circles()[1], 'cy')).toBe(278);
    expect(svg()?.querySelector('path')?.getAttribute('d')).toBe('M408 149C408 336 428 324 350 278');
  });

  it('keeps its last row when the list has none', () => {
    const { wire } = open();

    wire.aim(nodes.first);
    wire.aim(null);

    expect(numberOf(circles()[1], 'cy')).toBe(214);
  });

  it('sends a bead down the wire and reports the arrival', async () => {
    const { wire, advance } = open();
    const arrived = vi.fn();

    wire.aim(nodes.first);
    void wire.send().then(arrived);
    advance(16);

    const bead = circles()[2];

    expect(numberOf(bead, 'r')).toBe(5);
    expect(numberOf(bead, 'cx')).toBeGreaterThan(400);

    advance(260);
    await Promise.resolve();
    expect(arrived).not.toHaveBeenCalled();

    advance(300);
    await Promise.resolve();
    expect(arrived).toHaveBeenCalledWith(true);
    expect([numberOf(bead, 'cx'), numberOf(bead, 'cy')]).toEqual([350, 214]);
  });

  it('holds still while the bead travels', () => {
    const { wire, advance } = open();

    wire.aim(nodes.first);
    void wire.send();
    wire.aim(nodes.third);
    advance(600);

    expect(numberOf(circles()[1], 'cy')).toBe(214);
  });

  it('reports no arrival when it is destroyed mid-flight, and leaves nothing behind', async () => {
    const { wire, advance } = open();
    const arrived = vi.fn();

    wire.aim(nodes.first);
    void wire.send().then(arrived);
    advance(100);
    wire.destroy();
    advance(1000);
    await Promise.resolve();

    expect(arrived).toHaveBeenCalledWith(false);
    expect(svg()).toBeNull();
  });

  it('with reduced motion snaps to the row and arrives at once, with no bead', async () => {
    const { wire } = open(true);

    wire.aim(nodes.first);
    wire.aim(nodes.third);
    expect(numberOf(circles()[1], 'cy')).toBe(278);

    await expect(wire.send()).resolves.toBe(true);
    expect(circles()).toHaveLength(2);
  });
});
